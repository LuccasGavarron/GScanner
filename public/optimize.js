// Otimizador de build: para cada slot guarda a "fronteira" de opções (custo x pontuação)
// e combina de baixo para cima. Assim respeita o orçamento sem testar todas as combinações.

const K = 40; // pontos guardados por fronteira; mais = mais exato e mais lento

function prune(points) {
  points.sort((a, b) => a.c - b.c || b.s - a.s);
  const out = [];
  for (const p of points) if (!out.length || p.s > out.at(-1).s + 1e-9) out.push(p);
  if (out.length <= K) return out;
  const step = (out.length - 1) / (K - 1);
  return Array.from({ length: K }, (_, i) => out[Math.round(i * step)]);
}

// Preço mais barato que o jogador consegue pagar, ou null se não dá para comprar.
export function priceOf(mod, { level = 4, flea = true }) {
  let best = null;
  for (const o of mod.buyFor ?? []) {
    const ok = o.vendor.normalizedName === 'flea-market' ? flea : (o.vendor.minTraderLevel ?? 1) <= level;
    if (ok && o.priceRUB > 0 && (best === null || o.priceRUB < best.price)) best = { price: o.priceRUB, vendor: o.vendor.normalizedName };
  }
  return best;
}

export const slotsOf = item => item.properties?.slots ?? [];

// Peças que não cabem juntas (conflictingItems): proíbe uma das duas e refaz, ficando com a melhor.
// shortcut: no máximo 4 rodadas (até 16 cálculos); se ainda sobrar conflito, a build volta com conflict: true.
export function optimize(gun, modsById, opts = {}, banned = new Set(), round = 0) {
  const b = best(gun, modsById, opts, banned);
  if (!b) return null;
  const ids = new Set(b.parts.map(p => p.mod.id));
  const clash = b.parts.find(p => (p.mod.conflictingItems ?? []).some(c => ids.has(c.id)));
  if (!clash) return b;
  if (round >= 4) return { ...b, conflict: true };
  const other = clash.mod.conflictingItems.find(c => ids.has(c.id)).id;
  return [clash.mod.id, other].map(id => optimize(gun, modsById, opts, new Set([...banned, id]), round + 1))
    .filter(Boolean).sort((x, y) => (x.conflict ?? false) - (y.conflict ?? false) || y.score - x.score)[0] ?? null;
}

function best(gun, modsById, { budget = Infinity, mode = 'recoil', level = 4, flea = true } = {}, banned) {
  const [wr, we] = { recoil: [1, 0.1], ergo: [0.1, 1], balanced: [1, 1] }[mode];
  const memo = new Map();

  function itemFront(mod, stack) {
    if (memo.has(mod.id)) return memo.get(mod.id);
    const offer = priceOf(mod, { level, flea });
    if (!offer || stack.has(mod.id)) return [];
    stack.add(mod.id);
    const own = { c: offer.price, s: wr * -(mod.recoilModifier ?? 0) + we * (mod.ergonomicsModifier ?? 0), kids: [] };
    const front = combine([own], slotsOf(mod), stack).map(p => ({ ...p, mod, offer }));
    stack.delete(mod.id);
    memo.set(mod.id, front);
    return front;
  }

  function slotFront(slot, stack) {
    const pts = slot.required ? [] : [{ c: 0, s: 0, mod: null, kids: [] }];
    for (const { id } of slot.filters?.allowedItems ?? []) {
      const mod = modsById.get(id);
      if (mod && !banned.has(id)) pts.push(...itemFront(mod, stack));
    }
    return prune(pts);
  }

  function combine(start, slots, stack) {
    let acc = start;
    for (const slot of slots) {
      const sf = slotFront(slot, stack).map(p => ({ ...p, slot: slot.name }));
      const next = [];
      for (const a of acc) for (const b of sf) next.push({ c: a.c + b.c, s: a.s + b.s, kids: [...a.kids, b] });
      acc = prune(next);
    }
    return acc;
  }

  const front = combine([{ c: 0, s: 0, kids: [] }], slotsOf(gun), new Set()).filter(p => p.c <= budget);
  if (!front.length) return null;
  const top = front.reduce((a, b) => (b.s > a.s ? b : a));

  // Totais da build escolhida
  let ergo = gun.properties.ergonomics ?? 0, recoil = 0;
  const parts = [];
  (function walk(kids, depth) {
    for (const k of kids) {
      if (!k.mod) continue;
      ergo += k.mod.ergonomicsModifier ?? 0;
      recoil += k.mod.recoilModifier ?? 0;
      parts.push({ depth, slot: k.slot, mod: k.mod, offer: k.offer });
      walk(k.kids, depth + 1);
    }
  })(top.kids, 0);
  const f = 1 + recoil / 100;
  return {
    cost: top.c, score: top.s, ergo: Math.round(ergo), parts,
    recoilVertical: Math.round(gun.properties.recoilVertical * f),
    recoilHorizontal: Math.round(gun.properties.recoilHorizontal * f),
  };
}
