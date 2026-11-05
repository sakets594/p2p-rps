import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MOVES, makeCommit, resolve, verifyReveal} from '../js/games/rps/rules.js';

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
