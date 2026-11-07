import { $ } from './api.js';
import { toBands, footstepProfile, suggestEq } from './sound.js';

let stream, ctx, frames = [];
const secs = () => Math.round(frames.length * 2048 / (ctx?.sampleRate ?? 48000));

async function start() {
  try {
    // systemAudio: o navegador oferece "compartilhar áudio do sistema" ao escolher a tela
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, systemAudio: 'include' });
  } catch (e) {
    console.error('getDisplayMedia', e);
    const why = e.name === 'NotAllowedError' ? 'a janela de escolha foi fechada ou o Chrome bloqueou a captura' : e.message;
    return void ($('#sound-status').textContent = `Não gravou: ${why} (${e.name}).`);
  }
  if (!stream.getAudioTracks().length) {
    stream.getTracks().forEach(t => t.stop());
    return void ($('#sound-status').textContent = 'Sem áudio: escolha "Tela inteira" e marque "Compartilhar áudio do sistema".');
  }
  stream.getVideoTracks().forEach(t => t.stop()); // só o som interessa
  ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 4096;
  an.smoothingTimeConstant = 0;
  // ScriptProcessor roda no fio de áudio: continua medindo com a janela em segundo plano
  const proc = ctx.createScriptProcessor(2048, 1, 1);
  const buf = new Float32Array(an.frequencyBinCount);
  proc.onaudioprocess = () => {
    an.getFloatFrequencyData(buf);
    frames.push(toBands(buf, ctx.sampleRate, an.fftSize));
    if (frames.length % 20 === 0) $('#sound-status').textContent = `Gravando: ${secs()} s.`;
  };
  frames = [];
  src.connect(an);
  src.connect(proc);
  proc.connect(ctx.destination); // saída fica em silêncio; a conexão só faz o processador rodar
  $('#sound-go').textContent = 'Parar e analisar';
}

function stop() {
  stream.getTracks().forEach(t => t.stop());
  ctx.close();
  stream = null;
  $('#sound-go').textContent = 'Gravar som do PC';
  const p = footstepProfile(frames);
  if (!p) return void ($('#sound-status').textContent = 'Pouco som gravado. Grave uns 30 s andando.');
  p.note = `${p.events} momentos de passo em ${secs()} s, gravado em ${new Date().toLocaleString('pt-BR')}.`;
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
  $('#sound-go').onclick = () => (stream ? stop() : start());
  $('#sound-copy').onclick = () => navigator.clipboard.writeText($('#sound-eq').textContent);
  $('#sound-profile').onchange = showSaved;
  showSaved();
}
