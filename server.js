import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execSync, execFile, spawn } from 'node:child_process';
import { parseScreenshot, mapFromLogLine, mapKey, raidStartFromLogLine, profileFromLogLine } from './public/shared.js';
import * as offline from './offline.js';
import { encodeInvite, decodeInvite } from './offline.js';
import { spectrumDb, toBands, footstepProfile, nearestProfile } from './public/sound.js';

const PORT = Number(process.env.PORT) || 7777;
const PUBLIC = path.join(import.meta.dirname, 'public');
const CACHE = path.join(import.meta.dirname, 'cache');

function reg(key, value) {
  try { return execSync(`reg query "${key}" /v ${value}`, { encoding: 'utf8' }).match(/REG_\w+\s+(.+)/)?.[1].trim(); } catch { return undefined; }
}
const docs = reg('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders', 'Personal') ?? path.join(os.homedir(), 'Documents');
const install = reg('HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EscapeFromTarkov', 'InstallLocation') ?? 'C:\\Battlestate Games\\Escape from Tarkov';
const SHOTS = process.env.EFT_SCREENSHOTS ?? path.join(docs, 'Escape From Tarkov', 'Screenshots');
const LOGS = process.env.EFT_LOGS ?? path.join(install, 'Logs');

// Estado atual e clientes conectados por SSE
const state = {};
const clients = new Map(); // res -> true se for um amigo remoto (só recebe o squad)
function publish(type, data) {
  state[type] = data;
  for (const [res, squadOnly] of clients) if (!squadOnly || type === 'squad') res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
}

// Squad: amigos no mapa. Cada GScanner manda a própria posição ao anfitrião (SQUAD_URL; sem ela, o anfitrião
// é este servidor) e recebe a lista do grupo. SQUAD_KEY é a senha do grupo.
// config.json (fora do Git): { "squadName": "...", "squadKey": "...", "squadUrl": "http://ip-do-anfitriao:7777" }; variável de ambiente vence
const cfg = (() => { try { return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'config.json'), 'utf8')); } catch { return {}; } })();
const SQUAD = { name: process.env.SQUAD_NAME ?? cfg.squadName, url: (process.env.SQUAD_URL ?? cfg.squadUrl)?.replace(/\/$/, ''), key: process.env.SQUAD_KEY ?? cfg.squadKey };
const squad = new Map();
let myPing = null;
const keyOk = k => !!SQUAD.key && typeof k === 'string' && k.length === SQUAD.key.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(SQUAD.key));
function squadUpdate(m) {
  const ok = typeof m?.name === 'string' && m.name.length <= 20 && typeof m.map === 'string' && m.map.length <= 40
    && [m.x, m.z, m.yaw].every(Number.isFinite) && (!m.ping || [m.ping.x, m.ping.z].every(Number.isFinite));
  if (!ok) return false;
  squad.set(m.name, { name: m.name, map: m.map, x: m.x, z: m.z, yaw: m.yaw, ping: m.ping ? { x: m.ping.x, z: m.ping.z } : null, at: Date.now() });
  for (const [k, v] of squad) if (Date.now() - v.at > 300_000) squad.delete(k); // sumiu há 5 min
  publish('squad', [...squad.values()]);
  return true;
}
function squadSend() {
  if (!SQUAD.name || !state.position || !state.map) return;
  const { x, z, yaw } = state.position;
  const me = { name: SQUAD.name, map: state.map, x, z, yaw, ping: myPing };
  if (!SQUAD.url) return squadUpdate(me);
  fetch(SQUAD.url + '/squad', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...me, key: SQUAD.key }), signal: AbortSignal.timeout(5000) })
    .catch(() => { /* anfitrião fora do ar: tenta de novo no próximo envio */ });
}
// amigo: recebe a lista do anfitrião. Trocar de grupo aborta a conexão antiga e abre outra.
let listen = null;
async function squadListen() {
  listen?.abort();
  if (!SQUAD.url) return;
  const ctl = listen = new AbortController();
  while (!ctl.signal.aborted) {
    try {
      const r = await fetch(`${SQUAD.url}/squad/events?key=${encodeURIComponent(SQUAD.key ?? '')}`, { signal: ctl.signal });
      if (!r.ok) throw new Error(r.status);
      let buf = '';
      for await (const chunk of r.body) {
        buf += Buffer.from(chunk).toString();
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const p of parts) {
          const msg = JSON.parse(p.replace(/^data: /, ''));
          if (msg.type === 'squad') publish('squad', msg.data);
        }
      }
    } catch { /* cai e reconecta */ }
    await new Promise(r => setTimeout(r, 5000));
  }
}

// Código de convite: "GS-" + base64url de { u: endereço do anfitrião, k: senha }. Gerar e usar só pelo próprio PC.
const isLocal = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
function hostAddress() { // IP do Tailscale se houver (amigos de outras casas), senão o da rede local
  try {
    const ip = execSync('tailscale ip -4', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0];
    if (/^100\./.test(ip)) return ip;
  } catch { /* sem Tailscale */ }
  return Object.values(os.networkInterfaces()).flat().find(i => i.family === 'IPv4' && !i.internal)?.address ?? 'localhost';
}
function saveSquad(next) {
  Object.assign(SQUAD, next);
  for (const [k, c] of [['name', 'squadName'], ['key', 'squadKey'], ['url', 'squadUrl']]) {
    if (SQUAD[k]) cfg[c] = SQUAD[k]; else delete cfg[c];
  }
  fs.writeFileSync(path.join(import.meta.dirname, 'config.json'), JSON.stringify(cfg, null, 2) + '\n');
  squad.clear();
  publish('squad', []);
  publish('me', SQUAD.name);
  squadListen();
  squadSend();
}

function readJson(req, max, cb) {
  let body = '';
  req.on('data', c => { body += c; if (body.length > max) req.destroy(); });
  req.on('end', () => { try { cb(JSON.parse(body || '{}')); } catch { cb(null); } });
}

// Screenshots: posição do jogador
function watchShots() {
  try {
    fs.watch(SHOTS, (_, name) => {
      const pos = name && parseScreenshot(name);
      if (pos) { publish('position', pos); squadSend(); }
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

// Hover: hover.ps1 lê o texto perto do mouse (OCR do Windows); o servidor acha o item e publica.
// cache/hover.log: cada leitura e o item escolhido, para achar erro de hover; recomeça ao passar de 300 KB
const HOVER_LOG = path.join(CACHE, 'hover.log');
function hoverLog(text) {
  try {
    if (fs.existsSync(HOVER_LOG) && fs.statSync(HOVER_LOG).size > 300_000) fs.writeFileSync(HOVER_LOG, '');
    fs.appendFileSync(HOVER_LOG, `${new Date().toISOString().slice(11, 23)} ${text}\n`);
  } catch { /* log é só ajuda: nunca derruba o hover */ }
}

function watchHover() {
  if (process.platform !== 'win32') return;
  const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(import.meta.dirname, 'hover.ps1')], { env: { ...process.env, GSCANNER_PID: String(process.pid) } });
  let buf = '', lastId;
  ps.stdout.on('data', async chunk => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const l of lines) {
      try {
        const d = await offlineData();
        const boxes = [].concat(JSON.parse(l) ?? []);
        // nome completo da dica do jogo vence; sem dica ainda, o rótulo curto da grade dá o item na hora
        const byName = offline.findItem(d, boxes.map(b => (Array.isArray(b) ? b[0] : b)));
        const item = byName ?? offline.pickByLabel(d, boxes.filter(Array.isArray));
        hoverLog(`${item ? (byName ? 'dica ' : 'rótulo ') + item.normalizedName : '-'} <= ${l.trim()}`);
        if (item && item.id !== lastId) { lastId = item.id; publish('hover', offline.hoverInfo(d, item)); }
        if (!item && lastId) { lastId = null; publish('hover', null); } // dica sumiu: esconde o cartão
      } catch { /* linha incompleta ou sem dados: ignora */ }
    }
  });
  ps.on('exit', () => setTimeout(watchHover, 5000)); // reinicia se o leitor cair
}

// Som: loopback.ps1 grava a saída do Windows; aqui vira bandas de 1/3 de oitava a cada 2048 amostras.
let rec = null;
function soundStart() {
  if (rec) return;
  const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(import.meta.dirname, 'loopback.ps1')]);
  const r = rec = { ps, rate: 0, frames: [], bytes: Buffer.alloc(0), pending: new Float32Array(0), error: '' };
  ps.stderr.on('data', c => { r.error += c; });
  ps.on('exit', () => { if (rec === r) r.done = true; });
  setTimeout(() => rec === r && ps.kill(), 600_000); // trava de segurança: 10 min
  ps.stdout.on('data', chunk => {
    r.bytes = Buffer.concat([r.bytes, chunk]);
    if (!r.rate) {
      const nl = r.bytes.indexOf(10);
      if (nl < 0) return;
      r.rate = Number(r.bytes.subarray(5, nl));
      r.bytes = r.bytes.subarray(nl + 1);
    }
    const n = Math.floor(r.bytes.length / 4), f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = r.bytes.readFloatLE(i * 4);
    r.bytes = r.bytes.subarray(n * 4);
    const all = new Float32Array(r.pending.length + n);
    all.set(r.pending);
    all.set(f, r.pending.length);
    let at = 0;
    for (; at + 4096 <= all.length; at += 2048) r.frames.push(toBands(spectrumDb(all.subarray(at, at + 4096)), r.rate, 4096));
    r.pending = all.slice(at);
  });
}
const soundSecs = r => (r?.rate ? Math.round(r.frames.length * 2048 / r.rate) : 0);
function soundStop() {
  const r = rec;
  rec = null;
  if (!r) return { error: 'Nada gravando.' };
  r.ps.kill();
  if (!r.frames.length) return { error: 'Não gravou som. ' + r.error.split('\n')[0] };
  return { profile: footstepProfile(r.frames), secs: soundSecs(r) };
}

// Equalizador: perfis (sem chuva / com chuva) vêm da aba Som. O Equalizer APO inclui cache/eq.txt
// (config.txt dele: "Include: <pasta do GScanner>\cache\eq.txt") e recarrega sozinho quando o arquivo muda.
const EQ_FILE = path.join(CACHE, 'eq.txt'), EQ_PROFILES = path.join(CACHE, 'eq-profiles.json');
const eq = { profiles: (() => { try { return JSON.parse(fs.readFileSync(EQ_PROFILES, 'utf8')); } catch { return {}; } })(), auto: false, active: null, mon: null };
function eqApply(name) {
  if (eq.active === name || !eq.profiles[name]) return;
  eq.active = name;
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(EQ_FILE, `# GScanner: perfil ${name}\n${eq.profiles[name].eq}\n`);
  publish('eq', { active: name, auto: eq.auto });
}
// Troca automática: grava o som sem parar e, a cada 5 s, compara o fundo (metade mais baixa dos quadros)
// com o fundo salvo de cada perfil; fica com o mais parecido.
function eqAuto(on) {
  eq.auto = on;
  eq.mon?.kill();
  eq.mon = null;
  publish('eq', { active: eq.active, auto: on });
  if (!on) return;
  const ps = eq.mon = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(import.meta.dirname, 'loopback.ps1')]);
  let rate = 0, bytes = Buffer.alloc(0), pending = new Float32Array(0), frames = [];
  ps.stdout.on('data', chunk => {
    bytes = Buffer.concat([bytes, chunk]);
    if (!rate) { const nl = bytes.indexOf(10); if (nl < 0) return; rate = Number(bytes.subarray(5, nl)); bytes = bytes.subarray(nl + 1); }
    const n = Math.floor(bytes.length / 4), f = new Float32Array(pending.length + n);
    f.set(pending);
    for (let i = 0; i < n; i++) f[pending.length + i] = bytes.readFloatLE(i * 4);
    bytes = bytes.subarray(n * 4);
    let at = 0;
    for (; at + 4096 <= f.length; at += 2048) frames.push(toBands(spectrumDb(f.subarray(at, at + 4096)), rate, 4096));
    pending = f.slice(at);
    if (frames.length * 2048 < rate * 5) return;
    const name = nearestProfile(frames, eq.profiles);
    frames = [];
    if (name) eqApply(name);
  });
  ps.on('exit', () => { if (eq.mon === ps) setTimeout(() => eq.auto && eqAuto(true), 5000); }); // caiu: tenta de novo
}

// Logs: mapa da raid. Lê o arquivo novo inteiro, para pegar a raid em andamento, e depois só o que entrar.
let logFile, offset = 0, pmcProfile;
function pollLogs() {
  try {
    // mais nova pela data de modificação: o nome traz a hora sem zero ("2-00-25" viria depois de "12-38-34")
    const dir = fs.readdirSync(LOGS).filter(d => d.startsWith('log_'))
      .map(d => ({ d, t: fs.statSync(path.join(LOGS, d)).mtimeMs })).sort((a, b) => b.t - a.t)[0]?.d;
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
      if (id) { publish('map', mapKey(id)); publish('raidStart', null); squadSend(); }
      const start = raidStartFromLogLine(line);
      if (start) publish('raidStart', start);
      const prof = profileFromLogLine(line);
      if (prof?.selected) pmcProfile = prof.selected;
      if (prof?.raid && pmcProfile) publish('side', prof.raid === pmcProfile ? 'pmc' : 'scav'); // filtro de extrações segue
    }
  } catch { /* jogo ainda não instalado ou sem logs */ }
}

// /api: repassa a consulta ao tarkov.dev e guarda cópia em disco para quando a API cair.
const API = process.env.TARKOV_API ?? 'https://api.tarkov.dev/graphql';
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
const offlineData = () => (offlineCache ??= Promise.all(['items', 'items_en', 'items_pt', 'traders', 'tasks', 'tasks_en', 'tasks_pt'].map(cachedGet))
  .then(([items, itemsEn, itemsPt, traders, tasks, tasksEn, tasksPt]) => ({ items, itemsEn: itemsEn.data, itemsPt: itemsPt.data, traders, tasks, tasksEn: tasksEn.data, tasksPt: tasksPt.data }))
  .catch(e => { offlineCache = null; throw e; }));

let extracts;
async function getExtracts() {
  if (extracts) return extracts;
  const [maps, en, d] = await Promise.all([cachedGet('maps'), cachedGet('maps_en'), offlineData().catch(() => null)]);
  return (extracts = offline.mapLayers(maps, en.data, d, mapKey));
}

// Atualização automática pelo GitHub: a cada minuto confere; com commit novo e sem mudança local, baixa e
// reinicia em ~1 s. A página recarrega sozinha quando vê a versão nova (evento "version"). Desliga com "autoUpdate": false.
const git = (...args) => new Promise(r => execFile('git', args, { cwd: import.meta.dirname }, (e, out) => r(e ? null : out.trim())));
const VERSION = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: import.meta.dirname, encoding: 'utf8' }).trim(); } catch { return 'dev'; } })();
let updating = false;
async function checkUpdate() {
  if (updating || cfg.autoUpdate === false || (await git('fetch', '-q', 'origin')) === null) return;
  const [head, up, dirty] = await Promise.all([git('rev-parse', 'HEAD'), git('rev-parse', '@{u}'), git('status', '--porcelain', '--untracked-files=no')]);
  if (!head || !up || head === up || dirty !== '') return; // nada novo, ou há mudança local: não mexe
  if ((await git('merge-base', '--is-ancestor', 'HEAD', '@{u}')) === null) return; // históricos divergiram
  updating = true;
  if ((await git('pull', '--ff-only', '-q')) === null) { updating = false; return; }
  console.log('Atualizado pelo GitHub: reiniciando');
  let started = false;
  const relaunch = () => {
    if (started) return;
    started = true;
    spawn(process.execPath, [path.join(import.meta.dirname, 'server.js')], { cwd: import.meta.dirname, detached: true, stdio: 'ignore' }).unref();
    process.exit(0);
  };
  for (const res of clients.keys()) res.end(); // fecha os eventos para a porta liberar; as páginas reconectam sozinhas
  server.close(relaunch);
  setTimeout(relaunch, 3000);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  if (req.url === '/api' && req.method === 'POST') return proxy(req, res);
  if (req.url.startsWith('/sound/') && req.method === 'POST') {
    const out = req.url === '/sound/start' ? (soundStart(), { ok: true }) : req.url === '/sound/stop' ? soundStop() : { secs: soundSecs(rec), error: rec?.done ? rec.error.split('\n')[0] : undefined };
    return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
  }
  if (req.url.startsWith('/tiles/')) { // tiles do mapa com cópia em disco: da segunda vez abre na hora
    const rel = decodeURIComponent(req.url.slice(7).split('?')[0]);
    if (!/^[\w.\-/]+$/.test(rel) || rel.includes('..')) return res.writeHead(400).end();
    const file = path.join(CACHE, 'tiles', rel);
    const send = body => res.writeHead(200, { 'Content-Type': rel.endsWith('.webp') ? 'image/webp' : 'image/png', 'Cache-Control': 'max-age=604800' }).end(body);
    fs.readFile(file, async (err, body) => {
      if (!err) return send(body);
      try {
        const r = await fetch('https://assets.tarkov.dev/maps/' + rel, { signal: AbortSignal.timeout(20_000) });
        if (!r.ok) return res.writeHead(r.status).end();
        const buf = Buffer.from(await r.arrayBuffer());
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFile(file, buf, () => {});
        send(buf);
      } catch { res.writeHead(504).end(); }
    });
    return;
  }
  if (req.url === '/tasks') {
    Promise.all([offlineData(), cachedGet('maps')]).then(([d, maps]) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(offline.tasks(d, maps, mapKey))),
      () => res.writeHead(503).end('[]'));
    return;
  }
  if (req.url === '/mapdata') {
    getExtracts().then(e => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(e)),
      () => res.writeHead(503).end('{}'));
    return;
  }
  if (req.url.startsWith('/eq/') && req.method === 'POST') {
    return readJson(req, 20_000, b => {
      const ok = () => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        active: eq.active, auto: eq.auto, file: EQ_FILE, apo: fs.existsSync('C:\\Program Files\\EqualizerAPO\\config\\config.txt'),
      }));
      if (req.url === '/eq/profile') {
        // só linhas Preamp/Filter entram no arquivo que o Equalizer APO lê (nada de Include, Device etc.)
        const valid = b && ['normal', 'chuva'].includes(b.name) && Array.isArray(b.bg) && b.bg.length === 20 && b.bg.every(Number.isFinite)
          && typeof b.eq === 'string' && b.eq.length < 2000 && b.eq.split('\n').every(l => /^(Preamp|Filter): [\w .:-]+$/.test(l));
        if (!valid) return res.writeHead(400).end();
        eq.profiles[b.name] = { bg: b.bg, eq: b.eq };
        fs.mkdirSync(CACHE, { recursive: true });
        fs.writeFileSync(EQ_PROFILES, JSON.stringify(eq.profiles));
        if (!eq.active || eq.active === b.name) { eq.active = null; eqApply(b.name); }
      } else if (req.url === '/eq/auto') eqAuto(!!b?.on);
      else if (req.url === '/eq/use' && eq.profiles[b?.name]) { eqAuto(false); eqApply(b.name); }
      ok();
    });
  }
  if (/^\/squad\/(status|host|join|leave)$/.test(req.url) && req.method === 'POST') { // grupo pela página, só deste PC
    if (!isLocal(req)) return res.writeHead(403).end();
    return readJson(req, 2000, b => {
      const name = typeof b?.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 20) : SQUAD.name;
      if (req.url === '/squad/host') saveSquad({ name, url: undefined, key: !SQUAD.url && SQUAD.key ? SQUAD.key : crypto.randomBytes(9).toString('base64url') });
      if (req.url === '/squad/join') {
        const inv = decodeInvite(b?.code);
        if (!inv || !name) return res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"error":"Código inválido ou nome vazio."}');
        saveSquad({ name, url: inv.u, key: inv.k });
      }
      if (req.url === '/squad/leave') saveSquad({ url: undefined, key: undefined });
      const host = !SQUAD.url && !!SQUAD.key;
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        name: SQUAD.name ?? '', host, joined: !!SQUAD.url, code: host ? encodeInvite(`http://${hostAddress()}:${PORT}`, SQUAD.key) : null,
      }));
    });
  }
  if (req.url === '/squad' && req.method === 'POST') { // posição de um amigo
    return readJson(req, 10_000, m => res.writeHead(!m || !keyOk(m.key) ? 403 : squadUpdate(m) ? 200 : 400).end());
  }
  if (req.url === '/ping' && req.method === 'POST') { // ping desta página, repassado ao grupo
    return readJson(req, 1000, p => {
      myPing = p && [p.x, p.z].every(Number.isFinite) ? { x: p.x, z: p.z } : null;
      squadSend();
      res.writeHead(200).end();
    });
  }
  const squadOnly = req.url.startsWith('/squad/events');
  if (req.url === '/events' || squadOnly) {
    if (squadOnly && !keyOk(new URL(req.url, 'http://x').searchParams.get('key'))) return res.writeHead(403).end();
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    for (const [type, data] of Object.entries(state)) if (!squadOnly || type === 'squad') res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
    clients.set(res, squadOnly);
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
  publish('version', VERSION);
  setInterval(checkUpdate, 60_000);
  watchHover();
  // cartão por cima do jogo (Tarkov em janela sem borda); desliga com "overlay": false no config.json
  if (process.platform === 'win32' && cfg.overlay !== false) spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(import.meta.dirname, 'overlay.ps1'), '-Port', String(PORT), '-ParentPid', String(process.pid)], { stdio: 'ignore' });
  setInterval(pollLogs, 2000);
  if (SQUAD.name) {
    publish('me', SQUAD.name);
    console.log(`Squad: ${SQUAD.name} -> ${SQUAD.url ?? 'anfitrião (este PC)'}`);
    squadListen();
  }
  setInterval(squadSend, 30_000); // mantém o nome vivo no grupo mesmo parado (sem grupo, não faz nada)
});
