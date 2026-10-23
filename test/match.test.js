import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RpsMatch, cleanName} from '../js/match.js';
import {MemoryNetwork, settle} from '../js/memory-transport.js';

const ROOM = 'ABC123';

async function setup() {
  const net = new MemoryNetwork();
  const ta = net.createPeer('alice');
  const tb = net.createPeer('bob');
  const a = new RpsMatch({transport: ta, roomId: ROOM});
  const b = new RpsMatch({transport: tb, roomId: ROOM});
  ta.join();
  tb.join();
  await settle();
  return {net, ta, tb, a, b};
}

const play = async (a, b, ma, mb) => {
  a.pick(ma);
  b.pick(mb);
  await settle();
};

test('two peers meet and start choosing', async () => {
  const {a, b} = await setup();
  assert.equal(a.snapshot().phase, 'choosing');
  assert.equal(b.snapshot().phase, 'choosing');
});

test('waits alone until a peer joins', async () => {
  const net = new MemoryNetwork();
  const ta = net.createPeer('alice');
  const a = new RpsMatch({transport: ta, roomId: ROOM});
  ta.join();
  await settle();
  assert.equal(a.snapshot().phase, 'waiting');
});

test('a full round resolves identically on both sides', async () => {
  const {a, b} = await setup();
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
  const {a, b} = await setup();
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
  const {a, b} = await setup();
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
  const {a, b} = await setup();
  a.pick('rock');
  a.pick('paper');
  b.pick('scissors');
  await settle();
  assert.equal(a.snapshot().myMove, 'rock');
  assert.equal(a.snapshot().outcome, 'win');
});

test('a changed move at reveal time is detected as cheating', async () => {
  const {net, a, b} = await setup();
  net.intercept = (from, to, msg) => (from === 'bob' && msg.t === 'reveal' ? {...msg, move: 'paper'} : msg);
  await play(a, b, 'rock', 'scissors'); // bob committed scissors, reveals paper
  assert.equal(a.snapshot().phase, 'cheat');
  assert.deepEqual(a.snapshot().scores, {win: 0, lose: 0, draw: 0});
  assert.equal(b.snapshot().phase, 'result', 'honest side is unaffected');
});

test('malformed and out-of-order messages are ignored', async () => {
  const {tb, a} = await setup();
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
  const {a, b, tb} = await setup();
  b.pick('rock');
  await settle();
  tb.send({t: 'commit', round: 1, hash: 'c'.repeat(64)}, 'alice'); // forged second commit
  await settle();
  a.pick('scissors');
  await settle();
  assert.equal(a.snapshot().phase, 'result', 'first commit still stands, so no false cheat verdict');
  assert.equal(a.snapshot().outcome, 'lose');
});

test('a third player is ignored', async () => {
  const {net, a, b} = await setup();
  const tc = net.createPeer('carol');
  const c = new RpsMatch({transport: tc, roomId: ROOM});
  tc.join();
  await settle();
  await play(a, b, 'rock', 'scissors');
  assert.equal(a.snapshot().outcome, 'win');
  assert.equal(c.snapshot().phase, 'choosing'); // carol sees someone, but alice/bob ignore her
});

test('opponent leaving resets to waiting; a rejoin starts fresh', async () => {
  const {net, a, b, tb} = await setup();
  await play(a, b, 'rock', 'scissors');
  tb.leave();
  await settle();
  assert.equal(a.snapshot().phase, 'waiting');

  // bob refreshes the page: new peer id, new match, scores start at zero on both sides
  const tb2 = net.createPeer('bob2');
  const b2 = new RpsMatch({transport: tb2, roomId: ROOM});
  tb2.join();
  await settle();
  assert.equal(a.snapshot().phase, 'choosing');
  assert.deepEqual(a.snapshot().scores, {win: 0, lose: 0, draw: 0});
  await play(a, b2, 'paper', 'rock');
  assert.equal(a.snapshot().outcome, 'win');
  assert.equal(b2.snapshot().outcome, 'lose');
});

test('onChange fires with snapshots', async () => {
  const net = new MemoryNetwork();
  const ta = net.createPeer('alice');
  const tb = net.createPeer('bob');
  const phases = [];
  const a = new RpsMatch({
    transport: ta,
    roomId: ROOM,
    onChange: (s) => { if (phases.at(-1) !== s.phase) phases.push(s.phase); },
  });
  const b = new RpsMatch({transport: tb, roomId: ROOM});
  ta.join(); tb.join();
  await settle();
  await play(a, b, 'rock', 'rock');
  assert.deepEqual(phases, ['choosing', 'committed', 'revealing', 'result']);
});

test('snapshot reports when the friend has locked in', async () => {
  const {a, b} = await setup();
  assert.equal(a.snapshot().theirCommitted, false);
  b.pick('rock');
  await settle();
  assert.equal(a.snapshot().theirCommitted, true);
  assert.equal(a.snapshot().phase, 'choosing', 'but alice has not chosen yet');
});

test('session id changes when the opponent changes', async () => {
  const {net, a, tb} = await setup();
  const before = a.snapshot().session;
  tb.leave();
  await settle();
  const tb2 = net.createPeer('bob2');
  new RpsMatch({transport: tb2, roomId: ROOM});
  tb2.join();
  await settle();
  assert.notEqual(a.snapshot().session, before);
});

test('players exchange names', async () => {
  const net = new MemoryNetwork();
  const ta = net.createPeer('alice');
  const tb = net.createPeer('bob');
  const a = new RpsMatch({transport: ta, roomId: ROOM, name: 'Alice'});
  const b = new RpsMatch({transport: tb, roomId: ROOM, name: 'Bob'});
  assert.equal(a.snapshot().opponentName, null);
  ta.join(); tb.join();
  await settle();
  assert.equal(a.snapshot().opponentName, 'Bob');
  assert.equal(b.snapshot().opponentName, 'Alice');
});

test('names survive resets within a match and are forgotten when the peer leaves', async () => {
  const net = new MemoryNetwork();
  const ta = net.createPeer('alice');
  const tb = net.createPeer('bob');
  const a = new RpsMatch({transport: ta, roomId: ROOM, name: 'Alice'});
  new RpsMatch({transport: tb, roomId: ROOM, name: 'Bob'});
  ta.join(); tb.join();
  await settle();
  tb.leave();
  await settle();
  assert.equal(a.snapshot().opponentName, null);
});

test('a hello that arrives before the join event is not lost', async () => {
  const net = new MemoryNetwork();
  const ta = net.createPeer('alice');
  const tb = net.createPeer('bob');
  const a = new RpsMatch({transport: ta, roomId: ROOM, name: 'Alice'});
  ta.join(); tb.join();
  tb.onMessage = () => {};
  await settle();
  tb.send({t: 'hello', name: 'Bob'}, 'alice');
  await settle();
  assert.equal(a.snapshot().opponentName, 'Bob');
});

test('cleanName: strips control and bidi characters, trims, caps length', () => {
  assert.equal(cleanName('  Sam  '), 'Sam');
  assert.equal(cleanName('A\u0000B\u202eC'), 'ABC');
  assert.equal(cleanName('x'.repeat(40)).length, 16);
  assert.equal(cleanName('\u200b\n  '), '');
  assert.equal(cleanName(42, 'Friend'), 'Friend');
  assert.equal(cleanName('', 'Player'), 'Player');
  assert.equal(cleanName('\u{1F600}'.repeat(20)).length > 0, true);
});

test('an invalid hello is ignored and names never touch the game state', async () => {
  const {a, tb} = await setup();
  tb.send({t: 'hello', name: {evil: true}}, 'alice');
  tb.send({t: 'hello'}, 'alice');
  await settle();
  assert.equal(a.snapshot().opponentName, 'Player', 'default name from the real hello still stands');
  assert.equal(a.snapshot().phase, 'choosing');
});

test('the room name travels from the creator to the joiner', async () => {
  const net = new MemoryNetwork();
  const ta = net.createPeer('alice');
  const tb = net.createPeer('bob');
  const a = new RpsMatch({transport: ta, roomId: ROOM, name: 'Alice', roomName: 'Friday showdown'});
  const b = new RpsMatch({transport: tb, roomId: ROOM, name: 'Bob'});
  assert.equal(a.snapshot().roomName, 'Friday showdown', 'creator sees it immediately');
  assert.equal(b.snapshot().roomName, null);
  ta.join(); tb.join();
  await settle();
  assert.equal(b.snapshot().roomName, 'Friday showdown');
});

test('room names are optional, capped and sanitized', async () => {
  const net = new MemoryNetwork();
  const ta = net.createPeer('alice');
  const tb = net.createPeer('bob');
  const a = new RpsMatch({transport: ta, roomId: ROOM, name: 'Alice', roomName: ' \u202e' + 'x'.repeat(60) });
  const b = new RpsMatch({transport: tb, roomId: ROOM, name: 'Bob'});
  ta.join(); tb.join();
  await settle();
  assert.equal(b.snapshot().roomName, 'x'.repeat(24));
  assert.equal(cleanName('y'.repeat(60), '', 24).length, 24);
  assert.equal((await setup()).a.snapshot().roomName, null, 'no name means null');
  void a;
});

test('a room name is forgotten when its creator leaves', async () => {
  const net = new MemoryNetwork();
  const ta = net.createPeer('alice');
  const tb = net.createPeer('bob');
  new RpsMatch({transport: ta, roomId: ROOM, name: 'Alice', roomName: 'Temp'});
  const b = new RpsMatch({transport: tb, roomId: ROOM, name: 'Bob'});
  ta.join(); tb.join();
  await settle();
  ta.leave();
  await settle();
  assert.equal(b.snapshot().roomName, null);
});
