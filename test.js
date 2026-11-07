import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScreenshot, mapFromLogLine, mapKey, armorGrade } from './public/shared.js';

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
