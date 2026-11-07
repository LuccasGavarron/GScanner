import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { parseScreenshot, mapFromLogLine, mapKey } from './public/shared.js';
import * as offline from './offline.js';

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
    // print mais recente dos últimos 10 min: pega a posição mesmo se o servidor subiu depois dele
    const last = fs.readdirSync(SHOTS).filter(f => f.endsWith('.png'))
      .map(f => ({ f, t: fs.statSync(path.join(SHOTS, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
    const pos = last && Date.now() - last.t < 600_000 && parseScreenshot(last.f);
    if (pos) publish('position', pos);
  } catch {
    setTimeout(watchShots, 10_000); // pasta só existe depois do primeiro print no jogo
  }
}

// Logs: mapa da raid. Lê o arquivo novo inteiro, para pegar a raid em andamento, e depois só o que entrar.
let logFile, offset = 0;
function pollLogs() {
  try {
    const dir = fs.readdirSync(LOGS).filter(d => d.startsWith('log_')).sort().at(-1);
    const file = dir && fs.readdirSync(path.join(LOGS, dir)).find(f => /application(_\d+)?\.log$/.test(f));
    if (!file) return;
    const full = path.join(LOGS, dir, file);
    const size = fs.statSync(full).size;
    if (full !== logFile) { logFile = full; offset = 0; }
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

// /api: repassa a consulta ao tarkov.dev e guarda cópia em disco para quando a API cair.
const API = process.env.TARKOV_API ?? 'https://api.tarkov.dev/graphql';
const CACHE = path.join(import.meta.dirname, 'cache');
function proxy(req, res) {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 100_000) req.destroy(); });
  req.on('end', async () => {
    const file = path.join(CACHE, crypto.createHash('sha1').update(body).digest('hex') + '.json');
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(60_000) });
      const text = await r.text();
      if (!JSON.parse(text).data) throw new Error('sem dados');
      fs.mkdirSync(CACHE, { recursive: true });
      fs.writeFileSync(file, text);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(text);
    } catch {
      try {
        const data = offline.answer(await offlineData(), JSON.parse(body));
        if (data) return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data }));
      } catch { /* sem cópia JSON: tenta o cache da API */ }
      fs.readFile(file, 'utf8', (err, text) => err
        ? res.writeHead(503, { 'Content-Type': 'application/json' }).end('{"errors":[{"message":"API do tarkov.dev fora do ar e sem cópia salva. Tente mais tarde."}]}')
        : res.writeHead(200, { 'Content-Type': 'application/json', 'X-Cache-Date': fs.statSync(file).mtime.toISOString() }).end(text));
    }
  });
}

// /extracts: extrações e transições por mapa, da cópia em JSON do site do tarkov.dev (funciona mesmo com a API fora).
async function cachedGet(name) {
  const file = path.join(CACHE, name + '.json');
  try {
    const r = await fetch('https://json.tarkov.dev/regular/' + name, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(r.status);
    const text = await r.text();
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(file, text);
    return JSON.parse(text);
  } catch {
    return JSON.parse(fs.readFileSync(file, 'utf8')); // sem rede: última cópia; sem cópia: erro sobe
  }
}
// shortcut: cópia carregada uma vez por execução do servidor; reiniciar para pegar preços novos.
let offlineCache;
const offlineData = () => (offlineCache ??= Promise.all(['items', 'items_en', 'traders', 'tasks', 'tasks_en'].map(cachedGet))
  .then(([items, itemsEn, traders, tasks, tasksEn]) => ({ items, itemsEn: itemsEn.data, traders, tasks, tasksEn: tasksEn.data }))
  .catch(e => { offlineCache = null; throw e; }));

let extracts;
async function getExtracts() {
  if (extracts) return extracts;
  const [maps, en] = await Promise.all([cachedGet('maps'), cachedGet('maps_en')]);
  const out = {};
  for (const m of Object.values(maps.data.maps)) {
    const key = mapKey(m.nameId);
    if (out[key]) continue; // variantes (noite, lab escuro) usam o mesmo mapa
    out[key] = [
      ...m.extracts.map(e => ({ name: en.data[e.name] ?? e.name, faction: e.faction, x: e.position.x, z: e.position.z })),
      ...m.transits.map(t => ({ name: en.data[t.description] ?? 'Transit', faction: 'transit', x: t.position.x, z: t.position.z })),
    ];
  }
  return (extracts = out);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
http.createServer((req, res) => {
  if (req.url === '/api' && req.method === 'POST') return proxy(req, res);
  if (req.url === '/extracts') {
    getExtracts().then(e => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(e)),
      () => res.writeHead(503).end('{}'));
    return;
  }
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
    // no-cache: o navegador confere a versão a cada carga, para atualização do app aparecer no F5
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(body);
  });
}).listen(PORT, () => {
  const lan = Object.values(os.networkInterfaces()).flat().find(i => i.family === 'IPv4' && !i.internal)?.address;
  console.log(`GScanner: http://localhost:${PORT}` + (lan ? `  |  celular: http://${lan}:${PORT}` : ''));
  console.log('Logs:', LOGS);
  watchShots();
  setInterval(pollLogs, 2000);
});
