import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateRoomCode, normalizeRoomCode} from '../js/room-code.js';
import {DEFAULT_NAMES, MAX_NAME_LENGTH, cleanName, randomName} from '../js/names.js';

test('generateRoomCode: length and alphabet', () => {
  for (let i = 0; i < 200; i++) assert.match(generateRoomCode(), /^[0-9A-HJKMNP-TV-Z]{6}$/);
});

test('generateRoomCode: mixes the clock into the randomness', () => {
  const zeros = {getRandomValues: (a) => a.fill(0)};
  const a = generateRoomCode({random: zeros, now: 1_000_000});
  const b = generateRoomCode({random: zeros, now: 1_000_001});
  assert.notEqual(a, b);
  assert.equal(generateRoomCode({random: zeros, now: 1_000_000}), a, 'deterministic given inputs');
});

test('normalizeRoomCode: forgiving input, strict output', () => {
  assert.equal(normalizeRoomCode(' k7f-2qx '), 'K7F2QX');
  assert.equal(normalizeRoomCode('O1LI23'), '011123', 'O->0, I/L->1');
  assert.equal(normalizeRoomCode('ABC'), null);
  assert.equal(normalizeRoomCode('ABCDEFG'), null);
  assert.equal(normalizeRoomCode('ABC!23'), null);
  assert.equal(normalizeRoomCode(undefined), null);
});

test('cleanName: strips control and bidi characters, trims, caps length', () => {
  assert.equal(cleanName('  Sam  '), 'Sam');
  assert.equal(cleanName('A\u0000B\u202eC'), 'ABC');
  assert.equal(cleanName('x'.repeat(40)).length, 16);
  assert.equal(cleanName('\u200b\n  '), '');
  assert.equal(cleanName(42, 'Friend'), 'Friend');
  assert.equal(cleanName('', 'Player'), 'Player');
  assert.equal(cleanName('\u{1F600}'.repeat(20)).length > 0, true);
  assert.equal(cleanName('y'.repeat(60), '', 24).length, 24);
});

test('default names: unique, each usable as is (not trimmed or capped by cleanName)', () => {
  assert.equal(new Set(DEFAULT_NAMES.map((n) => n.toLowerCase())).size, DEFAULT_NAMES.length);
  for (const name of DEFAULT_NAMES) {
    assert.ok(name.length <= MAX_NAME_LENGTH, name);
    assert.equal(cleanName(name), name, name);
  }
  for (const name of ['Kalicharan', 'Ramcharan', 'Kalluram', 'Kallu Pehelwan', 'Balwant Rai']) {
    assert.ok(DEFAULT_NAMES.includes(name), name);
  }
});

test('randomName: covers the whole list and never goes out of range', () => {
  assert.equal(randomName(() => 0), DEFAULT_NAMES[0]);
  assert.equal(randomName(() => 0.999999), DEFAULT_NAMES.at(-1));
  const seen = new Set();
  for (let i = 0; i < DEFAULT_NAMES.length; i++) seen.add(randomName(() => i / DEFAULT_NAMES.length));
  assert.equal(seen.size, DEFAULT_NAMES.length);
  for (let i = 0; i < 500; i++) assert.ok(DEFAULT_NAMES.includes(randomName()));
});
