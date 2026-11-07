import { $, onEvent } from './api.js';
import { floorAt } from './shared.js';

const MAPS_URL = 'https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json';

// Projeção copiada do tarkov.dev (src/pages/map/index.jsx) para bater com os tiles deles.
function rotate(ll, deg) {
  if (!deg) return ll;
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return L.latLng(ll.lng * s + ll.lat * c, ll.lng * c - ll.lat * s);
}
function crs(m) {
  const [sx, mx, sy, my] = m.transform;
  return L.extend({}, L.CRS.Simple, {
    transformation: new L.Transformation(sx, mx, -sy, my),
    projection: L.extend({}, L.Projection.LonLat, {
      project: ll => L.Projection.LonLat.project(rotate(ll, m.coordinateRotation)),
      unproject: p => rotate(L.Projection.LonLat.unproject(p), -m.coordinateRotation),
    }),
  });
}

const maps = {}, statics = {};
let style = localStorage.getItem('gs-style') ?? 'sat', svgEl;
let zoomOutside = null, current, leaflet, me, myPing, floorLayer, bounds, extractLayer, squadLayer, extracts = {}, lastPos, raidStart, squadMembers = [], myName;
export let overlay; // camada livre para outros módulos (missões) desenharem no mapa
export const mapKeyNow = () => $('#map-select').value;
export const mapInfo = key => extracts[key];
export const flyTo = (x, z) => leaflet?.flyTo([z, x], Math.max(leaflet.getZoom(), (current?.maxZoom ?? 5) - 1.5), { duration: 0.6 });
const onShow = [];
export const onMapShown = f => onShow.push(f);

const EX_COLOR = { pmc: '#4c4', scav: '#4af', shared: '#c6f', transit: '#fa3' };
const EX_NAME = { pmc: 'Extração PMC', scav: 'Extração Scav', shared: 'Extração em grupo (co-op)', transit: 'Transição para outro mapa' };
const EX_SHOW = { pmc: ['pmc', 'shared', 'transit'], scav: ['scav', 'shared', 'transit'], all: Object.keys(EX_COLOR), none: [] };
// shortcut: 5 m/s é a média andando e correndo; o tempo real muda com peso e stamina
const SPEED = 5;
// tiles pelo servidor local, que guarda cópia em disco
const local = url => url.replace('https://assets.tarkov.dev/maps/', '/tiles/');
const TILE_OPTS = { keepBuffer: 6, updateWhenZooming: false };

// Baixa por trás os tiles dos primeiros níveis de zoom do mapa inteiro, para abrir sem buracos
async function warm(m, template) {
  const urls = [];
  for (let z = m.minZoom; z <= Math.min(m.maxZoom, m.minZoom + 3); z++) {
    const a = leaflet.project(bounds.getNorthWest(), z), b = leaflet.project(bounds.getSouthEast(), z);
    const size = m.tileSize || 256;
    for (let x = Math.floor(Math.min(a.x, b.x) / size); x <= Math.floor(Math.max(a.x, b.x) / size); x++)
      for (let y = Math.floor(Math.min(a.y, b.y) / size); y <= Math.floor(Math.max(a.y, b.y) / size); y++)
        urls.push(template.replace('{z}', z).replace('{x}', x).replace('{y}', y));
  }
  const next = async () => { while (urls.length && current === m) await fetch(urls.shift()).catch(() => {}); };
  await Promise.all(Array.from({ length: 2 }, next)); // só 2: deixa conexões livres para os tiles da tela
}

// Ícones oficiais do mapa do tarkov.dev (extração, cadeado, perigo, container...)
// small: some com o mapa afastado (containers, spawns, loot), para não virar uma sopa de ícones
const pin = (name, size = 24, small = false) => L.icon({ iconUrl: `https://tarkov.dev/maps/interactive/${name}.png`, iconSize: [size, size], iconAnchor: [size / 2, size / 2], className: small ? 'ic-small' : '' });

const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const icon = (cls, html = '') => L.divIcon({ className: '', html: `<div class="${cls}">${html}</div>`, iconSize: [16, 16] });

function drawExtracts() {
  extractLayer.clearLayers();
  const show = EX_SHOW[$('#extract-filter').value];
  for (const e of extracts[mapKeyNow()]?.points ?? []) {
    if (!show.includes(e.faction)) continue;
    const dist = lastPos && Math.hypot(e.x - lastPos.x, e.z - lastPos.z);
    const label = dist ? `${e.name} · ${Math.round(dist)} m · ${mmss(dist / SPEED)}` : e.name;
    const m = L.marker([e.z, e.x], { icon: pin(`extract_${e.faction}`, 30) })
      .bindTooltip(label, { permanent: true, direction: 'right', offset: [14, 0], className: 'ex-label' }).addTo(extractLayer);
    detail(m, `<b>${e.name}</b><br>${EX_NAME[e.faction]}${e.needsSwitch ? '<br>⚡ Precisa acionar uma alavanca antes' : ''}${dist ? `<br>${Math.round(dist)} m · uns ${mmss(dist / SPEED)} até lá` : ''}`);
  }
}

// Detalhe ao passar o mouse: um popup sem botão que some ao sair
export function detail(layer, html) {
  layer.on('mouseover', e => L.popup({ closeButton: false, autoPan: false, className: 'detail', offset: [0, -6] }).setLatLng(e.latlng).setContent(html).openOn(leaflet));
  layer.on('mouseout', () => leaflet.closePopup());
}
const pct = v => Math.round(v * 100) + '%';
const img = (src, cls = '') => (src ? `<img src="${src}" class="${cls}">` : '');

// Camadas extras do mapa; o controle do Leaflet liga e desliga cada uma
// Estimativa de onde os outros jogadores podem estar, por fase da raid. É estatística, não rastreio:
// o jogo não informa isso. Começo: perto dos spawns de PMC; meio: onde há loot valioso; fim: nas extrações PMC.
const estimateLayer = L.layerGroup();
function drawEstimate() {
  estimateLayer.clearLayers();
  const d = extracts[mapKeyNow()];
  if (!d || !leaflet?.hasLayer(estimateLayer)) return;
  const dur = (d.duration ?? 40) * 60, t = raidStart ? (Date.now() - raidStart) / 1000 : -1;
  if (t < 0 || t > dur) return; // sem raid em andamento
  const heat = (list, radius, alpha) => list.forEach(p =>
    L.circle([p.z, p.x], { radius, stroke: false, fillColor: '#f80', fillOpacity: alpha, interactive: false }).addTo(estimateLayer));
  if (t < 180) heat(d.spawns.filter(s => s.sides.includes('pmc')), 30 + t * 0.7, 0.05);
  else if (t < dur * 0.6) heat((d.loot ?? []).filter(l => l.i.some(k => d.lootItems[k].price >= 40000)), 45, 0.05);
  else heat(d.points.filter(e => e.faction === 'pmc'), 70, 0.25);
}

const layerOn = JSON.parse(localStorage.getItem('gs-layers') ?? '{"Bosses":true,"Chaves":true,"Perigos":true}');
function buildLayers(key) {
  const d = extracts[key];
  if (!d) return;
  const groups = {
    Bosses: d.bosses.map(b => {
      const m = L.marker([b.z, b.x], { icon: L.divIcon({ className: '', html: `<div class="boss">${img(b.portrait)}</div>`, iconSize: [30, 30] }) });
      detail(m, `<div class="row">${img(b.portrait, 'big')}<div><b>${b.name}</b><br>Chance no mapa: ${pct(b.chance)}<br>Neste local (${b.zone}): ${pct(b.zoneChance)}</div></div>`);
      return m;
    }),
    Chaves: d.locks.map(l => {
      const m = L.marker([l.z, l.x], { icon: pin(/cart[aã]o|keycard/i.test(l.key) ? 'keycard' : 'lock', 20) });
      detail(m, `<div class="row">${img(l.icon)}<div><b>Porta trancada</b><br>${l.key}${l.price ? `<br>Flea: ${l.price.toLocaleString('pt-BR')} ₽` : ''}${l.needsPower ? '<br>⚡ Precisa de energia' : ''}</div></div>`);
      return m;
    }),
    Perigos: d.hazards.map(h => {
      const label = `<b>${h.name === 'Landmine' ? 'Campo minado' : h.name}</b>`;
      const p = L.polygon(h.outline.map(o => [o.z, o.x]), { color: '#f33', weight: 1, fillOpacity: 0.2, dashArray: '4 4' });
      const c = p.getBounds().getCenter();
      const m = L.marker(c, { icon: pin('hazard', 26) });
      detail(p, label);
      detail(m, label);
      return L.layerGroup([p, m]);
    }),
    Containers: d.containers.map(c => { const m = L.marker([c.z, c.x], { icon: pin(`container_${c.type}`, 18, true) }); detail(m, c.name); return m; }),
    Alavancas: d.switches.map(s => { const m = L.marker([s.z, s.x], { icon: pin('switch', 22) }); detail(m, '<b>Alavanca</b><br>Abre extração ou porta'); return m; }),
    'Armas fixas': d.weapons.map(w => { const m = L.marker([w.z, w.x], { icon: pin('stationarygun', 22) }); detail(m, `<b>${w.name}</b>`); return m; }),
    'Spawns de jogadores': d.spawns.map(s => { const pmc = s.sides.includes('pmc') || s.sides.includes('all'); const m = L.marker([s.z, s.x], { icon: pin(pmc ? 'spawn_pmc' : 'spawn_scav', 18, true) }); detail(m, `<b>Spawn de ${pmc ? 'PMC' : 'Scav'}</b>`); return m; }),
    'Loot valioso': (d.loot ?? []).map(l => ({ l, its: l.i.map(k => d.lootItems[k]).sort((a, b) => b.price - a.price) })).filter(x => x.its[0]?.price >= 40000).map(({ l, its }) => {
      const m = L.marker([l.z, l.x], { icon: pin('loose_loot', 20, true) });
      detail(m, `<b>Pode aparecer aqui</b>${its.slice(0, 5).map(it => `<div class="row">${img(it.icon)}<span>${it.name}<br><span class="muted">${it.price ? it.price.toLocaleString('pt-BR') + ' ₽' : 'sem flea'}</span></span></div>`).join('')}${its.length > 5 ? `<span class="muted">e mais ${its.length - 5}</span>` : ''}`);
      return m;
    }),
    'Onde podem estar (estimativa)': [estimateLayer],
  };
  const overlays = {};
  for (const [name, list] of Object.entries(groups)) {
    overlays[name] = L.layerGroup(list);
    if (layerOn[name]) overlays[name].addTo(leaflet);
  }
  L.control.layers(null, overlays, { collapsed: false, position: 'topright' }).addTo(leaflet);
  leaflet.on('overlayadd', drawEstimate);
  leaflet.on('overlayadd overlayremove', e => { layerOn[e.name] = e.type === 'overlayadd'; localStorage.setItem('gs-layers', JSON.stringify(layerOn)); });
}

function drawSquad() {
  squadLayer?.clearLayers();
  for (const m of squadMembers) {
    if (m.name === myName || m.map !== mapKeyNow()) continue;
    L.marker([m.z, m.x], { icon: icon('mate'), interactive: false })
      .bindTooltip(m.name, { permanent: true, direction: 'top', className: 'ex-label' }).addTo(squadLayer);
    if (m.ping) L.marker([m.ping.z, m.ping.x], { icon: icon('ping mate-ping'), interactive: false })
      .bindTooltip(`ping de ${m.name}`, { direction: 'top', className: 'ex-label' }).addTo(squadLayer);
  }
}

// Cronômetro: tempo de raid que falta, pela duração do mapa e pelo início lido no log
function tick() {
  if (Date.now() % 10000 < 1000) drawEstimate(); // círculos crescem a cada 10 s
  const dur = extracts[mapKeyNow()]?.duration;
  const left = raidStart && dur ? dur * 60 - (Date.now() - raidStart) / 1000 : -1;
  $('#raid-timer').hidden = left <= 0;
  if (left > 0) $('#raid-timer').textContent = `Raid ${mmss(left)}`;
}

export const resizeMap = () => leaflet?.invalidateSize();

// Andar por cima do térreo; -1 = só o térreo
// Estratégico: mostra o térreo e o andar escolhido, esconde os outros andares do SVG
function svgFloor() {
  if (!svgEl) return;
  const on = current.layers?.[+$('#floor').value]?.svgLayer;
  for (const l of current.layers ?? []) {
    const g = l.svgLayer && svgEl.querySelector('#' + l.svgLayer);
    if (g) g.style.display = l.svgLayer === on ? '' : 'none';
  }
}

function showFloor(i) {
  if (i === +$('#floor').value) return; // evita piscar ao repetir o mesmo andar
  $('#floor').value = i;
  floorLayer?.remove();
  floorLayer = null;
  if (svgEl) return svgFloor();
  const l = current.layers?.[i];
  if (l) floorLayer = L.tileLayer(local(l.tilePath), { tileSize: current.tileSize || 256, bounds, ...TILE_OPTS }).addTo(leaflet);
}

function setPing(latlng) {
  myPing?.remove();
  myPing = latlng && L.marker(latlng, { icon: icon('ping') }).on('click', () => setPing(null)).addTo(leaflet);
  if (myPing && lastPos) myPing.bindTooltip(`${Math.round(Math.hypot(latlng.lng - lastPos.x, latlng.lat - lastPos.z))} m`, { permanent: true, direction: 'top', offset: [0, -8], className: 'ex-label' });
  fetch('/ping', { method: 'POST', body: JSON.stringify(latlng ? { x: latlng.lng, z: latlng.lat } : {}) });
}

function showMap(key) {
  const m = maps[key];
  if (!m) return;
  current = m;
  $('#map-select').value = key;
  leaflet?.remove();
  const b = m.bounds;
  bounds = L.latLngBounds([b[0][1], b[0][0]], [b[1][1], b[1][0]]);
  m.layers = (m.layers ?? []).filter(l => l.tilePath);
  $('#map-style').innerHTML = '<option value="sat">Satélite</option>' + (m.svgPath ? '<option value="svg">Estratégico</option>' : '')
    + (statics[key] ?? []).map(v => `<option value="${v}">${(v.match(/[23]d.*$/)?.[0] ?? v).toUpperCase()} (ilustração)</option>`).join('');
  if (style === 'svg' && !m.svgPath) style = 'sat';
  $('#map-style').value = style;
  $('#floor').innerHTML = '<option value="-1">Térreo</option>' + m.layers.map((l, i) => `<option value="${i}">${l.name}</option>`).join('');
  floorLayer = null;
  // wheelPxPerZoomLevel alto = rodinha menos sensível (padrão do Leaflet é 60)
  leaflet = L.map('map', { crs: crs(m), minZoom: m.minZoom, maxZoom: m.maxZoom, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 200, attributionControl: false, preferCanvas: true });
  svgEl = null;
  if (style === 'svg' && m.svgPath) {
    // Estratégico: mapa vetorial cinza do tarkov.dev, mesmas coordenadas do satélite
    fetch(local(m.svgPath)).then(r => r.text()).then(text => {
      if (current !== m) return;
      svgEl = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
      const sb = m.svgBounds;
      L.svgOverlay(svgEl, sb ? L.latLngBounds([sb[0][1], sb[0][0]], [sb[1][1], sb[1][0]]) : bounds).addTo(leaflet).bringToBack();
      svgFloor();
    });
  } else {
    const base = L.tileLayer(local(m.tilePath), { tileSize: m.tileSize || 256, bounds, ...TILE_OPTS }).addTo(leaflet);
    base.once('load', () => warm(m, local(m.tilePath))); // baixa o resto depois que a tela carregou
  }
  leaflet.fitBounds(bounds);
  const far = () => leaflet.getContainer().classList.toggle('zoom-far', leaflet.getZoom() < m.minZoom + 1.5);
  leaflet.on('zoomend', far);
  far();
  const places = L.layerGroup().addTo(leaflet);
  for (const l of m.labels ?? []) {
    L.marker([l.position[1], l.position[0]], { icon: L.divIcon({ className: '', html: `<span class="place">${l.text}</span>`, iconSize: null }), interactive: false }).addTo(places);
  }
  extractLayer = L.layerGroup().addTo(leaflet);
  overlay = L.layerGroup().addTo(leaflet);
  squadLayer = L.layerGroup().addTo(leaflet);
  buildLayers(key);
  drawExtracts();
  drawSquad();
  me = myPing = null;
  leaflet.on('click', e => setPing(e.latlng));
  onShow.forEach(f => f(key));
}

function showPosition(p) {
  if (!current) return;
  lastPos = p;
  // mesma correção de rotação que o tarkov.dev usa no marcador do jogador
  let add = current.coordinateRotation;
  if (add === 90 || add === 270) add += 180;
  const meIcon = L.divIcon({ className: '', html: `<img src="https://tarkov.dev/maps/interactive/player-position.png" class="me" style="transform: rotate(${p.yaw + add}deg)">`, iconSize: [28, 28] });
  const ll = [p.z, p.x];
  me ? me.setLatLng(ll).setIcon(meIcon) : (me = L.marker(ll, { icon: meIcon, interactive: false }).addTo(leaflet));
  const floor = floorAt(current.layers, p);
  const changed = floor.index !== +$('#floor').value;
  showFloor(floor.index);
  if ($('#follow').checked) {
    // subiu num prédio: aproxima nele; no térreo ou em andar do mapa todo: só acompanha
    if (changed && floor.rect) {
      zoomOutside ??= leaflet.getZoom();
      leaflet.flyToBounds(floor.rect.map(([x, z]) => [z, x]), { padding: [60, 60], maxZoom: current.maxZoom - 0.5, duration: 0.6 });
    } else if (changed && zoomOutside != null) {
      leaflet.flyTo(ll, zoomOutside, { duration: 0.6 }); // saiu do prédio: volta ao zoom de antes
      zoomOutside = null;
    } else leaflet.panTo(ll);
  }
  drawExtracts();
}

// 2D/3D: ilustração do tarkov.dev, sem coordenadas (sem posição nem camadas)
function showStatic(variant) {
  leaflet?.remove();
  current = null;
  leaflet = L.map('map', { crs: L.CRS.Simple, minZoom: -4, zoomSnap: 0.25, wheelPxPerZoomLevel: 200, attributionControl: false });
  const img = new Image();
  img.onload = () => {
    const b = [[0, 0], [img.height, img.width]];
    L.imageOverlay(img.src, b).addTo(leaflet);
    leaflet.fitBounds(b);
  };
  img.src = `https://tarkov.dev/maps/${variant}.jpg`;
}

export async function initMap() {
  $('#map-style').onchange = e => {
    const key = $('#map-select').value;
    if (['sat', 'svg'].includes(e.target.value)) {
      style = e.target.value;
      localStorage.setItem('gs-style', style);
      current = null;
      showMap(key);
    } else showStatic(e.target.value);
  };
  $('#map-select').onchange = e => showMap(e.target.value);
  $('#clear-pings').onclick = () => setPing(null);
  $('#floor').onchange = e => showFloor(+e.target.value);
  $('#extract-filter').onchange = drawExtracts;
  $('#follow').onchange = e => e.target.checked && me && leaflet.panTo(me.getLatLng());
  setInterval(tick, 1000);

  const [mapData, ex] = await Promise.all([
    fetch(MAPS_URL).then(r => r.json()).catch(() => []),
    fetch('/mapdata').then(r => r.json()).catch(() => ({})),
  ]);
  extracts = ex;
  if (!mapData.length) $('#map-status').textContent = 'Não consegui baixar os mapas do tarkov.dev.';
  for (const group of mapData) {
    const m = group.maps.find(x => x.projection === 'interactive');
    if (m) maps[group.normalizedName] = m;
    if (m) statics[group.normalizedName] = group.maps.filter(x => x.projection !== 'interactive').map(x => x.key);
  }
  $('#map-select').innerHTML = Object.keys(maps).map(k => `<option value="${k}">${k}</option>`).join('');
  showMap('customs');

  // Eventos do servidor: mapa e início da raid pelo log, posição pelo screenshot, grupo pelo squad
  onEvent((type, data) => {
    if (type === 'map' && maps[data] && current !== maps[data]) showMap(data);
    if (type === 'position') showPosition(data);
    if (type === 'raidStart') raidStart = data;
    if (type === 'side' && $('#extract-filter').value !== data) { $('#extract-filter').value = data; drawExtracts(); } // raid de PMC ou de Scav
    if (type === 'squad') { squadMembers = data; drawSquad(); }
    if (type === 'me') myName = data;
  });
}
