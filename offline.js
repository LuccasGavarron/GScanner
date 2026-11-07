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

// only: um item já achado (hover) em vez da busca por nome
export function price(d, q, only) {
  q = (q ?? '').toLowerCase();
  const tasksByItem = new Map();
  for (const t of Object.values(d.tasks.data.tasks)) {
    for (const o of t.objectives) {
      if (o.type !== 'giveItem') continue;
      for (const id of o.items ?? []) tasksByItem.set(id, [...(tasksByItem.get(id) ?? []), { name: tr(d.tasksEn, t.name) }]);
    }
  }
  return (only ? [only] : items(d)).map(i => ({ i, b: base(d, i) }))
    .filter(({ i, b }) => only || [b.name, b.shortName, tr(d.itemsPt ?? {}, i.name)].some(n => n.toLowerCase().includes(q)))
    .slice(0, 20)
    .map(({ i, b }) => {
      const sellFor = (i.sellToTrader ?? []).map(o => { const n = traderOf(d, o.trader); return { priceRUB: o.priceRUB, vendor: { name: vendorName(n), normalizedName: n } }; });
      return { ...b, width: i.width, height: i.height, avg24hPrice: i.avg24hPrice, lastLowPrice: fleaPrice(i) || null, sellFor, usedInTasks: tasksByItem.get(i.id) ?? [] };
    });
}

// ---------- Hover: nome lido pelo OCR -> item ----------
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const indexes = new WeakMap();
function nameIndex(d) {
  if (!indexes.has(d)) {
    const idx = new Map();
    for (const i of items(d)) {
      for (const en of [d.itemsPt, d.itemsEn]) {
        const n = norm(tr(en ?? {}, i.name));
        if (n.length >= 5 && !idx.has(n)) idx.set(n, i); // nome curto (ex.: "MRS" da grade) gera falso positivo
      }
    }
    indexes.set(d, idx);
  }
  return indexes.get(d);
}

// Acha o item pelas linhas lidas. Aceita até 15% de letras erradas, para erros do OCR.
export function findItem(d, lines) {
  const idx = nameIndex(d);
  let best = null;
  for (const line of lines) {
    const n = norm(line);
    if (n.length < 5) continue;
    if (idx.has(n)) return idx.get(n);
    for (const [name, item] of idx) {
      if (Math.abs(name.length - n.length) > n.length * 0.15) continue;
      const score = 1 - lev(n, name) / Math.max(n.length, name.length);
      if (score >= 0.85 && (!best || score > best.score)) best = { score, item };
    }
  }
  return best?.item ?? null;
}

export function hoverInfo(d, i) {
  const [p] = price(d, null, i);
  const top = p.sellFor.reduce((a, b) => (b.priceRUB > (a?.priceRUB ?? 0) ? b : a), null);
  const trader = top && Object.values(d.traders.data).find(t => t.normalizedName === top.vendor.normalizedName);
  const best = Math.max(p.lastLowPrice ?? 0, top?.priceRUB ?? 0);
  return {
    name: d.itemsPt ? tr(d.itemsPt, i.name) : p.name, flea: p.lastLowPrice,
    trader: top && { name: top.vendor.name, price: top.priceRUB, image: trader?.imageLink },
    perSlot: Math.round(best / (i.width * i.height)), quests: p.usedInTasks.map(t => t.name),
  };
}

// Descobre a aba pela consulta GraphQL que ela manda.
export function answer(d, { query, variables }) {
  if (query.includes('guns:')) return build(d);
  if (query.includes('ammo {')) return { ammo: ammo(d) };
  if (query.includes('items(name:')) return { items: price(d, variables?.q) };
  return null;
}
