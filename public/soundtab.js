import { $ } from './api.js';
import { suggestEq } from './sound.js';

// A gravação roda no servidor (som direto do Windows); a página só liga, acompanha e desliga.
let timer;
const post = url => fetch(url, { method: 'POST' }).then(r => r.json());

async function start() {
  await post('/sound/start');
  $('#sound-go').textContent = 'Parar e analisar';
  timer = setInterval(async () => {
    const s = await post('/sound/status');
    if (s.error) return stop();
    $('#sound-status').textContent = `Gravando: ${s.secs} s.`;
  }, 1000);
}

async function stop() {
  clearInterval(timer);
  timer = null;
  $('#sound-go').textContent = 'Gravar som do PC';
  const { profile: p, secs, error } = await post('/sound/stop');
  if (error) return void ($('#sound-status').textContent = error);
  if (!p) return void ($('#sound-status').textContent = 'Pouco som gravado. Grave uns 30 s andando.');
  p.note = `${p.events} momentos de passo em ${secs} s, gravado em ${new Date().toLocaleString('pt-BR')}.`;
  localStorage.setItem('gs-sound-' + $('#sound-profile').value, JSON.stringify(p));
  render(p);
}

// Cada perfil (sem chuva / com chuva) guarda a última medição
function showSaved() {
  const p = JSON.parse(localStorage.getItem('gs-sound-' + $('#sound-profile').value) ?? 'null');
  $('#sound-result').hidden = !p;
  $('#sound-status').textContent = p ? p.note : 'Este perfil ainda não tem medição.';
  if (p) render(p);
}

export function render(p) {
  const max = Math.max(1, ...p.diff.map(d => d.db));
  const top = [...p.diff].filter(d => d.f >= 800 && d.f <= 6300).sort((a, b) => b.db - a.db).slice(0, 3).map(d => d.f);
  const label = f => (f >= 1000 ? f / 1000 + 'k' : f);
  $('#sound-chart').innerHTML = p.diff.map(d => `
    <div class="sbar" title="${label(d.f)} Hz: passos ${d.db} dB acima do fundo">
      <span class="v">${top.includes(d.f) ? '+' + d.db : ''}</span>
      <div style="height: ${Math.max(0, d.db) / max * 140}px"></div>
      <span class="f">${label(d.f)}</span>
    </div>`).join('');
  $('#sound-eq').textContent = suggestEq(p.diff);
  $('#sound-result').hidden = false;
}

export function initSound() {
  $('#sound-go').onclick = () => (timer ? stop() : start());
  $('#sound-copy').onclick = () => navigator.clipboard.writeText($('#sound-eq').textContent);
  $('#sound-profile').onchange = showSaved;
  showSaved();
}
