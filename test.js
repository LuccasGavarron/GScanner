import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScreenshot, mapFromLogLine, mapKey, armorGrade, floorAt, raidStartFromLogLine, profileFromLogLine } from './public/shared.js';

test('andar pela altura e pela área', () => {
  const layers = [
    { name: '2nd Floor', extents: [{ height: [2.7, 6.5], bounds: [[[243, 190], [165, 125], 'dorms']] }] },
    { name: 'Underground', extents: [{ height: [-1000, -2] }] },
  ];
  assert.deepEqual(floorAt(layers, { x: 200, y: 3, z: 150 }), { index: 0, rect: [[243, 190], [165, 125]] });
  assert.equal(floorAt(layers, { x: 0, y: 3, z: 0 }).index, -1); // altura bate, mas fora do dorm
  assert.deepEqual(floorAt(layers, { x: 0, y: -5, z: 0 }), { index: 1, rect: null });
  assert.equal(floorAt(undefined, { x: 0, y: 0, z: 0 }).index, -1);
});
import { optimize } from './public/optimize.js';
import { BANDS, toBands, footstepProfile, suggestEq, spectrumDb, nearestProfile } from './public/sound.js';

test('reconhece chuva pelo fundo', () => {
  const dry = BANDS.map(() => -70), rain = BANDS.map(f => (f >= 2000 ? -45 : -68)); // chuva = chiado nos agudos
  const profiles = { normal: { bg: dry }, chuva: { bg: rain } };
  const now = bg => Array.from({ length: 40 }, (_, i) => (i % 8 ? bg : bg.map(v => v + 20))); // fundo + alguns passos
  assert.equal(nearestProfile(now(rain.map(v => v + 1)), profiles), 'chuva');
  assert.equal(nearestProfile(now(dry), profiles), 'normal');
  assert.equal(nearestProfile(now(dry), { normal: profiles.normal }), null); // precisa dos dois perfis
});

test('FFT acha o tom certo', () => {
  const rate = 48000, n = 4096, f = 3000;
  const s = Float32Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * f * i / rate));
  const db = spectrumDb(s);
  const peak = db.indexOf(Math.max(...db));
  assert.ok(Math.abs(peak * rate / n - f) < rate / n, `pico em ${peak * rate / n} Hz`);
  const bands = toBands(db, rate, n);
  assert.equal(BANDS[bands.indexOf(Math.max(...bands))], 3150); // 3 kHz cai na banda de 3,15 kHz
});
import { answer, findItem, hoverInfo, pickByLabel, encodeInvite, decodeInvite } from './offline.js';

test('código de convite ida e volta, e recusa lixo', () => {
  const code = encodeInvite('http://100.109.154.42:7777', 'senha-do-grupo');
  assert.ok(code.startsWith('GS-'));
  assert.deepEqual(decodeInvite(' ' + code + ' '), { u: 'http://100.109.154.42:7777', k: 'senha-do-grupo' });
  assert.equal(decodeInvite('GS-lixo'), null);
  assert.equal(decodeInvite(encodeInvite('javascript:alert(1)', 'senha-do-grupo')), null); // endereço que não é http
  assert.equal(decodeInvite(encodeInvite('http://1.2.3.4:7777', 'curta')), null); // senha curta demais
});

test('cópia JSON vira resposta das abas', () => {
  const d = {
    items: { data: { items: {
      a: { id: 'a', name: 'a Name', shortName: 'a Short', types: ['ammo'], properties: { propertiesType: 'ItemPropertiesAmmo', caliber: 'Caliber9x19PARA', damage: 50, penetrationPower: 30, armorDamage: 40, fragmentationChance: 0.1, initialSpeed: 400, projectileCount: 1 }, avg24hPrice: 100 },
      m: { id: 'm', name: 'm Name', shortName: 'm Short', types: ['mods'], recoilModifier: -5, ergonomicsModifier: 2, lastLowPrice: 900, buyFromTrader: [{ trader: 't', priceRUB: 1000, minTraderLevel: 2 }], properties: null, width: 1, height: 1 },
      l: { id: 'l', name: 'l Name', shortName: 'l Short', types: ['barter'], width: 1, height: 1, lastLowPrice: 500000, avg24hPrice: 550000, sellToTrader: [{ trader: 't', priceRUB: 300000 }] },
    } } },
    itemsEn: { 'a Name': 'Luger', 'a Short': 'Lug', 'm Name': 'Brake', 'm Short': 'Brk', 'l Name': 'LEDX Skin Transilluminator', 'l Short': 'LEDX' },
    traders: { data: { t: { normalizedName: 'prapor' } } },
    tasks: { data: { tasks: { x: { name: 'x Name', objectives: [{ type: 'giveItem', items: ['l'] }] } } } },
    tasksEn: { 'x Name': 'Private Clinic' },
  };
  assert.equal(answer(d, { query: '{ ammo { caliber } }' }).ammo[0].item.name, 'Luger');
  const mod = answer(d, { query: '{ guns: items(type: gun) {} mods: x }' }).mods[0];
  assert.deepEqual(mod.buyFor.map(o => [o.vendor.normalizedName, o.priceRUB]), [['prapor', 1000], ['flea-market', 900]]);
  const [ledx] = answer(d, { query: 'query($q: String) { items(name: $q) {} }', variables: { q: 'ledx' } }).items;
  assert.equal(ledx.sellFor[0].vendor.name, 'Prapor');
  assert.deepEqual(ledx.usedInTasks, [{ name: 'Private Clinic' }]);

  // hover: acha o item pela linha lida, mesmo com erro de OCR, e ignora rótulo curto da grade
  d.itemsPt = { 'l Name': 'Transiluminador de pele LEDX' };
  d.traders.data.t.imageLink = 'prapor.webp';
  assert.equal(findItem(d, ['MRS', 'Transiluminador de pele LEDX']).id, 'l');
  assert.equal(findItem(d, ['LEDX Skin Transi1luminator']).id, 'l');
  assert.equal(findItem(d, ['Transiluminador de', 'pele LEDX']).id, 'l'); // nome quebrado em duas linhas
  assert.equal(findItem(d, ['Lug', 'MRS']), null);
  // rótulo da grade: acima do cursor e com a borda direita à direita dele; ignora o do vizinho da esquerda
  assert.equal(pickByLabel(d, [['LEDX', -40, -60, 20, -48], ['Lug', -150, -60, -90, -48]]).id, 'l');
  assert.equal(pickByLabel(d, [['Lug', -150, -60, -90, -48]]), null); // à esquerda do cursor: é de outro item
  assert.equal(pickByLabel(d, [['LEDX', -40, 30, 20, 42]]), null); // abaixo do cursor: é de outro item
  const h = hoverInfo(d, findItem(d, ['Transiluminador de pele LEDX']));
  assert.deepEqual([h.name, h.flea, h.trader.name, h.trader.image, h.perSlot, h.quests], ['Transiluminador de pele LEDX', 500000, 'Prapor', 'prapor.webp', 500000, ['Private Clinic']]);
});

test('medidor de passos acha as bandas dos passos', () => {
  const bg = BANDS.map(() => -60);
  const step = BANDS.map(f => (f >= 2000 && f <= 4000 ? -35 : -58)); // passo forte entre 2 e 4 kHz
  const frames = Array.from({ length: 100 }, (_, i) => (i % 10 === 0 ? step : bg));
  const p = footstepProfile(frames);
  assert.equal(p.events, 10);
  const eq = suggestEq(p.diff);
  for (const f of [2000, 2500, 3150]) assert.ok(eq.includes(`Fc ${f} Hz`), eq);
  assert.ok(!eq.includes('Fc 1000 Hz'));
  assert.equal(footstepProfile([bg]), null); // pouco som
  // espectro plano de -50 dB vira -50 em todas as bandas
  assert.ok(toBands(new Float32Array(2048).fill(-50), 48000, 4096).every(v => Math.abs(v + 50) < 0.01));
});

const trader = (priceRUB, minTraderLevel = 1) => ({ priceRUB, vendor: { normalizedName: 'prapor', minTraderLevel } });
const fleaOffer = priceRUB => ({ priceRUB, vendor: { normalizedName: 'flea-market' } });
const slot = (name, ids, required = false) => ({ name, required, filters: { allowedItems: ids.map(id => ({ id })) } });
const mods = new Map([
  ['stockA', { id: 'stockA', name: 'Stock A', recoilModifier: -10, ergonomicsModifier: 2, buyFor: [trader(1000)] }],
  ['stockB', { id: 'stockB', name: 'Stock B', recoilModifier: -20, ergonomicsModifier: 0, buyFor: [fleaOffer(5000)], properties: { slots: [slot('Pad', ['padA'])] } }],
  ['padA', { id: 'padA', name: 'Pad A', recoilModifier: -3, buyFor: [trader(200)] }],
  ['brakeA', { id: 'brakeA', name: 'Brake A', recoilModifier: -5, buyFor: [trader(500)] }],
  ['brakeB', { id: 'brakeB', name: 'Brake B', recoilModifier: -8, buyFor: [trader(3000, 3)] }],
]);
const gun = { properties: { ergonomics: 50, recoilVertical: 100, recoilHorizontal: 200, slots: [slot('Stock', ['stockA', 'stockB']), slot('Muzzle', ['brakeA', 'brakeB'], true)] } };
const names = b => b.parts.map(p => p.mod.id).sort().join(',');

test('build sem limite pega o menor recuo', () => {
  const b = optimize(gun, mods);
  assert.equal(names(b), 'brakeB,padA,stockB');
  assert.equal(b.cost, 8200);
  assert.equal(b.recoilVertical, 69);
});

test('build respeita orçamento, nível de trader e flea', () => {
  assert.equal(names(optimize(gun, mods, { budget: 2000 })), 'brakeA,stockA');
  assert.equal(names(optimize(gun, mods, { level: 2, flea: false })), 'brakeA,stockA');
  assert.equal(optimize(gun, mods, { budget: 100 }), null); // slot obrigatório sem opção que caiba
});

test('build não junta peças conflitantes', () => {
  const clash = new Map(mods);
  clash.set('brakeB', { ...mods.get('brakeB'), conflictingItems: [{ id: 'padA' }] });
  const b = optimize(gun, clash);
  const ids = b.parts.map(p => p.mod.id);
  assert.ok(!(ids.includes('brakeB') && ids.includes('padA')), ids.join(','));
  assert.equal(b.recoilVertical, 72); // as duas saídas sem conflito dão -28%
  assert.ok(!b.conflict);
});

test('screenshot com posição e rotação', () => {
  const p = parseScreenshot('2026-11-07[20-15]_123.45, 6.78, -90.12_0.0, 0.70711, 0.0, 0.70711_15.77 (0).png');
  assert.deepEqual([p.x, p.y, p.z], [123.45, 6.78, -90.12]);
  assert.ok(Math.abs(p.yaw - 90) < 0.01);
  assert.equal(parseScreenshot('foto qualquer.png'), null);
});

test('mapa no log', () => {
  const line = '2026-11-07 20:15:00.000|1.0|Info|application|TRACE-NetworkGameCreate profileStatus: \'Profileid: x, Status: Busy, RaidMode: Online, Ip: 1.2.3.4, Port: 17000, Location: bigmap, Sid: abc, GameMode: deathmatch, shortId: ABC123\'';
  assert.equal(mapFromLogLine(line), 'bigmap');
  assert.equal(mapFromLogLine('2026-11-07 02:10:25.507|1|Info|application|[Transit] Flag:None, RaidId:6aee, Count:0, Locations:bigmap -> '), 'bigmap');
  assert.equal(mapFromLogLine('[Transit] Flag:None, Count:1, Locations:bigmap -> Interchange'), 'Interchange'); // transição: vale o último
  assert.equal(mapFromLogLine('scene preset path:maps/shopping_mall.bundle rcid:Shopping_Mall.ScenesPreset.asset'), null);
  assert.equal(mapKey('Sandbox_start'), 'ground-zero');
  assert.equal(mapFromLogLine('qualquer coisa Location: woods'), null);
  assert.equal(mapKey('RezervBase'), 'reserve');
  assert.deepEqual(profileFromLogLine('2026-11-07 12:39:07.721|1|Info|application|CompleteSelectedProfile ProfileId:67bf85228405b2f96f08a0dc AccountId:1'), { selected: '67bf85228405b2f96f08a0dc' });
  assert.deepEqual(profileFromLogLine("TRACE-NetworkGameCreate profileStatus: 'Profileid: 67bf85228405b2f96f08a0dd, Status: Busy"), { raid: '67bf85228405b2f96f08a0dd' });
  assert.equal(profileFromLogLine('qualquer coisa'), null);
  assert.equal(raidStartFromLogLine('2026-11-07 02:11:03.675|1.3.0.1.48558|Info|application|GameStarted:57.21(0) real:66.45(0) diff:9.23'), new Date(2026, 10, 7, 2, 11, 3, 675).getTime());
  assert.equal(raidStartFromLogLine('2026-11-07 02:11:03.675|1.3.0.1.48558|Info|application|GameStarting:57.21(0)'), null);
});

test('munição x armadura', () => {
  assert.equal(armorGrade(53, 4), 3);
  assert.equal(armorGrade(42, 4), 2);
  assert.equal(armorGrade(35, 4), 1);
  assert.equal(armorGrade(20, 5), 0);
});
