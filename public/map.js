import { $ } from './api.js';
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

const maps = {};
let current, leaflet, me, myPing, floorLayer, bounds, extractLayer, squadLayer, extracts = {}, lastPos, raidStart, squadMembers = [], myName;
export let overlay; // camada livre para outros módulos (missões) desenharem no mapa
export const mapKeyNow = () => $('#map-select').value;
const onShow = [];
export const onMapShown = f => onShow.push(f);

const EX_COLOR = { pmc: '#4c4', scav: '#4af', shared: '#c6f', transit: '#fa3' };
const EX_SHOW = { pmc: ['pmc', 'shared', 'transit'], scav: ['scav', 'shared', 'transit'], all: Object.keys(EX_COLOR), none: [] };
// shortcut: 5 m/s é a média andando e correndo; o tempo real muda com peso e stamina
const SPEED = 5;
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const icon = (cls, html = '') => L.divIcon({ className: '', html: `<div class="${cls}">${html}</div>`, iconSize: [18, 18] });

function drawExtracts() {
  extractLayer.clearLayers();
  const show = EX_SHOW[$('#extract-filter').value];
  for (const e of extracts[mapKeyNow()]?.points ?? []) {
    if (!show.includes(e.faction)) continue;
    const dist = lastPos && Math.hypot(e.x - lastPos.x, e.z - lastPos.z);
    const label = dist ? `${e.name} · ${Math.round(dist)} m · ${mmss(dist / SPEED)}` : e.name;
    L.circleMarker([e.z, e.x], { radius: 6, color: '#000', weight: 1, fillColor: EX_COLOR[e.faction], fillOpacity: 1, interactive: false })
      .bindTooltip(label, { permanent: true, direction: 'right', className: 'ex-label' }).addTo(extractLayer);
  }
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
  const dur = extracts[mapKeyNow()]?.duration;
  const left = raidStart && dur ? dur * 60 - (Date.now() - raidStart) / 1000 : -1;
  $('#raid-timer').hidden = left <= 0;
  if (left > 0) $('#raid-timer').textContent = `Raid ${mmss(left)}`;
}

export const resizeMap = () => leaflet?.invalidateSize();

// Andar por cima do térreo; -1 = só o térreo
function showFloor(i) {
  if (i === +$('#floor').value) return; // evita piscar ao repetir o mesmo andar
  $('#floor').value = i;
  floorLayer?.remove();
  floorLayer = null;
  const l = current.layers?.[i];
  if (l) floorLayer = L.tileLayer(l.tilePath, { tileSize: current.tileSize || 256, bounds }).addTo(leaflet);
}

function setPing(latlng) {
  myPing?.remove();
  myPing = latlng && L.marker(latlng, { icon: icon('ping') }).on('click', () => setPing(null)).addTo(leaflet);
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
  $('#floor').innerHTML = '<option value="-1">Térreo</option>' + m.layers.map((l, i) => `<option value="${i}">${l.name}</option>`).join('');
  floorLayer = null;
  // wheelPxPerZoomLevel alto = rodinha menos sensível (padrão do Leaflet é 60)
  leaflet = L.map('map', { crs: crs(m), minZoom: m.minZoom, maxZoom: m.maxZoom, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 200, attributionControl: false });
  L.tileLayer(m.tilePath, { tileSize: m.tileSize || 256, bounds }).addTo(leaflet);
  leaflet.fitBounds(bounds);
  const places = L.layerGroup().addTo(leaflet);
  for (const l of m.labels ?? []) {
    L.marker([l.position[1], l.position[0]], { icon: L.divIcon({ className: '', html: `<span class="place">${l.text}</span>`, iconSize: null }), interactive: false }).addTo(places);
  }
  extractLayer = L.layerGroup().addTo(leaflet);
  overlay = L.layerGroup().addTo(leaflet);
  squadLayer = L.layerGroup().addTo(leaflet);
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
  const meIcon = L.divIcon({ className: '', html: `<div class="me" style="transform: rotate(${p.yaw + add}deg)"></div>`, iconSize: [16, 20] });
  const ll = [p.z, p.x];
  me ? me.setLatLng(ll).setIcon(meIcon) : (me = L.marker(ll, { icon: meIcon, interactive: false }).addTo(leaflet));
  if ($('#follow').checked) leaflet.panTo(ll);
  showFloor(floorAt(current.layers, p));
  drawExtracts();
}

export async function initMap() {
  $('#map-select').onchange = e => showMap(e.target.value);
  $('#clear-pings').onclick = () => setPing(null);
  $('#floor').onchange = e => showFloor(+e.target.value);
  $('#extract-filter').onchange = drawExtracts;
  $('#follow').onchange = e => e.target.checked && me && leaflet.panTo(me.getLatLng());
  setInterval(tick, 1000);

  const [mapData, ex] = await Promise.all([
    fetch(MAPS_URL).then(r => r.json()).catch(() => []),
    fetch('/extracts').then(r => r.json()).catch(() => ({})),
  ]);
  extracts = ex;
  if (!mapData.length) $('#map-status').textContent = 'Não consegui baixar os mapas do tarkov.dev.';
  for (const group of mapData) {
    const m = group.maps.find(x => x.projection === 'interactive');
    if (m) maps[group.normalizedName] = m;
  }
  $('#map-select').innerHTML = Object.keys(maps).map(k => `<option value="${k}">${k}</option>`).join('');
  showMap('customs');

  // Eventos do servidor: mapa e início da raid pelo log, posição pelo screenshot, grupo pelo squad
  new EventSource('/events').onmessage = e => {
    const { type, data } = JSON.parse(e.data);
    if (type === 'map' && maps[data] && current !== maps[data]) showMap(data);
    if (type === 'position') showPosition(data);
    if (type === 'raidStart') raidStart = data;
    if (type === 'squad') { squadMembers = data; drawSquad(); }
    if (type === 'me') myName = data;
  };
}
