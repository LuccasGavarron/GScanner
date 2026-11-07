import { gql, $, rub } from './api.js';

const QUERY = `query($q: String) { items(name: $q, limit: 20) { name shortName width height avg24hPrice lastLowPrice
  sellFor { priceRUB vendor { name normalizedName } } usedInTasks { name } } }`;

async function search() {
  const q = $('#price-q').value.trim();
  if (q.length < 2) return;
  try {
    const { data, note } = await gql(QUERY, { q });
    if (q !== $('#price-q').value.trim()) return; // chegou resposta de uma busca antiga
    $('#price-status').textContent = note;
    $('#price').innerHTML = '<tr><th>Item</th><th>Flea</th><th>Melhor trader</th><th>Por slot</th><th>Usado em quest</th></tr>' +
      data.items.map(i => {
        const flea = i.lastLowPrice || i.avg24hPrice || 0;
        const trader = (i.sellFor ?? []).filter(s => s.vendor.normalizedName !== 'flea-market')
          .reduce((a, b) => (b.priceRUB > (a?.priceRUB ?? 0) ? b : a), null);
        const best = Math.max(flea, trader?.priceRUB ?? 0);
        const quests = i.usedInTasks.map(t => t.name);
        return `<tr><td title="${i.shortName}">${i.name}</td>
          <td class="${flea && flea >= (trader?.priceRUB ?? 0) ? 'best' : ''}">${rub(flea)}</td>
          <td class="${trader && trader.priceRUB > flea ? 'best' : ''}">${trader ? `${rub(trader.priceRUB)} (${trader.vendor.name})` : '—'}</td>
          <td>${rub(Math.round(best / (i.width * i.height)))}</td>
          <td style="text-align: left">${quests.length ? '⚠ ' + quests.join(', ') : ''}</td></tr>`;
      }).join('');
  } catch (e) {
    $('#price-status').textContent = e.message;
  }
}

export function initPrice() {
  let timer;
  $('#price-q').oninput = () => { clearTimeout(timer); timer = setTimeout(search, 300); };
}
