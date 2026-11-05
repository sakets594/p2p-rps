import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RpsMatch} from '../js/games/rps/match.js';
import {memorySessions, settle} from '../js/memory-transport.js';

function setup() {
  const {net, sessions: [sa, sb], transports: [ta, tb]} = memorySessions();
  const a = new RpsMatch({session: sa});
  const b = new RpsMatch({session: sb});
  return {net, ta, tb, a, b, sa, sb};
}

// Commit-reveal hashes asynchronously, so wait for the round to resolve instead of a fixed pause
// (a fixed 20 ms flaked when the machine was busy running other test files).
const play = async (a, b, ma, mb) => {
  a.pick(ma);
  b.pick(mb);
  for (let i = 0; i < 100 && !(a.snapshot().phase === 'result' && b.snapshot().phase === 'result'); i++) await settle(10);
};

test('a match starts at choosing and knows the opponent by name', () => {
  const {a, b} = setup();
  assert.equal(a.snapshot().phase, 'choosing');
  assert.equal(b.snapshot().phase, 'choosing');
  assert.equal(a.snapshot().opponentName, 'Bob');
  assert.equal(b.snapshot().opponentName, 'Alice');
});

test('a full round resolves identically on both sides', async () => {
  const {a, b} = setup();
  await play(a, b, 'rock', 'scissors');
  const sa = a.snapshot();
  const sb = b.snapshot();
  assert.equal(sa.phase, 'result');
  assert.equal(sa.outcome, 'win');
  assert.equal(sa.theirMove, 'scissors');
  assert.equal(sb.outcome, 'lose');
  assert.equal(sb.theirMove, 'rock');
  assert.deepEqual(sa.scores, {win: 1, lose: 0, draw: 0});
  assert.deepEqual(sb.scores, {win: 0, lose: 1, draw: 0});
});

test('scores accumulate over several rounds, including draws', async () => {
  const {a, b} = setup();
  await play(a, b, 'rock', 'scissors'); // alice wins
  a.nextRound(); b.nextRound();
  await play(a, b, 'paper', 'paper'); // draw
  a.nextRound(); b.nextRound();
  await play(a, b, 'rock', 'paper'); // bob wins
  assert.deepEqual(a.snapshot().scores, {win: 1, lose: 1, draw: 1});
  assert.deepEqual(b.snapshot().scores, {win: 1, lose: 1, draw: 1});
  assert.equal(a.snapshot().round, 3);
});

test('one player can race ahead into the next round', async () => {
  const {a, b} = setup();
  await play(a, b, 'rock', 'rock');
  a.nextRound();
  a.pick('paper'); // alice commits to round 2 before bob has clicked next
  await settle();
  assert.equal(a.snapshot().phase, 'committed');
  b.nextRound();
  b.pick('rock');
  await settle();
  assert.equal(a.snapshot().outcome, 'win');
  assert.equal(b.snapshot().outcome, 'lose');
});

test('cannot pick twice in a round', async () => {
  const {a, b} = setup();
  a.pick('rock');
  a.pick('paper');
  b.pick('scissors');
  await settle();
  assert.equal(a.snapshot().myMove, 'rock');
  assert.equal(a.snapshot().outcome, 'win');
});

test('a changed move at reveal time is detected as cheating', async () => {
  const {net, a, b} = setup();
  net.intercept = (from, to, msg) => (from === 'bob' && msg.t === 'reveal' ? {...msg, move: 'paper'} : msg);
  await play(a, b, 'rock', 'scissors'); // bob committed scissors, reveals paper
  assert.equal(a.snapshot().phase, 'cheat');
  assert.deepEqual(a.snapshot().scores, {win: 0, lose: 0, draw: 0});
  assert.equal(b.snapshot().phase, 'result', 'honest side is unaffected');
});

test('malformed and out-of-order messages are ignored', async () => {
  const {tb, a} = setup();
  const junk = [
    null, 'x', {t: 'commit'}, {t: 'commit', round: 1, hash: 'nothex'},
    {t: 'commit', round: 99, hash: 'a'.repeat(64)},
    {t: 'reveal', round: 1, move: 'rock', nonce: 'b'.repeat(32)}, // reveal without commit
    {t: 'bogus', round: 1},
  ];
  for (const m of junk) tb.send(m, 'alice');
  await settle();
  assert.equal(a.snapshot().phase, 'choosing');
  a.pick('rock');
  await settle();
  assert.equal(a.snapshot().phase, 'committed');
});

test('a duplicate commit cannot overwrite the first one', async () => {
  const {a, b, tb} = setup();
  b.pick('rock');
  await settle();
  tb.send({t: 'commit', round: 1, hash: 'c'.repeat(64)}, 'alice'); // forged second commit
  await settle();
  a.pick('scissors');
  await settle();
  assert.equal(a.snapshot().phase, 'result', 'first commit still stands, so no false cheat verdict');
  assert.equal(a.snapshot().outcome, 'lose');
});

test('messages that do not come from the opponent are ignored', async () => {
  const {sa, a} = setup();
  sa.onMessage({t: 'commit', round: 1, hash: 'a'.repeat(64)}, 'carol');
  assert.equal(a.snapshot().theirCommitted, false);
});

test('onChange fires with snapshots', async () => {
  const {sessions: [sa, sb]} = memorySessions();
  const phases = [];
  const a = new RpsMatch({
    session: sa,
    onChange: (s) => { if (phases.at(-1) !== s.phase) phases.push(s.phase); },
  });
  const b = new RpsMatch({session: sb});
  await play(a, b, 'rock', 'rock');
  assert.deepEqual(phases, ['committed', 'revealing', 'result']);
});

test('snapshot reports when the friend has locked in', async () => {
  const {a, b} = setup();
  assert.equal(a.snapshot().theirCommitted, false);
  b.pick('rock');
  await settle();
  assert.equal(a.snapshot().theirCommitted, true);
  assert.equal(a.snapshot().phase, 'choosing', 'but alice has not chosen yet');
});

test('destroy stops the match: late messages and pending commits do nothing', async () => {
  const {a, b, sa} = setup();
  a.pick('rock');
  a.destroy(); // alice's commit is still hashing
  b.pick('scissors');
  await settle();
  assert.equal(sa.onMessage, null, 'detached from the session');
  assert.equal(b.snapshot().phase, 'committed', 'bob never got alice\'s commit');
});
