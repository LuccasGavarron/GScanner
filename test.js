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

test('screenshot com posição e rotação', () => {
  const p = parseScreenshot('2026-11-07[20-15]_123.45, 6.78, -90.12_0.0, 0.70711, 0.0, 0.70711_15.77 (0).png');
  assert.deepEqual([p.x, p.y, p.z], [123.45, 6.78, -90.12]);
  assert.ok(Math.abs(p.yaw - 90) < 0.01);
  assert.equal(parseScreenshot('foto qualquer.png'), null);
});

test('mapa no log', () => {
  const line = '2026-11-07 20:15:00.000|1.0|Info|application|TRACE-NetworkGameCreate profileStatus: \'Profileid: x, Status: Busy, RaidMode: Online, Ip: 1.2.3.4, Port: 17000, Location: bigmap, Sid: abc, GameMode: deathmatch, shortId: ABC123\'';
  assert.equal(mapFromLogLine(line), 'bigmap');
  assert.equal(mapFromLogLine('qualquer coisa Location: woods'), null);
  assert.equal(mapKey('RezervBase'), 'reserve');
});

test('munição x armadura', () => {
  assert.equal(armorGrade(53, 4), 3);
  assert.equal(armorGrade(42, 4), 2);
  assert.equal(armorGrade(35, 4), 1);
  assert.equal(armorGrade(20, 5), 0);
});
