import { armorGrade } from './shared.js';

const $ = s => document.querySelector(s);
const API = 'https://api.tarkov.dev/graphql';
const MAPS_URL = 'https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json';

// Abas
for (const b of document.querySelectorAll('nav button')) {
  b.onclick = () => {
    document.querySelectorAll('nav button, .tab').forEach(e => e.classList.remove('on'));
    b.classList.add('on');
    $('#' + b.dataset.tab).classList.add('on');
    leaflet?.invalidateSize();
  };
}

// ---------- Mapa ----------
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

let maps = {}, current, leaflet, me, pings;

function showMap(key) {
  const m = maps[key];
  if (!m) return;
  current = m;
  $('#map-select').value = key;
  leaflet?.remove();
  const b = m.bounds;
  const bounds = L.latLngBounds([b[0][1], b[0][0]], [b[1][1], b[1][0]]);
  leaflet = L.map('map', { crs: crs(m), minZoom: m.minZoom, maxZoom: m.maxZoom, zoomSnap: 0.25, attributionControl: false });
  L.tileLayer(m.tilePath, { tileSize: m.tileSize || 256, bounds }).addTo(leaflet);
  leaflet.fitBounds(bounds);
  pings = L.layerGroup().addTo(leaflet);
  me = null;
  leaflet.on('click', e => L.marker(e.latlng, { icon: L.divIcon({ className: '', html: '<div class="ping"></div>', iconSize: [18, 18] }) })
    .on('click', ev => pings.removeLayer(ev.target)).addTo(pings));
}

function showPosition(p) {
  if (!current) return;
  // mesma correção de rotação que o tarkov.dev usa no marcador do jogador
  let add = current.coordinateRotation;
  if (add === 90 || add === 270) add += 180;
  const icon = L.divIcon({ className: '', html: `<div class="me" style="transform: rotate(${p.yaw + add}deg)"></div>`, iconSize: [16, 20] });
  const ll = [p.z, p.x];
  me ? me.setLatLng(ll).setIcon(icon) : (me = L.marker(ll, { icon, interactive: false }).addTo(leaflet));
  leaflet.panTo(ll);
  $('#map-status').textContent = `Você: x ${p.x.toFixed(0)}, z ${p.z.toFixed(0)}, altura ${p.y.toFixed(1)}`;
}

$('#map-select').onchange = e => showMap(e.target.value);
$('#clear-pings').onclick = () => pings?.clearLayers();

const mapData = await fetch(MAPS_URL).then(r => r.json()).catch(() => []);
if (!mapData.length) $('#map-status').textContent = 'Não consegui baixar os mapas do tarkov.dev.';
for (const group of mapData) {
  const m = group.maps.find(x => x.projection === 'interactive');
  if (m) maps[group.normalizedName] = m;
}
$('#map-select').innerHTML = Object.keys(maps).map(k => `<option value="${k}">${k}</option>`).join('');
showMap('customs');

// Eventos do servidor: mapa pelo log, posição pelo screenshot
new EventSource('/events').onmessage = e => {
  const { type, data } = JSON.parse(e.data);
  if (type === 'map' && maps[data] && current !== maps[data]) showMap(data);
  if (type === 'position') showPosition(data);
};

// ---------- Munição ----------
const AMMO_QUERY = `{ ammo { caliber damage penetrationPower armorDamage fragmentationChance initialSpeed projectileCount
  item { name shortName avg24hPrice } } }`;

async function loadAmmo() {
  try {
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: AMMO_QUERY }) });
    const ammo = (await r.json()).data?.ammo;
    if (!ammo?.length) throw new Error('API sem dados');
    localStorage.setItem('gs-ammo', JSON.stringify({ at: Date.now(), ammo }));
    return { ammo, note: 'Dados ao vivo do tarkov.dev.' };
  } catch {
    const cache = JSON.parse(localStorage.getItem('gs-ammo') ?? 'null');
    if (!cache) return { ammo: [], note: 'API do tarkov.dev fora do ar e sem cópia salva. Tente de novo mais tarde.' };
    return { ammo: cache.ammo, note: `API fora do ar: usando cópia de ${new Date(cache.at).toLocaleString('pt-BR')}.` };
  }
}

const COLS = [
  ['Munição', a => a.item.shortName], ['Dano', a => a.damage * (a.projectileCount || 1)], ['Pen', a => a.penetrationPower],
  ['Dano armadura', a => a.armorDamage], ['Frag %', a => Math.round(a.fragmentationChance * 100)],
  ['Vel. m/s', a => a.initialSpeed], ['Preço', a => a.item.avg24hPrice || 0],
];
let ammoList = [], sortCol = 2;

function renderAmmo() {
  const rows = ammoList.filter(a => a.caliber === $('#caliber').value)
    .sort((a, b) => COLS[sortCol][1](b) - COLS[sortCol][1](a) || 0);
  const head = COLS.map(([n], i) => `<th data-i="${i}">${n}${i === sortCol ? ' ▼' : ''}</th>`).join('') +
    [1, 2, 3, 4, 5, 6].map(c => `<th title="Classe de armadura">C${c}</th>`).join('');
  const body = rows.map(a => '<tr>' +
    COLS.map(([, f], i) => `<td title="${i ? '' : a.item.name}">${
      i === 6 ? (f(a) ? f(a).toLocaleString('pt-BR') + ' ₽' : '—') :
      i === 1 && a.projectileCount > 1 ? `${a.damage}×${a.projectileCount}` : f(a)}</td>`).join('') +
    [1, 2, 3, 4, 5, 6].map(c => `<td class="g${armorGrade(a.penetrationPower, c)}"></td>`).join('') + '</tr>').join('');
  $('#ammo').innerHTML = `<tr>${head}</tr>${body}`;
  $('#ammo').querySelectorAll('th[data-i]').forEach(th => th.onclick = () => { sortCol = +th.dataset.i; renderAmmo(); });
}

const { ammo, note } = await loadAmmo();
ammoList = ammo;
$('#ammo-status').textContent = note + ' Cores: verde fura fácil, amarelo fura, laranja difícil, vermelho não fura.';
const calibers = [...new Set(ammo.map(a => a.caliber))].sort();
$('#caliber').innerHTML = calibers.map(c => `<option value="${c}">${c.replace(/^Caliber/, '')}</option>`).join('');
$('#caliber').onchange = renderAmmo;
if (calibers.length) renderAmmo();
