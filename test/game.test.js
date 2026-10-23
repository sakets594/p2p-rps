import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  MOVES,
  generateRoomCode,
  makeCommit,
  normalizeRoomCode,
  resolve,
  verifyReveal,
} from '../js/game.js';

test('resolve: all 9 pairings', () => {
  const expected = {
    'rock,rock': 'draw', 'rock,paper': 'lose', 'rock,scissors': 'win',
    'paper,rock': 'win', 'paper,paper': 'draw', 'paper,scissors': 'lose',
    'scissors,rock': 'lose', 'scissors,paper': 'win', 'scissors,scissors': 'draw',
  };
  for (const a of MOVES) for (const b of MOVES) {
    assert.equal(resolve(a, b), expected[`${a},${b}`], `${a} vs ${b}`);
  }
});

test('resolve is antisymmetric', () => {
  const flip = {win: 'lose', lose: 'win', draw: 'draw'};
  for (const a of MOVES) for (const b of MOVES) assert.equal(resolve(a, b), flip[resolve(b, a)]);
});

test('commit-reveal: honest reveal verifies', async () => {
  const {hash, nonce} = await makeCommit({roomId: 'ABC123', round: 1, move: 'rock'});
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(await verifyReveal({roomId: 'ABC123', round: 1, move: 'rock', nonce, hash}), true);
});

test('commit-reveal: tampering is rejected', async () => {
  const base = {roomId: 'ABC123', round: 1, move: 'rock'};
  const {hash, nonce} = await makeCommit(base);
  assert.equal(await verifyReveal({...base, move: 'paper', nonce, hash}), false, 'changed move');
  assert.equal(await verifyReveal({...base, nonce: '0'.repeat(32), hash}), false, 'changed nonce');
  assert.equal(await verifyReveal({...base, round: 2, nonce, hash}), false, 'replayed in another round');
  assert.equal(await verifyReveal({...base, roomId: 'ZZZZZZ', nonce, hash}), false, 'replayed in another room');
  assert.equal(await verifyReveal({...base, move: 'lizard', nonce, hash}), false, 'invalid move');
});

test('commit hides the move: same move, different nonce, different hash', async () => {
  const a = await makeCommit({roomId: 'ABC123', round: 1, move: 'rock'});
  const b = await makeCommit({roomId: 'ABC123', round: 1, move: 'rock'});
  assert.notEqual(a.hash, b.hash);
});

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
