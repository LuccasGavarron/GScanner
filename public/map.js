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
let current, leaflet, me, pings, floorLayer, bounds, extractLayer, extracts = {};

const EX_COLOR = { pmc: '#4c4', scav: '#4af', shared: '#c6f', transit: '#fa3' };
const EX_SHOW = { pmc: ['pmc', 'shared', 'transit'], scav: ['scav', 'shared', 'transit'], all: Object.keys(EX_COLOR), none: [] };

function drawExtracts() {
  extractLayer.clearLayers();
  const show = EX_SHOW[$('#extract-filter').value];
  for (const e of extracts[$('#map-select').value] ?? []) {
    if (!show.includes(e.faction)) continue;
    L.circleMarker([e.z, e.x], { radius: 6, color: '#000', weight: 1, fillColor: EX_COLOR[e.faction], fillOpacity: 1, interactive: false })
      .bindTooltip(e.name, { permanent: true, direction: 'right', className: 'ex-label' }).addTo(extractLayer);
  }
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
  extractLayer = L.layerGroup().addTo(leaflet);
  drawExtracts();
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
  if ($('#follow').checked) leaflet.panTo(ll);
  showFloor(floorAt(current.layers, p));
  $('#map-status').textContent = `Você: x ${p.x.toFixed(0)}, z ${p.z.toFixed(0)}, altura ${p.y.toFixed(1)}`;
}

export async function initMap() {
  $('#map-select').onchange = e => showMap(e.target.value);
  $('#clear-pings').onclick = () => pings?.clearLayers();
  $('#floor').onchange = e => showFloor(+e.target.value);
  $('#extract-filter').onchange = drawExtracts;
  $('#follow').onchange = e => e.target.checked && me && leaflet.panTo(me.getLatLng());

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

  // Eventos do servidor: mapa pelo log, posição pelo screenshot
  new EventSource('/events').onmessage = e => {
    const { type, data } = JSON.parse(e.data);
    if (type === 'map' && maps[data] && current !== maps[data]) showMap(data);
    if (type === 'position') showPosition(data);
  };
}
