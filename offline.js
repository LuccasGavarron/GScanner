// Respostas das abas montadas a partir da cópia JSON do site do tarkov.dev (json.tarkov.dev/regular/*),
// no mesmo formato da API GraphQL. Usado quando a API cai.
// d = { items, itemsEn, traders, tasks, tasksEn } como vêm do site.

const tr = (en, key) => en[key] ?? key;
const vendorName = n => n.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const fleaPrice = i => (i.types.includes('noFlea') ? 0 : i.lastLowPrice || i.avg24hPrice || 0);

function base(d, i) {
  return { id: i.id, name: tr(d.itemsEn, i.name), shortName: tr(d.itemsEn, i.shortName) };
}
const slots = (d, s) => (s ?? []).map(x => ({
  name: tr(d.itemsEn, x.name), nameId: x.nameId, required: x.required,
  filters: { allowedItems: (x.filters?.allowedItems ?? []).map(id => ({ id })) },
}));
const items = d => Object.values(d.items.data.items);
const traderOf = (d, id) => d.traders.data[id]?.normalizedName ?? id;

export function ammo(d) {
  return items(d).filter(i => i.properties?.propertiesType === 'ItemPropertiesAmmo').map(i => {
    const p = i.properties;
    const trader = Math.min(...(i.buyFromTrader ?? []).map(o => o.priceRUB).filter(Boolean));
    return {
      caliber: p.caliber, damage: p.damage, penetrationPower: p.penetrationPower, armorDamage: p.armorDamage,
      fragmentationChance: p.fragmentationChance, initialSpeed: p.initialSpeed, projectileCount: p.projectileCount,
      // sem flea (muita munição é proibida lá): usa o trader mais barato
      item: { ...base(d, i), avg24hPrice: fleaPrice(i) || (isFinite(trader) ? trader : null) },
    };
  });
}

export function build(d) {
  const all = items(d);
  const guns = all.filter(i => i.properties?.propertiesType === 'ItemPropertiesWeapon').map(i => ({
    ...base(d, i), properties: { ergonomics: i.properties.ergonomics, recoilVertical: i.properties.recoilVertical, recoilHorizontal: i.properties.recoilHorizontal, slots: slots(d, i.properties.slots) },
  }));
  const mods = all.filter(i => i.types.includes('mods')).map(i => {
    const buyFor = (i.buyFromTrader ?? []).map(o => ({ priceRUB: o.priceRUB, vendor: { normalizedName: traderOf(d, o.trader), minTraderLevel: o.minTraderLevel } }));
    if (fleaPrice(i)) buyFor.push({ priceRUB: fleaPrice(i), vendor: { normalizedName: 'flea-market' } });
    return { ...base(d, i), ergonomicsModifier: i.ergonomicsModifier, recoilModifier: i.recoilModifier, buyFor, conflictingItems: (i.conflictingItems ?? []).map(id => ({ id })), properties: { slots: slots(d, i.properties?.slots) } };
  });
  return { guns, mods };
}

export function price(d, q) {
  q = (q ?? '').toLowerCase();
  const tasksByItem = new Map();
  for (const t of Object.values(d.tasks.data.tasks)) {
    for (const o of t.objectives) {
      if (o.type !== 'giveItem') continue;
      for (const id of o.items ?? []) tasksByItem.set(id, [...(tasksByItem.get(id) ?? []), { name: tr(d.tasksEn, t.name) }]);
    }
  }
  return items(d).map(i => ({ i, b: base(d, i) }))
    .filter(({ b }) => b.name.toLowerCase().includes(q) || b.shortName.toLowerCase().includes(q))
    .slice(0, 20)
    .map(({ i, b }) => {
      const sellFor = (i.sellToTrader ?? []).map(o => { const n = traderOf(d, o.trader); return { priceRUB: o.priceRUB, vendor: { name: vendorName(n), normalizedName: n } }; });
      return { ...b, width: i.width, height: i.height, avg24hPrice: i.avg24hPrice, lastLowPrice: fleaPrice(i) || null, sellFor, usedInTasks: tasksByItem.get(i.id) ?? [] };
    });
}

// Descobre a aba pela consulta GraphQL que ela manda.
export function answer(d, { query, variables }) {
  if (query.includes('guns:')) return build(d);
  if (query.includes('ammo {')) return { ammo: ammo(d) };
  if (query.includes('items(name:')) return { items: price(d, variables?.q) };
  return null;
}
