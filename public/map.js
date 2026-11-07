import { $ } from './api.js';

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
let current, leaflet, me, pings;
export const resizeMap = () => leaflet?.invalidateSize();

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

export async function initMap() {
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
}
