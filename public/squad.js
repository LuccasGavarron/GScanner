import { $, onEvent } from './api.js';

// Painel do grupo: criar (anfitrião, gera o código de convite) ou entrar com o código de um amigo
let state = {}, members = [];
const post = (url, body = {}) => fetch(url, { method: 'POST', body: JSON.stringify(body) }).then(async r => ({ ok: r.ok, ...(await r.json().catch(() => ({}))) }));

function render() {
  const s = state, name = $('#sq-name')?.value ?? s.name ?? '';
  const others = members.filter(m => m.name !== s.name);
  $('#squad-panel').innerHTML = `
    <b>Grupo</b>
    <label>Seu nome <input id="sq-name" maxlength="20" value="${name.replace(/"/g, '&quot;')}"></label>
    ${s.host ? `
      <p>Você é o anfitrião. Mande este código para os amigos:</p>
      <div class="row"><input id="sq-code" readonly value="${s.code}"><button id="sq-copy">Copiar</button></div>
      <button id="sq-leave" class="link">Desfazer o grupo</button>`
    : s.joined ? `
      <p>Você está no grupo de um amigo.</p>
      <button id="sq-leave" class="link">Sair do grupo</button>`
    : `
      <button id="sq-host">Criar grupo</button>
      <p class="muted">ou cole o código que um amigo mandou:</p>
      <div class="row"><input id="sq-join-code" placeholder="GS-..."><button id="sq-join">Entrar</button></div>`}
    <p id="sq-msg" class="muted"></p>
    ${s.host || s.joined ? `<p class="muted">${others.length ? 'No mapa agora: ' + others.map(m => m.name).join(', ') : 'Nenhum amigo conectado ainda.'}</p>` : ''}`;
  const act = async (url, body) => {
    const r = await post(url, { name: $('#sq-name').value, ...body });
    if (!r.ok) return void ($('#sq-msg').textContent = r.error ?? 'Não deu certo.');
    state = r;
    render();
  };
  $('#sq-host') && ($('#sq-host').onclick = () => act('/squad/host'));
  $('#sq-join') && ($('#sq-join').onclick = () => act('/squad/join', { code: $('#sq-join-code').value }));
  $('#sq-leave') && ($('#sq-leave').onclick = () => act('/squad/leave'));
  $('#sq-copy') && ($('#sq-copy').onclick = () => { navigator.clipboard.writeText(s.code); $('#sq-msg').textContent = 'Código copiado.'; });
}

export async function initSquad() {
  $('#squad-btn').onclick = () => { $('#squad-panel').hidden = !$('#squad-panel').hidden; render(); };
  // ouve antes de qualquer espera: a lista do grupo chega logo que a página conecta
  onEvent((type, data) => { if (type === 'squad') { members = data; if (!$('#squad-panel').hidden) render(); } });
  state = await post('/squad/status');
  render();
}
