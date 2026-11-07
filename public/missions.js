import { $, rub } from './api.js';
import { overlay, mapKeyNow, mapInfo, detail, onMapShown, flyTo } from './map.js';

let tasks = [];
const pinned = new Set(JSON.parse(localStorage.getItem('gs-pinned') ?? '[]'));
const done = new Set(JSON.parse(localStorage.getItem('gs-done') ?? '[]'));
const save = () => {
  localStorage.setItem('gs-pinned', JSON.stringify([...pinned]));
  localStorage.setItem('gs-done', JSON.stringify([...done]));
};
const img = (src, cls = '') => (src ? `<img src="${src}" class="${cls}" alt="">` : '');
const mapName = k => k?.replace(/-/g, ' ') ?? 'qualquer mapa';
const itemLine = it => `<span class="chip">${img(it.icon)}${it.name}${it.price ? ` · ${rub(it.price)}` : ''}</span>`;

// ---------- Aba Missões: lista com filtros ----------
function renderList() {
  const q = $('#task-q').value.toLowerCase(), trader = $('#task-trader').value, map = $('#task-map').value, kappa = $('#task-kappa').checked;
  const list = tasks.filter(t => (!q || t.name.toLowerCase().includes(q)) && (!trader || t.trader.name === trader)
    && (!map || t.map === map || t.objectives.some(o => o.maps.includes(map))) && (!kappa || t.kappa));
  $('#task-list').innerHTML = list.slice(0, 120).map(t => `
    <div class="task ${pinned.has(t.id) ? 'pinned' : ''}">
      <div class="task-head">${img(t.trader.image, 'trader')}<div><b>${t.name}</b><br>
        <span class="muted">${t.trader.name} · nível ${t.level}${t.kappa ? ' · Kappa' : ''} · ${mapName(t.map)}</span></div>
        <button data-pin="${t.id}">${pinned.has(t.id) ? 'Soltar do mapa' : 'Fixar no mapa'}</button></div>
      <ul>${t.objectives.map(o => `<li>${o.optional ? '(opcional) ' : ''}${o.text}</li>`).join('')}</ul>
    </div>`).join('') + (list.length > 120 ? `<p class="muted">Mostrando 120 de ${list.length}. Use os filtros.</p>` : '');
  $('#task-list').querySelectorAll('[data-pin]').forEach(b => b.onclick = () => togglePin(b.dataset.pin));
}

function togglePin(id) {
  pinned.has(id) ? pinned.delete(id) : pinned.add(id);
  save();
  renderList();
  renderPanel();
  drawOnMap();
}

// ---------- Painel sobre o mapa: missões fixadas, objetivos marcáveis ----------
function renderPanel() {
  const list = tasks.filter(t => pinned.has(t.id));
  $('#task-panel').hidden = !list.length;
  $('#task-panel').innerHTML = `<b>Missões</b>` + list.map(t => `
    <div class="ptask">
      <div class="task-head">${img(t.trader.image, 'trader small')}<b>${t.name}</b>
        <button class="x" data-unpin="${t.id}" title="Soltar do mapa">×</button></div>
      ${t.objectives.map(o => `<label class="${done.has(o.id) ? 'done' : ''}"><input type="checkbox" data-done="${o.id}" ${done.has(o.id) ? 'checked' : ''}>
        ${o.text}${o.count > 1 ? ` (${o.count})` : ''}${o.fir ? ' <span class="muted">FIR</span>' : ''}</label>
        ${o.items.length ? `<div class="items">${o.items.map(itemLine).join('')}</div>` : ''}`).join('')}
      ${t.keys.length ? `<div class="items">Chaves: ${t.keys.map(itemLine).join('')}</div>` : ''}
      <a href="${t.wiki}" target="_blank" rel="noreferrer">Wiki com fotos e passo a passo</a>
    </div>`).join('');
  $('#task-panel').querySelectorAll('[data-unpin]').forEach(b => b.onclick = () => togglePin(b.dataset.unpin));
  $('#task-panel').querySelectorAll('[data-done]').forEach(c => c.onchange = () => {
    c.checked ? done.add(c.dataset.done) : done.delete(c.dataset.done);
    save();
    renderPanel();
    drawOnMap();
  });
}

// ---------- Marcas no mapa das missões fixadas (só objetivos ainda não feitos) ----------
function drawOnMap() {
  if (!overlay) return;
  overlay.clearLayers();
  const key = mapKeyNow(), info = mapInfo(key);
  for (const t of tasks.filter(t => pinned.has(t.id))) {
    for (const o of t.objectives.filter(o => !done.has(o.id))) {
      const tip = `<b>${t.name}</b><br>${o.text}`;
      for (const z of o.zones.filter(z => z.map === key)) {
        const p = L.polygon(z.outline.map(v => [v.z, v.x]), { color: '#b6f', weight: 2, fillOpacity: 0.2 }).addTo(overlay);
        detail(p, tip);
        // área pequena some no zoom afastado: marcador no centro sempre visível
        const m = L.marker([z.z, z.x], { icon: L.icon({ iconUrl: 'https://tarkov.dev/maps/interactive/quest_objective.png', iconSize: [28, 28], className: 'qicon' }) }).addTo(overlay);
        m.on('click', () => flyTo(z.x, z.z));
        detail(m, tip);
      }
      const qi = o.items.find(i => i.quest);
      for (const l of o.locations.filter(l => l.map === key)) {
        const m = L.marker([l.z, l.x], { icon: L.divIcon({ className: '', html: `<div class="qmark">${img(qi?.icon)}</div>`, iconSize: [26, 26] }) }).addTo(overlay);
        detail(m, `${tip}${qi ? `<div class="row">${img(qi.icon)}<span>${qi.name}</span></div>` : ''}`);
      }
      // itens comuns que a missão pede: pontos de loot do mapa onde eles podem aparecer
      const want = new Set(o.items.filter(i => !i.quest).map(i => i.id));
      if (!want.size || !info?.loot) continue;
      for (const l of info.loot) {
        const its = l.i.map(k => info.lootItems[k]).filter(it => want.has(it.id));
        if (!its.length) continue;
        const m = L.marker([l.z, l.x], { icon: L.icon({ iconUrl: 'https://tarkov.dev/maps/interactive/loose_loot.png', iconSize: [22, 22], className: 'qicon' }) }).addTo(overlay);
        detail(m, `${tip}<br><b>Pode aparecer aqui:</b>${its.map(it => `<div class="row">${img(it.icon)}<span>${it.name}</span></div>`).join('')}`);
      }
    }
  }
}

export async function initMissions() {
  tasks = await fetch('/tasks').then(r => r.json()).catch(() => []);
  if (!tasks.length) return void ($('#task-list').textContent = 'Não consegui carregar as missões do tarkov.dev.');
  tasks.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const traders = [...new Set(tasks.map(t => t.trader.name))].sort();
  $('#task-trader').innerHTML = '<option value="">Todos os traders</option>' + traders.map(n => `<option>${n}</option>`).join('');
  const maps = [...new Set(tasks.map(t => t.map).filter(Boolean))].sort();
  $('#task-map').innerHTML = '<option value="">Todos os mapas</option>' + maps.map(m => `<option value="${m}">${mapName(m)}</option>`).join('');
  for (const id of ['#task-q', '#task-trader', '#task-map', '#task-kappa']) $(id).oninput = renderList;
  renderList();
  renderPanel();
  drawOnMap();
  onMapShown(drawOnMap);
}
