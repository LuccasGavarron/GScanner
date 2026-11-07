import { gql, $, rub } from './api.js';
import { optimize } from './optimize.js';

const S = 'name nameId required filters { allowedItems { id } }';
const QUERY = `{
  guns: items(type: gun) { id name shortName properties { ... on ItemPropertiesWeapon { ergonomics recoilVertical recoilHorizontal slots { ${S} } } } }
  mods: items(type: mods) { id name shortName ergonomicsModifier recoilModifier
    buyFor { priceRUB vendor { normalizedName ... on TraderOffer { minTraderLevel } } }
    properties { ... on ItemPropertiesWeaponMod { slots { ${S} } } ... on ItemPropertiesBarrel { slots { ${S} } }
      ... on ItemPropertiesMagazine { slots { ${S} } } ... on ItemPropertiesScope { slots { ${S} } } } }
}`;

let guns = [], modsById = new Map();
const vendor = v => v.replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase());
const signed = n => (n > 0 ? '+' : '') + (n ?? 0);

function run() {
  const gun = guns.find(g => g.id === $('#gun').value);
  const budget = Number($('#budget').value) || Infinity;
  const b = optimize(gun, modsById, { budget, mode: $('#mode').value, level: +$('#level').value, flea: $('#flea').checked });
  if (!b) return void ($('#build-out').innerHTML = '<p>Nenhuma build cabe nesses filtros. Aumente o orçamento ou o nível dos traders.</p>');
  const rows = b.parts.map(p => `<tr><td style="padding-left:${8 + p.depth * 16}px">${p.slot}</td><td>${p.mod.name}</td>
    <td>${signed(p.mod.recoilModifier)}%</td><td>${signed(p.mod.ergonomicsModifier)}</td><td>${rub(p.offer.price)}</td><td>${vendor(p.offer.vendor)}</td></tr>`).join('');
  $('#build-out').innerHTML = `<p><b>Ergonomia ${b.ergo} · Recuo vertical ${b.recoilVertical} · Recuo horizontal ${b.recoilHorizontal} · Custo das peças ${rub(b.cost)}</b></p>
    <table><tr><th>Slot</th><th>Peça</th><th>Recuo</th><th>Ergo</th><th>Preço</th><th>Onde comprar</th></tr>${rows}</table>
    <p class="muted">Confira no jogo se duas peças não conflitam entre si: o otimizador ainda não checa isso.</p>`;
}

export async function initBuild() {
  try {
    const { data, note } = await gql(QUERY);
    guns = data.guns.filter(g => g.properties?.slots).sort((a, b) => a.name.localeCompare(b.name));
    modsById = new Map(data.mods.map(m => [m.id, m]));
    $('#build-status').textContent = note;
  } catch (e) {
    $('#build-status').textContent = e.message;
    return;
  }
  $('#gun').innerHTML = guns.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
  $('#build-go').onclick = run;
}
