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

// Mapa no application.log. 1.0+: "scene preset path:maps/customs_preset.bundle rcid:bigmap.scenespreset.asset"
// Antes da 1.0: "... TRACE-NetworkGameCreate profileStatus ... Location: bigmap, ..."
export function mapFromLogLine(line) {
  const scene = /rcid:(\w+)\.scenespreset/.exec(line);
  if (scene) return scene[1];
  if (!line.includes('TRACE-NetworkGameCreate')) return null;
  return /Location: ([^,\s]+)/.exec(line)?.[1] ?? null;
}

// nameId do jogo -> normalizedName do tarkov.dev
const MAP_IDS = {
  bigmap: 'customs', factory4_day: 'factory', factory4_night: 'factory', woods: 'woods',
  shoreline: 'shoreline', interchange: 'interchange', rezervbase: 'reserve', laboratory: 'the-lab',
  lighthouse: 'lighthouse', tarkovstreets: 'streets-of-tarkov', sandbox: 'ground-zero',
  sandbox_high: 'ground-zero', labyrinth: 'the-labyrinth',
};
export const mapKey = id => MAP_IDS[id.toLowerCase()] ?? id.toLowerCase();

// Índice do andar (layers do maps.json do tarkov.dev) onde está a posição, ou -1 para o térreo.
// extents: [{ height: [min, max], bounds: [[[x1, z1], [x2, z2], nome], ...] }]; sem bounds vale o mapa todo.
export function floorAt(layers, { x, y, z }) {
  const inside = ([[x1, z1], [x2, z2]]) => x >= Math.min(x1, x2) && x <= Math.max(x1, x2) && z >= Math.min(z1, z2) && z <= Math.max(z1, z2);
  return (layers ?? []).findIndex(l => l.extents?.some(e => y >= e.height[0] && y < e.height[1] && (!e.bounds || e.bounds.some(inside))));
}

// shortcut: regra simples pen x classe*10; trocar por chance real de penetração quando houver dados de durabilidade.
export function armorGrade(pen, armorClass) {
  const d = pen - armorClass * 10;
  return d >= 10 ? 3 : d >= 0 ? 2 : d >= -10 ? 1 : 0; // 3 fura fácil, 2 fura, 1 difícil, 0 não fura
}
