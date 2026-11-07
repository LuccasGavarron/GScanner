import { armorGrade } from './shared.js';
import { gql, $, rub } from './api.js';

const QUERY = `{ ammo { caliber damage penetrationPower armorDamage fragmentationChance initialSpeed projectileCount
  item { name shortName avg24hPrice } } }`;

const COLS = [
  ['Munição', a => a.item.shortName], ['Dano', a => a.damage * (a.projectileCount || 1)], ['Pen', a => a.penetrationPower],
  ['Dano armadura', a => a.armorDamage], ['Frag %', a => Math.round(a.fragmentationChance * 100)],
  ['Vel. m/s', a => a.initialSpeed], ['Preço', a => a.item.avg24hPrice || 0],
];
let list = [], sortCol = 2;

function render() {
  const rows = list.filter(a => a.caliber === $('#caliber').value)
    .sort((a, b) => COLS[sortCol][1](b) - COLS[sortCol][1](a) || 0);
  const head = COLS.map(([n], i) => `<th data-i="${i}">${n}${i === sortCol ? ' ▼' : ''}</th>`).join('') +
    [1, 2, 3, 4, 5, 6].map(c => `<th title="Classe de armadura">C${c}</th>`).join('');
  const body = rows.map(a => '<tr>' +
    COLS.map(([, f], i) => `<td title="${i ? '' : a.item.name}">${
      i === 6 ? rub(f(a)) :
      i === 1 && a.projectileCount > 1 ? `${a.damage}×${a.projectileCount}` : f(a)}</td>`).join('') +
    [1, 2, 3, 4, 5, 6].map(c => `<td class="g${armorGrade(a.penetrationPower, c)}"></td>`).join('') + '</tr>').join('');
  $('#ammo').innerHTML = `<tr>${head}</tr>${body}`;
  $('#ammo').querySelectorAll('th[data-i]').forEach(th => th.onclick = () => { sortCol = +th.dataset.i; render(); });
}

export async function initAmmo() {
  try {
    const { data, note } = await gql(QUERY);
    list = data.ammo;
    $('#ammo-status').textContent = note + ' Cores: verde fura fácil, amarelo fura, laranja difícil, vermelho não fura.';
  } catch (e) {
    $('#ammo-status').textContent = e.message;
    return;
  }
  const calibers = [...new Set(list.map(a => a.caliber))].sort();
  $('#caliber').innerHTML = calibers.map(c => `<option value="${c}">${c.replace(/^Caliber/, '')}</option>`).join('');
  $('#caliber').onchange = render;
  if (calibers.length) render();
}
