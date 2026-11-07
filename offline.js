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
      for (const id of o.items ?? []) tasksByItem.set(id, [...(tasksByItem.get(id) ?? []), { name: tr(d.tasksPt ?? d.tasksEn, t.name) }]);
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

// ---------- Mapa: tudo o que dá para mostrar em cada mapa, com os detalhes do hover ----------
// maps/en: json.tarkov.dev/regular/maps e maps_en; d: dados de itens (para nome, ícone e preço das chaves), pode faltar.
export function mapLayers(maps, en, d, mapKey) {
  const t = k => en[k] ?? k;
  const pos = p => ({ x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 });
  const itemById = d && new Map(items(d).map(i => [i.id, i]));
  const out = {};
  for (const m of Object.values(maps.data.maps)) {
    const key = mapKey(m.nameId);
    if (out[key]) continue; // variantes (noite, lab escuro) usam o mesmo mapa
    out[key] = {
      duration: m.raidDuration,
      points: [
        ...m.extracts.map(e => ({ name: t(e.name), faction: e.faction, needsSwitch: !!e.switch, ...pos(e.position) })),
        ...m.transits.map(x => ({ name: t(x.description), faction: 'transit', ...pos(x.position) })),
      ],
      locks: m.locks.map(l => {
        const k = itemById?.get(l.key);
        return { key: k ? tr(d.itemsPt ?? d.itemsEn, k.name) : 'Chave', icon: k?.iconLink, price: k ? fleaPrice(k) || null : null, needsPower: l.needsPower, ...pos(l.position) };
      }),
      hazards: m.hazards.map(h => ({ name: t(h.name), outline: h.outline.map(pos) })),
      bosses: m.bosses.filter(b => b.spawnChance > 0).flatMap(b => {
        const mob = maps.data.mobs[b.mob];
        return b.spawnLocations.flatMap(l => l.positions.map(p => ({
          name: t(mob?.name ?? b.mob), portrait: mob?.imagePortraitLink, chance: b.spawnChance, zone: t(l.name), zoneChance: l.chance, ...pos(p),
        })));
      }),
      switches: m.switches.map(s => pos(s.position)),
      containers: m.lootContainers.map(c => ({ name: t(maps.data.lootContainers[c.lootContainer]?.name), type: maps.data.lootContainers[c.lootContainer]?.normalizedName, ...pos(c.position) })),
      weapons: m.stationaryWeapons.map(w => ({ name: t(maps.data.stationaryWeapons[w.stationaryWeapon]?.name), ...pos(w.position) })),
      spawns: m.spawns.filter(s => s.categories.includes('player')).map(s => ({ sides: s.sides, ...pos(s.position) })),
    };
    // Loot solto: cada ponto aponta para itens de uma lista única por mapa (economiza tamanho)
    if (itemById) {
      const list = [], at = new Map();
      out[key].loot = (m.lootLoose ?? []).map(l => ({
        ...pos(l.position),
        i: l.items.filter(id => itemById.has(id)).map(id => {
          if (!at.has(id)) {
            const it = itemById.get(id);
            at.set(id, list.push({ id, name: tr(d.itemsPt ?? d.itemsEn, it.name), icon: it.iconLink, price: fleaPrice(it) || 0 }) - 1);
          }
          return at.get(id);
        }),
      }));
      out[key].lootItems = list;
    }
  }
  return out;
}

// ---------- Missões: tudo o que o painel do mapa precisa, em português quando houver ----------
export function tasks(d, maps, mapKey) {
  const T = k => tr(d.tasksPt ?? {}, k) === k ? tr(d.tasksEn, k) : tr(d.tasksPt, k);
  const keyOfMap = new Map(Object.values(maps.data.maps).map(m => [m.id, mapKey(m.nameId)]));
  const itemById = new Map(items(d).map(i => [i.id, i]));
  const item = id => {
    const i = itemById.get(id);
    if (i) return { id, name: tr(d.itemsPt ?? d.itemsEn, i.name), icon: i.iconLink, price: fleaPrice(i) || null };
    const q = d.tasks.data.questItems[id];
    return q ? { id, name: T(q.name), icon: q.iconLink, quest: true } : null;
  };
  const traders = d.traders.data;
  const pos = p => ({ x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 });
  return Object.values(d.tasks.data.tasks).map(t => ({
    id: t.id, name: T(t.name), image: t.taskImageLink, wiki: t.wikiLink, level: t.minPlayerLevel, kappa: t.kappaRequired,
    trader: { name: vendorName(traders[t.trader]?.normalizedName ?? ''), image: traders[t.trader]?.imageLink },
    map: keyOfMap.get(t.map) ?? null,
    keys: (t.neededKeys ?? []).flatMap(k => k.keys.map(id => ({ ...item(id), map: keyOfMap.get(k.map) }))),
    objectives: t.objectives.map(o => ({
      id: o.id, type: o.type, text: T(o.description), optional: o.optional, count: o.count ?? 1, fir: !!o.foundInRaid,
      items: [...(o.items ?? []).slice(0, 6), o.questItem, o.markerItem].filter(Boolean).map(item).filter(Boolean),
      zones: (o.zones ?? []).map(z => ({ map: keyOfMap.get(z.map), outline: z.outline.map(pos), ...pos(z.position) })),
      locations: (o.possibleLocations ?? []).flatMap(l => l.positions.map(p => ({ map: keyOfMap.get(l.map), ...pos(p) }))),
      maps: (o.maps ?? []).map(id => keyOfMap.get(id)).filter(Boolean),
    })),
  }));
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
  // nome comprido quebra em duas linhas na dica do jogo: tenta também cada par de linhas vizinhas
  const tries = [...lines, ...lines.slice(1).map((l, i) => lines[i] + ' ' + l)];
  for (const line of tries) {
    const n = norm(line);
    if (n.length < 5) continue;
    if (idx.has(n)) return idx.get(n);
    for (const [name, item] of idx) {
      if (n.length < 10 || Math.abs(name.length - n.length) > n.length * 0.15) continue; // nome curto: só exato
      const score = 1 - lev(n, name) / Math.max(n.length, name.length);
      if (score >= 0.88 && (!best || score > best.score)) best = { score, item };
    }
  }
  return best?.item ?? null;
}

// Só o texto colado ao cursor: a dica do jogo nasce ali (à direita, um pouco acima). Fora dessa área há rótulos
// da tela ("SLOT ESPECIAL", "Gravado") que viravam item errado na busca aproximada.
export const nearCursor = boxes => boxes.filter(b => Array.isArray(b) && b[1] >= -20 && b[1] <= 160 && b[2] >= -140 && b[2] <= 60);

// Rótulo curto do item na grade ("Berkut", "MRS"): aparece na hora, antes da dica do jogo (que demora ~0,5 s).
// boxes: [texto, esquerda, topo, direita, base] com o cursor em (0, 0). O rótulo fica no canto de cima à direita
// do item: acima do cursor e com a borda direita à direita dele. Fica o mais próximo acima; empate, o mais à esquerda.
const shortIndexes = new WeakMap();
export function pickByLabel(d, boxes) {
  if (!shortIndexes.has(d)) {
    // português primeiro (o jogo está em pt); o inglês só preenche nomes que o português não tem
    const byLang = lang => {
      const m = new Map();
      for (const i of items(d)) {
        const n = norm(tr(lang ?? {}, i.shortName));
        if (n.length < 2) continue;
        const prev = m.get(n);
        m.set(n, prev && prev !== i ? 'ambíguo' : i); // nome curto repetido: não dá para saber qual é
      }
      return m;
    };
    const idx = byLang(d.itemsPt);
    for (const [n, v] of byLang(d.itemsEn)) if (!idx.has(n)) idx.set(n, v);
    shortIndexes.set(d, idx);
  }
  const idx = shortIndexes.get(d);
  const hits = boxes.filter(([t, , top, right]) => top <= 0 && top >= -330 && right >= 0 && right <= 330 && idx.get(norm(t)) instanceof Object && idx.get(norm(t)) !== 'ambíguo')
    .sort((a, b) => b[2] - a[2] || a[3] - b[3]);
  return hits.length ? idx.get(norm(hits[0][0])) : null;
}

// Em raid, mirando num item no chão: o jogo escreve o nome curto logo abaixo da mira ("T-45M1").
// boxes vêm de um retângulo pequeno no centro da tela, com o centro em (0, 0). Vale nome completo ou nome curto único,
// o mais perto da mira.
export function raidPick(d, boxes) {
  pickByLabel(d, []); // garante o índice de nomes curtos
  const shorts = shortIndexes.get(d), full = nameIndex(d);
  const hits = boxes.map(b => {
    const n = norm(b[0]), s = shorts.get(n);
    return { item: full.get(n) ?? (s instanceof Object ? s : null), dist: Math.hypot((b[1] + b[3]) / 2, (b[2] + b[4]) / 2) };
  }).filter(h => h.item).sort((a, b) => a.dist - b.dist);
  return hits[0]?.item ?? null;
}

export function hoverInfo(d, i) {
  const [p] = price(d, null, i);
  const top = p.sellFor.reduce((a, b) => (b.priceRUB > (a?.priceRUB ?? 0) ? b : a), null);
  const trader = top && Object.values(d.traders.data).find(t => t.normalizedName === top.vendor.normalizedName);
  const best = Math.max(p.lastLowPrice ?? 0, top?.priceRUB ?? 0);
  return {
    name: d.itemsPt ? tr(d.itemsPt, i.name) : p.name, flea: p.lastLowPrice,
    trader: top && { name: top.vendor.name, price: top.priceRUB, image: trader?.imageLink, portrait: `https://tarkov.dev/images/traders/${top.vendor.normalizedName}-portrait.png` },
    perSlot: Math.round(best / (i.width * i.height)), quests: [...new Set(p.usedInTasks.map(t => t.name))], // uma vez por quest, não por objetivo
    ...gearInfo(d, i),
  };
}

// Pente: munições que aceita. Arma: munições e pentes. Ícone em JPG (o overlay do Windows não abre WebP).
function gearInfo(d, i) {
  const pr = i.properties;
  // Mochila e colete de carga: espaço dentro x espaço que ocupa (para decidir a troca). Armadura e capacete: proteção.
  const pct = v => `${Math.round((v ?? 0) * 100)}%`;
  const kg = `${i.weight} kg`;
  if (['ItemPropertiesBackpack', 'ItemPropertiesChestRig'].includes(pr?.propertiesType) && pr.capacity) {
    const out = i.width * i.height;
    return { stats: [
      `Espaço dentro: ${pr.capacity} · ocupa ${i.width}x${i.height} (${out}) · rende ${(pr.capacity / out).toFixed(1)}x`,
      `${pr.class ? `Classe ${pr.class} · durabilidade ${pr.durability} · ` : ''}Peso ${kg} · velocidade ${pct(pr.speedPenalty)} · ergonomia ${pct(pr.ergoPenalty)}`,
    ] };
  }
  if (['ItemPropertiesArmor', 'ItemPropertiesHelmet'].includes(pr?.propertiesType)) {
    return { stats: [
      `Classe ${pr.class} · durabilidade ${pr.durability}${pr.armorType ? ` · ${pr.armorType === 'Heavy' ? 'pesado' : pr.armorType === 'Light' ? 'leve' : 'sem som abafado'}` : ''}`,
      `Peso ${kg} · velocidade ${pct(pr.speedPenalty)} · giro ${pct(pr.turnPenalty)} · ergonomia ${pct(pr.ergoPenalty)}`,
    ] };
  }
  if (!pr || !['ItemPropertiesMagazine', 'ItemPropertiesWeapon'].includes(pr.propertiesType)) return {};
  const byId = new Map(items(d).map(x => [x.id, x]));
  const name = x => tr(d.itemsPt ?? d.itemsEn, x.shortName);
  const icon = id => `https://assets.tarkov.dev/${id}-icon.jpg`;
  const ammo = (pr.allowedAmmo ?? []).map(id => byId.get(id)).filter(a => a?.properties?.penetrationPower != null)
    .sort((a, b) => b.properties.penetrationPower - a.properties.penetrationPower).slice(0, 8)
    .map(a => ({ name: name(a), icon: icon(a.id), pen: a.properties.penetrationPower, dmg: a.properties.damage * (a.properties.projectileCount || 1) }));
  const magSlot = pr.slots?.find(s => s.nameId === 'mod_magazine');
  const mags = (magSlot?.filters?.allowedItems ?? []).map(id => byId.get(id)).filter(Boolean)
    .sort((a, b) => (b.properties?.capacity ?? 0) - (a.properties?.capacity ?? 0)).slice(0, 6)
    .map(m => ({ name: name(m), icon: icon(m.id), cap: m.properties?.capacity }));
  return { ammo, mags };
}

// Descobre a aba pela consulta GraphQL que ela manda.
export function answer(d, { query, variables }) {
  if (query.includes('guns:')) return build(d);
  if (query.includes('ammo {')) return { ammo: ammo(d) };
  if (query.includes('items(name:')) return { items: price(d, variables?.q) };
  return null;
}

// ---------- Código de convite do grupo: "GS-" + base64url de { u: endereço do anfitrião, k: senha } ----------
export const encodeInvite = (u, k) => 'GS-' + Buffer.from(JSON.stringify({ u, k })).toString('base64url');
export function decodeInvite(code) {
  try {
    const { u, k } = JSON.parse(Buffer.from(String(code).trim().replace(/^GS-/, ''), 'base64url').toString());
    return /^https?:\/\/[\w.\-[\]:]+$/.test(u) && typeof k === 'string' && k.length >= 8 && k.length <= 64 ? { u, k } : null;
  } catch { return null; }
}
