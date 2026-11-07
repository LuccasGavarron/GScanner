import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { parseScreenshot, mapFromLogLine, mapKey } from './public/shared.js';

const PORT = Number(process.env.PORT) || 7777;
const PUBLIC = path.join(import.meta.dirname, 'public');

function reg(key, value) {
  try { return execSync(`reg query "${key}" /v ${value}`, { encoding: 'utf8' }).match(/REG_\w+\s+(.+)/)?.[1].trim(); } catch { return undefined; }
}
const docs = reg('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders', 'Personal') ?? path.join(os.homedir(), 'Documents');
const install = reg('HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EscapeFromTarkov', 'InstallLocation') ?? 'C:\\Battlestate Games\\Escape from Tarkov';
const SHOTS = process.env.EFT_SCREENSHOTS ?? path.join(docs, 'Escape From Tarkov', 'Screenshots');
const LOGS = process.env.EFT_LOGS ?? path.join(install, 'Logs');

// Estado atual e clientes conectados por SSE
const state = {};
const clients = new Set();
function publish(type, data) {
  state[type] = data;
  for (const res of clients) res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
}

// Screenshots: posição do jogador
function watchShots() {
  try {
    fs.watch(SHOTS, (_, name) => {
      const pos = name && parseScreenshot(name);
      if (pos) publish('position', pos);
    });
    console.log('Screenshots:', SHOTS);
  } catch {
    setTimeout(watchShots, 10_000); // pasta só existe depois do primeiro print no jogo
  }
}

// Logs: mapa da raid. Lê só o que foi escrito depois que o servidor subiu.
let logFile, offset = 0;
function pollLogs() {
  try {
    const dir = fs.readdirSync(LOGS).filter(d => d.startsWith('log_')).sort().at(-1);
    const file = dir && fs.readdirSync(path.join(LOGS, dir)).find(f => /application(_\d+)?\.log$/.test(f));
    if (!file) return;
    const full = path.join(LOGS, dir, file);
    const size = fs.statSync(full).size;
    if (full !== logFile) { logFile = full; offset = size; return; }
    if (size <= offset) return;
    const buf = Buffer.alloc(size - offset);
    const fd = fs.openSync(full, 'r');
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    offset = size;
    for (const line of buf.toString('utf8').split('\n')) {
      const id = mapFromLogLine(line);
      if (id) publish('map', mapKey(id));
    }
  } catch { /* jogo ainda não instalado ou sem logs */ }
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
http.createServer((req, res) => {
  if (req.url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    for (const [type, data] of Object.entries(state)) res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  const file = path.join(PUBLIC, path.normalize(req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
  if (!file.startsWith(PUBLIC)) return res.writeHead(403).end();
  fs.readFile(file, (err, body) => {
    if (err) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(body);
  });
}).listen(PORT, () => {
  const lan = Object.values(os.networkInterfaces()).flat().find(i => i.family === 'IPv4' && !i.internal)?.address;
  console.log(`GScanner: http://localhost:${PORT}` + (lan ? `  |  celular: http://${lan}:${PORT}` : ''));
  console.log('Logs:', LOGS);
  watchShots();
  setInterval(pollLogs, 2000);
});
