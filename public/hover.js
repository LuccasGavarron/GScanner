import { $, rub } from './api.js';

// Cartão do item sob o mouse no jogo (servidor lê a dica do item com OCR)
export function initHover() {
  new EventSource('/events').onmessage = e => {
    const { type, data: h } = JSON.parse(e.data);
    if (type !== 'hover') return;
    $('#hover-card').hidden = !h;
    if (!h) return;
    const fleaWins = (h.flea ?? 0) >= (h.trader?.price ?? 0);
    $('#hover-card').innerHTML = `
      ${h.trader?.image ? `<img src="${h.trader.image}" alt="${h.trader.name}">` : ''}
      <div>
        <b>${h.name}</b>
        <div class="${fleaWins && h.flea ? 'best' : ''}">Flea: ${rub(h.flea)}</div>
        <div class="${!fleaWins ? 'best' : ''}">${h.trader ? `${h.trader.name}: ${rub(h.trader.price)}` : 'Nenhum trader compra'}</div>
        <div class="muted">Por slot: ${rub(h.perSlot)}</div>
        ${h.quests.length ? `<div>⚠ Quest: ${h.quests.join(', ')}</div>` : ''}
      </div>`;
  };
}
