import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScreenshot, mapFromLogLine, mapKey, armorGrade, floorAt } from './public/shared.js';

test('andar pela altura e pela área', () => {
  const layers = [
    { name: '2nd Floor', extents: [{ height: [2.7, 6.5], bounds: [[[243, 190], [165, 125], 'dorms']] }] },
    { name: 'Underground', extents: [{ height: [-1000, -2] }] },
  ];
  assert.equal(floorAt(layers, { x: 200, y: 3, z: 150 }), 0);
  assert.equal(floorAt(layers, { x: 0, y: 3, z: 0 }), -1); // altura bate, mas fora do dorm
  assert.equal(floorAt(layers, { x: 0, y: -5, z: 0 }), 1);
  assert.equal(floorAt(undefined, { x: 0, y: 0, z: 0 }), -1);
});
import { optimize } from './public/optimize.js';
import { BANDS, toBands, footstepProfile, suggestEq } from './public/sound.js';
import { answer } from './offline.js';

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
  assert.equal(mapFromLogLine('2026-11-07 02:09:58.006|1.3.0.1.48558|Info|application|scene preset path:maps/customs_preset.bundle rcid:bigmap.scenespreset.asset'), 'bigmap');
  assert.equal(mapFromLogLine('qualquer coisa Location: woods'), null);
  assert.equal(mapKey('RezervBase'), 'reserve');
});

test('munição x armadura', () => {
  assert.equal(armorGrade(53, 4), 3);
  assert.equal(armorGrade(42, 4), 2);
  assert.equal(armorGrade(35, 4), 1);
  assert.equal(armorGrade(20, 5), 0);
});
