import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PROTOCOL_VERSION, Room} from '../js/room.js';
import {MemoryNetwork, settle} from '../js/memory-transport.js';

const ROOM = 'ABC123';
const GAMES = {
  rps: {id: 'rps', title: 'Rock Paper Scissors', status: 'ready', minPlayers: 2, maxPlayers: 2},
  chess: {id: 'chess', title: 'Chess', status: 'ready', minPlayers: 2, maxPlayers: 2, resumable: true},
  soon: {id: 'soon', title: 'Soon', status: 'soon', minPlayers: 2, maxPlayers: 2},
  crowd: {id: 'crowd', title: 'Crowd', status: 'ready', minPlayers: 3, maxPlayers: 6},
};
const getGame = (id) => GAMES[id] ?? null;

function makeRoom(net, id, opts = {}) {
  const transport = net.createPeer(id);
  const room = new Room({transport, roomId: ROOM, getGame, name: id, ...opts});
  return {room, transport};
}

// alice's id sorts before bob's, so alice wins a simultaneous-proposal tie.
async function setup(opts = {}) {
  const net = new MemoryNetwork();
  const a = makeRoom(net, 'alice', opts.alice);
  const b = makeRoom(net, 'bob', opts.bob);
  a.transport.join();
  b.transport.join();
  await settle();
  return {net, a, b, ra: a.room, rb: b.room};
}

async function startGame({ra, rb}, gameId = 'rps') {
  ra.propose(gameId);
  await settle();
  rb.accept();
  await settle();
  return {sa: ra.snapshot().session, sb: rb.snapshot().session};
}

test('waits alone until a peer joins, then both see the picker', async () => {
  const net = new MemoryNetwork();
  const {room, transport} = makeRoom(net, 'alice');
  transport.join();
  await settle();
  assert.equal(room.snapshot().phase, 'waiting');
  const {ra, rb} = await setup();
  assert.equal(ra.snapshot().phase, 'idle');
  assert.equal(rb.snapshot().phase, 'idle');
});

test('players exchange names; players are listed in the same order on both sides', async () => {
  const {ra, rb} = await setup();
  assert.equal(ra.snapshot().opponentName, 'bob');
  assert.equal(rb.snapshot().opponentName, 'alice');
  const names = (r) => r.snapshot().players.map((p) => p.id);
  assert.deepEqual(names(ra), ['alice', 'bob']);
  assert.deepEqual(names(rb), ['alice', 'bob']);
});

test('the room name travels from the creator to the joiner', async () => {
  const net = new MemoryNetwork();
  const a = makeRoom(net, 'alice', {roomName: 'Friday showdown'});
  const b = makeRoom(net, 'bob');
  assert.equal(a.room.snapshot().roomName, 'Friday showdown', 'creator sees it immediately');
  assert.equal(b.room.snapshot().roomName, null);
  a.transport.join(); b.transport.join();
  await settle();
  assert.equal(b.room.snapshot().roomName, 'Friday showdown');
  a.transport.leave();
  await settle();
  assert.equal(b.room.snapshot().roomName, null, 'forgotten when its creator leaves');
});

test('room names are optional, capped and sanitized', async () => {
  const net = new MemoryNetwork();
  const a = makeRoom(net, 'alice', {roomName: ' \u202e' + 'x'.repeat(60)});
  const b = makeRoom(net, 'bob');
  a.transport.join(); b.transport.join();
  await settle();
  assert.equal(b.room.snapshot().roomName, 'x'.repeat(24));
  assert.equal((await setup()).ra.snapshot().roomName, null, 'no name means null');
});

test('an invalid hello is ignored', async () => {
  const {a, rb} = await setup();
  a.transport.send({t: 'hello', v: PROTOCOL_VERSION, name: {evil: true}}, 'bob');
  a.transport.send({t: 'hello', v: PROTOCOL_VERSION}, 'bob');
  await settle();
  assert.equal(rb.snapshot().opponentName, 'alice', 'the real hello still stands');
  assert.equal(rb.snapshot().phase, 'idle');
});

test('a hello that arrives before the join event is not lost', async () => {
  const net = new MemoryNetwork();
  const a = makeRoom(net, 'alice');
  const b = net.createPeer('bob');
  a.transport.join(); b.join();
  b.onMessage = () => {};
  await settle();
  b.send({t: 'hello', v: PROTOCOL_VERSION, name: 'Bob'}, 'alice');
  await settle();
  assert.equal(a.room.snapshot().opponentName, 'Bob');
});

// --- proposing and starting a game ---------------------------------------------

test('propose, accept: both sides start the same game session', async () => {
  const {ra, rb} = await setup();
  ra.propose('rps');
  assert.equal(ra.snapshot().phase, 'proposing');
  assert.deepEqual(ra.snapshot().pending, {gameId: 'rps', from: 'me'});
  await settle();
  assert.equal(rb.snapshot().phase, 'invited');
  assert.deepEqual(rb.snapshot().pending, {gameId: 'rps', from: 'them'});
  rb.accept();
  await settle();
  const sa = ra.snapshot().session;
  const sb = rb.snapshot().session;
  assert.equal(ra.snapshot().phase, 'playing');
  assert.equal(rb.snapshot().phase, 'playing');
  assert.equal(sa.sid, sb.sid);
  assert.equal(sa.gameId, 'rps');
  assert.equal(sa.selfId, 'alice');
  assert.equal(sb.selfId, 'bob');
  assert.deepEqual(sa.players, sb.players);
  assert.equal(ra.snapshot().pending, null);
});

test('decline returns both to the picker and tells the proposer', async () => {
  const {ra, rb} = await setup();
  ra.propose('rps');
  await settle();
  rb.decline();
  await settle();
  assert.equal(ra.snapshot().phase, 'idle');
  assert.equal(rb.snapshot().phase, 'idle');
  assert.match(ra.snapshot().notice, /bob declined Rock Paper Scissors/);
});

test('the proposer can withdraw a proposal', async () => {
  const {ra, rb} = await setup();
  ra.propose('rps');
  await settle();
  ra.cancel();
  await settle();
  assert.equal(ra.snapshot().phase, 'idle');
  assert.equal(rb.snapshot().phase, 'idle');
});

test('a proposal that cannot be played is refused: unknown, not ready, or wrong player count', async () => {
  const {ra} = await setup();
  for (const id of ['nope', 'soon', 'crowd', null, 42]) {
    ra.propose(id);
    assert.equal(ra.snapshot().phase, 'idle', `proposing ${id}`);
  }
});

test('a forged proposal arriving over the wire is ignored too', async () => {
  const {a, rb} = await setup();
  for (const gid of ['nope', 'soon', 'crowd']) a.transport.send({t: 'propose', gid, pid: 'p1'}, 'bob');
  a.transport.send({t: 'propose', gid: 'rps', pid: '../bad id'}, 'bob');
  await settle();
  assert.equal(rb.snapshot().phase, 'idle');
});

test('simultaneous proposals: the lower peer id wins on both sides', async () => {
  const {ra, rb} = await setup();
  ra.propose('rps');
  rb.propose('chess'); // before either message arrives
  await settle();
  assert.equal(ra.snapshot().phase, 'proposing', 'alice keeps her own proposal');
  assert.equal(rb.snapshot().phase, 'invited', 'bob sees alice\'s proposal instead of his');
  assert.equal(rb.snapshot().pending.gameId, 'rps');
  rb.accept();
  await settle();
  assert.equal(ra.snapshot().session.gameId, 'rps');
  assert.equal(rb.snapshot().session.gameId, 'rps');
});

test('accepting a proposal that was already withdrawn does not strand the accepter in a game', async () => {
  const {ra, rb} = await setup();
  ra.propose('rps');
  await settle();
  ra.cancel();
  rb.accept(); // both happen before the other's message arrives
  await settle();
  assert.equal(ra.snapshot().phase, 'idle');
  assert.equal(rb.snapshot().phase, 'idle', 'told to end by alice');
  assert.equal(rb.snapshot().session, null);
});

// --- game messages -------------------------------------------------------------

test('game messages reach the other side\'s session, stamped for that session only', async () => {
  const {ra, rb} = await setup();
  const {sa, sb} = await startGame({ra, rb});
  const got = [];
  sb.onMessage = (m, from) => got.push([m, from]);
  sa.send({hello: 'world'});
  await settle();
  assert.deepEqual(got, [[{hello: 'world'}, 'alice']]);
});

test('messages from an earlier game or another game id are dropped', async () => {
  const {a, ra, rb} = await setup();
  const first = await startGame({ra, rb});
  const oldSid = first.sa.sid;
  ra.endGame();
  await settle();
  const second = await startGame({ra, rb}, 'chess');
  const got = [];
  second.sb.onMessage = (m) => got.push(m);
  a.transport.send({t: 'game', sid: oldSid, gid: 'rps', m: 'late'}, 'bob'); // from the old game
  a.transport.send({t: 'game', sid: second.sa.sid, gid: 'rps', m: 'wrong game'}, 'bob');
  a.transport.send({t: 'game', sid: second.sa.sid, gid: 'chess', m: 'ok'}, 'bob');
  await settle();
  assert.deepEqual(got, ['ok']);
});

test('game messages with no session, or a bad shape, are ignored', async () => {
  const {a, rb} = await setup();
  for (const msg of [{t: 'game', sid: 'x', gid: 'rps', m: 1}, {t: 'game'}, {t: 5}, 'str', null, {t: 'bogus'}]) {
    a.transport.send(msg, 'bob');
  }
  await settle();
  assert.equal(rb.snapshot().phase, 'idle');
});

test('messages that arrive before the game has attached a handler are held, in order, then delivered', async () => {
  const {ra, rb} = await setup();
  const {sa, sb} = await startGame({ra, rb});
  sa.send({n: 1});
  sa.send({n: 2});
  await settle();
  const got = [];
  sb.onMessage = (m) => got.push(m); // the game finished loading
  assert.deepEqual(got, [], 'delivered asynchronously, after the game finishes setting up');
  await settle();
  assert.deepEqual(got, [{n: 1}, {n: 2}]);
  sa.send({n: 3});
  await settle();
  assert.deepEqual(got, [{n: 1}, {n: 2}, {n: 3}]);
});

test('held messages are dropped if the game ends before it ever attaches', async () => {
  const {ra, rb} = await setup();
  const {sa, sb} = await startGame({ra, rb});
  sa.send({n: 1});
  await settle();
  rb.endGame();
  await settle();
  const got = [];
  sb.onMessage = (m) => got.push(m);
  await settle();
  assert.deepEqual(got, []);
});

test('a game that throws while handling a message does not break the room', async () => {
  const {ra, rb} = await setup();
  const {sa, sb} = await startGame({ra, rb});
  sb.onMessage = () => { throw new Error('boom'); };
  const log = console.error;
  console.error = () => {};
  try {
    sa.send({x: 1});
    await settle();
  } finally {
    console.error = log;
  }
  assert.equal(rb.snapshot().phase, 'playing');
});

test('session.finished records the result once and notifies the room', async () => {
  const net = new MemoryNetwork();
  const seen = [];
  const a = makeRoom(net, 'alice', {onChange: (s) => seen.push(s.session?.result ?? null)});
  const b = makeRoom(net, 'bob');
  a.transport.join(); b.transport.join();
  await settle();
  const {sa} = await startGame({ra: a.room, rb: b.room});
  sa.finished({winnerId: 'alice'});
  sa.finished({winnerId: 'bob'});
  assert.deepEqual(sa.result, {winnerId: 'alice'});
  assert.deepEqual(seen.at(-1), {winnerId: 'alice'});
});

// --- leaving ---------------------------------------------------------------------

test('leaving the game sends both back to the picker and tells the other player', async () => {
  const {ra, rb} = await setup();
  const {sa, sb} = await startGame({ra, rb});
  rb.endGame();
  await settle();
  assert.equal(ra.snapshot().phase, 'idle');
  assert.equal(rb.snapshot().phase, 'idle');
  assert.equal(ra.snapshot().session, null);
  assert.match(ra.snapshot().notice, /bob left the game/);
  assert.equal(sa.closed && sb.closed, true);
  sa.send({late: true}); // closed sessions never send
});

test('"play again" is leaving and proposing the same game', async () => {
  const {ra, rb} = await setup();
  await startGame({ra, rb});
  ra.endGame();
  ra.propose('rps');
  await settle();
  assert.equal(rb.snapshot().phase, 'invited');
  assert.equal(rb.snapshot().notice, null, 'the invitation replaces the "left" notice');
  rb.accept();
  await settle();
  assert.equal(ra.snapshot().phase, 'playing');
});

test('the opponent disconnecting ends the game and returns to waiting', async () => {
  const {ra, rb, b} = await setup();
  const {sa} = await startGame({ra, rb});
  b.transport.leave();
  await settle();
  assert.equal(ra.snapshot().phase, 'waiting');
  assert.equal(ra.snapshot().session, null);
  assert.equal(sa.closed, true);
  assert.match(ra.snapshot().notice, /bob disconnected/);
});

test('a rejoin after a disconnect starts fresh; the name is forgotten while away', async () => {
  const {net, ra, b} = await setup();
  b.transport.leave();
  await settle();
  assert.equal(ra.snapshot().opponentName, null);
  const b2 = makeRoom(net, 'bob2');
  b2.transport.join();
  await settle();
  assert.equal(ra.snapshot().phase, 'idle');
  assert.equal(ra.snapshot().opponentName, 'bob2');
  assert.equal(ra.snapshot().notice, null);
});

test('a pending proposal does not survive the proposer leaving', async () => {
  const {ra, rb, a} = await setup();
  ra.propose('rps');
  await settle();
  a.transport.leave();
  await settle();
  assert.equal(rb.snapshot().phase, 'waiting');
  assert.equal(rb.snapshot().pending, null);
});

// --- resumable games ---------------------------------------------------------------

test('a resumable game survives a short disconnect and tells the game', async () => {
  const {ra, rb, b} = await setup({alice: {graceMs: 200}, bob: {graceMs: 200}});
  const {sa} = await startGame({ra, rb}, 'chess');
  const calls = [];
  sa.onPeerLeave = (id) => calls.push(['leave', id]);
  sa.onPeerJoin = (id) => calls.push(['join', id]);
  b.transport.leave();
  await settle();
  assert.equal(ra.snapshot().phase, 'playing', 'still playing');
  assert.equal(ra.snapshot().away, true);
  sa.send({dropped: true}); // goes nowhere while the peer is away, and does not throw

  b.transport.join(); // same peer id comes back
  await settle();
  assert.equal(ra.snapshot().away, false);
  assert.equal(ra.snapshot().session, sa, 'same session');
  assert.deepEqual(calls, [['leave', 'bob'], ['join', 'bob']]);
  await settle(300);
  assert.equal(ra.snapshot().phase, 'playing', 'the grace timer was cancelled');
});

test('a resumable game ends when the peer does not return in time', async () => {
  const {ra, rb, b} = await setup({alice: {graceMs: 50}, bob: {graceMs: 50}});
  const {sa} = await startGame({ra, rb}, 'chess');
  b.transport.leave();
  await settle(120);
  assert.equal(ra.snapshot().phase, 'waiting');
  assert.equal(sa.closed, true);
});

test('a game that is not resumable ends immediately', async () => {
  const {ra, rb, b} = await setup({alice: {graceMs: 5000}});
  await startGame({ra, rb}, 'rps');
  b.transport.leave();
  await settle();
  assert.equal(ra.snapshot().phase, 'waiting');
});

// --- strangers, versions, junk ------------------------------------------------------

test('a third player is ignored, and takes over when the second leaves', async () => {
  const {net, ra, rb, b} = await setup();
  const c = makeRoom(net, 'carol');
  c.transport.join();
  await settle();
  const {sa} = await startGame({ra, rb});
  const got = [];
  sa.onMessage = (m) => got.push(m);
  c.transport.send({t: 'game', sid: sa.sid, gid: 'rps', m: 'intruder'}, 'alice');
  c.transport.send({t: 'propose', gid: 'chess', pid: 'p9'}, 'alice');
  await settle();
  assert.deepEqual(got, [], 'carol cannot inject into alice\'s game');
  assert.equal(ra.snapshot().session, sa);

  b.transport.leave();
  await settle();
  assert.equal(ra.snapshot().phase, 'idle', 'carol is now the opponent');
  assert.equal(c.room.snapshot().opponentName, 'alice', 'she got alice\'s hello on promotion');
});

test('a different protocol version blocks proposals and says so', async () => {
  const net = new MemoryNetwork();
  const a = makeRoom(net, 'alice');
  const old = net.createPeer('bob');
  old.onMessage = () => {};
  a.transport.join(); old.join();
  await settle();
  old.send({t: 'hello', v: PROTOCOL_VERSION + 1, name: 'Bob'}, 'alice');
  await settle();
  assert.equal(a.room.snapshot().phase, 'incompatible');
  a.room.propose('rps');
  assert.equal(a.room.snapshot().phase, 'incompatible');
});

test('a hello without a version counts as a different version', async () => {
  const net = new MemoryNetwork();
  const a = makeRoom(net, 'alice');
  const old = net.createPeer('bob');
  old.onMessage = () => {};
  a.transport.join(); old.join();
  await settle();
  old.send({t: 'hello', name: 'Bob'}, 'alice');
  await settle();
  assert.equal(a.room.snapshot().phase, 'incompatible');
});

test('unknown or malformed messages are ignored', async () => {
  const {a, ra, rb} = await setup();
  const junk = [null, 'x', 7, [], {}, {t: 5}, {t: 'accept'}, {t: 'accept', pid: {}}, {t: 'decline'}, {t: 'end'}, {t: 'cancel'}, {t: 'zzz'}];
  for (const m of junk) a.transport.send(m, 'bob');
  await settle();
  assert.equal(rb.snapshot().phase, 'idle');
  assert.equal(ra.snapshot().phase, 'idle');
});

test('leave() closes the session and leaves the transport', async () => {
  const {ra, rb} = await setup();
  const {sa} = await startGame({ra, rb});
  ra.leave();
  await settle();
  assert.equal(sa.closed, true);
  assert.equal(rb.snapshot().phase, 'waiting');
});
