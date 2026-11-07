// Código usado pelo servidor (Node) e pela página.

// Nome do screenshot do EFT: "2026-11-07[20-15]_123.45, 6.78, -90.12_0.0, 0.7, 0.0, 0.7_15.77 (0).png"
const SHOT = /\d{4}-\d{2}-\d{2}\[\d{2}-\d{2}\]_?(-?\d+\.\d+), (-?\d+\.\d+), (-?\d+\.\d+)_?(-?[\d.]+), (-?[\d.]+), (-?[\d.]+), (-?[\d.]+).* \(\d+\)\.png$/;

export function parseScreenshot(name) {
  const m = SHOT.exec(name);
  if (!m) return null;
  const [x, y, z, rx, ry, rz, rw] = m.slice(1).map(Number);
  // mesma conta do TarkovMonitor (QuarternionsToYaw recebe x, z, y, w)
  const yaw = Math.atan2(2 * (rw * ry + rx * rz), 1 - 2 * (rz * rz + ry * ry)) * 180 / Math.PI;
  return { x, y, z, yaw };
}

// Mapa no application.log, pelo nome padrão (nameId). Toda raid tem "[Transit] ... Locations:bigmap -> "
// (com transição, o mapa atual é o último da lista); raid online também tem
// "TRACE-NetworkGameCreate ... Location: Interchange,". A linha "rcid:" usa nome de cena (Shopping_Mall) e não serve.
export function mapFromLogLine(line) {
  const transit = /\[Transit\].*Locations:(.*)$/.exec(line);
  if (transit) return transit[1].split('->').map(s => s.trim()).filter(Boolean).at(-1) ?? null;
  if (!line.includes('TRACE-NetworkGameCreate')) return null;
  return /Location: ([^,\s]+)/.exec(line)?.[1] ?? null;
}

// Início da raid (relógio começa a contar): "2026-11-07 02:11:03.675|...|application|GameStarted:..." -> ms
export function raidStartFromLogLine(line) {
  if (!line.includes('|application|GameStarted')) return null;
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}\.\d+)/.exec(line);
  return m ? new Date(`${m[1]}T${m[2]}`).getTime() : null;
}

// nameId do jogo -> normalizedName do tarkov.dev
const MAP_IDS = {
  bigmap: 'customs', factory4_day: 'factory', factory4_night: 'factory', woods: 'woods',
  shoreline: 'shoreline', interchange: 'interchange', rezervbase: 'reserve', laboratory: 'the-lab',
  lighthouse: 'lighthouse', tarkovstreets: 'streets-of-tarkov', sandbox: 'ground-zero',
  sandbox_high: 'ground-zero', sandbox_start: 'ground-zero', labyrinth: 'the-labyrinth',
};
export const mapKey = id => MAP_IDS[id.toLowerCase()] ?? id.toLowerCase();

// Índice do andar (layers do maps.json do tarkov.dev) onde está a posição, ou -1 para o térreo.
// extents: [{ height: [min, max], bounds: [[[x1, z1], [x2, z2], nome], ...] }]; sem bounds vale o mapa todo.
// rect: área do prédio onde a posição caiu (para dar zoom nele), ou null quando o andar vale para o mapa todo.
export function floorAt(layers, { x, y, z }) {
  const inside = ([[x1, z1], [x2, z2]]) => x >= Math.min(x1, x2) && x <= Math.max(x1, x2) && z >= Math.min(z1, z2) && z <= Math.max(z1, z2);
  for (const [index, l] of (layers ?? []).entries()) {
    for (const e of l.extents ?? []) {
      if (y < e.height[0] || y >= e.height[1]) continue;
      if (!e.bounds) return { index, rect: null };
      const b = e.bounds.find(inside);
      if (b) return { index, rect: [b[0], b[1]] };
    }
  }
  return { index: -1, rect: null };
}

// shortcut: regra simples pen x classe*10; trocar por chance real de penetração quando houver dados de durabilidade.
export function armorGrade(pen, armorClass) {
  const d = pen - armorClass * 10;
  return d >= 10 ? 3 : d >= 0 ? 2 : d >= -10 ? 1 : 0; // 3 fura fácil, 2 fura, 1 difícil, 0 não fura
}
