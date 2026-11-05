import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CupPongMatch, PARAMS, RULES} from '../js/games/cup-pong/match.js';
import {simulate} from '../js/games/cup-pong/physics.js';
import {memorySessions, settle} from '../js/memory-transport.js';

async function setup() {
  const {net, sessions, transports} = memorySessions();
  const events = [[], []];
  const [a, b] = sessions.map((session, i) => new CupPongMatch({session, onEvent: (e) => events[i].push(e)}));
  await settle(80); // handshake + coin flip use async hashing
  return {net, sessions, transports, a, b, events, byseat: [a, b]};
}

const MISS = [0, 0];

/** Some input that scores against `match`'s current target rack (direct or after a bounce). */
function scoringThrow(match) {
  const cups = match.targetCups();
  for (let p = 60; p <= 255; p++) {
    for (let a = 0; a <= 40; a++) {
      for (const sign of a === 0 ? [1] : [1, -1]) {
        if (simulate(a * sign, p, cups, PARAMS).outcome === 'in') return [a * sign, p];
      }
    }
  }
  throw new Error('no scoring throw found');
}

/** Whichever side has the turn throws, then both settle. */
async function throwBy(ctx, input) {
  const thrower = ctx.byseat[ctx.a.snapshot().turn];
  const ev = thrower.throw(...input);
  await settle(20);
  return ev;
}

test('both sides handshake, flip a fair coin and agree who throws first', async () => {
  const {a, b} = await setup();
  assert.equal(a.snapshot().phase, 'play');
  assert.equal(b.snapshot().phase, 'play');
  assert.ok(a.snapshot().first === 0 || a.snapshot().first === 1);
  assert.equal(a.snapshot().first, b.snapshot().first);
  assert.equal(a.snapshot().turn, a.snapshot().first);
  assert.equal(a.seat, 0);
  assert.equal(b.seat, 1);
});

test('the coin flip is not always the same seat', async () => {
  const firsts = new Set();
  for (let i = 0; i < 25 && firsts.size < 2; i++) firsts.add((await setup()).a.snapshot().first);
  assert.equal(firsts.size, 2);
});

test('a throw replays identically on both sides', async () => {
  const ctx = await setup();
  const ev = await throwBy(ctx, MISS);
  assert.equal(ev.hit, false);
  assert.deepEqual(ctx.a.snapshot().racks, ctx.b.snapshot().racks);
  assert.equal(ctx.a.snapshot().throws, 1);
  assert.equal(ctx.b.snapshot().throws, 1);
  assert.equal(ctx.a.snapshot().ball, 2);
  assert.equal(ctx.b.snapshot().ball, 2);
  const theirs = ctx.events[1 - ctx.a.snapshot().first].filter((e) => e.type === 'throw');
  assert.equal(theirs.length, 1, 'the other side was told about the throw');
});

test('only the player whose turn it is can throw', async () => {
  const ctx = await setup();
  const turn = ctx.a.snapshot().turn;
  assert.equal(ctx.byseat[1 - turn].throw(...MISS), null);
  assert.ok(ctx.byseat[turn].throw(...MISS));
  assert.equal(ctx.byseat[turn].throw(0, 300), null, 'inputs are range checked');
  assert.equal(ctx.byseat[turn].throw(0.5, 10), null);
});

test('a scoring throw removes a cup on both sides and scores a point', async () => {
  const ctx = await setup();
  const turn = ctx.a.snapshot().turn;
  const input = scoringThrow(ctx.byseat[turn]);
  const ev = await throwBy(ctx, input);
  assert.equal(ev.hit, true);
  for (const m of [ctx.a, ctx.b]) {
    const s = m.snapshot();
    assert.equal(s.scores[turn], 1);
    assert.equal(s.racks[1 - turn].filter(Boolean).length, RULES.cups - 1);
    assert.equal(s.racks[turn].filter(Boolean).length, RULES.cups, 'only the target rack is touched');
  }
});

test('two balls miss: the turn passes; round advances when the second player finishes', async () => {
  const ctx = await setup();
  const first = ctx.a.snapshot().first;
  await throwBy(ctx, MISS);
  const ev = await throwBy(ctx, MISS);
  assert.equal(ev.switched, true);
  assert.equal(ev.roundAdvanced, false);
  assert.equal(ctx.a.snapshot().turn, 1 - first);
  assert.equal(ctx.a.snapshot().round, 1);
  await throwBy(ctx, MISS);
  const ev2 = await throwBy(ctx, MISS);
  assert.equal(ev2.roundAdvanced, true);
  assert.equal(ctx.a.snapshot().round, 2);
  assert.equal(ctx.b.snapshot().round, 2);
  assert.equal(ctx.a.snapshot().turn, first);
});

test('both balls in earns an extra turn', async () => {
  const ctx = await setup();
  const turn = ctx.a.snapshot().turn;
  await throwBy(ctx, scoringThrow(ctx.byseat[turn]));
  const ev = await throwBy(ctx, scoringThrow(ctx.byseat[turn]));
  assert.equal(ev.extra, true);
  assert.equal(ev.switched, false);
  for (const m of [ctx.a, ctx.b]) {
    assert.equal(m.snapshot().turn, turn, 'the same player throws again');
    assert.equal(m.snapshot().ball, 1);
    assert.equal(m.snapshot().scores[turn], 2);
  }
});

test('five rounds of misses end in a draw and both sides report it', async () => {
  const ctx = await setup();
  for (let i = 0; i < RULES.rounds * 2 * RULES.balls; i++) await throwBy(ctx, MISS);
  for (const [m, s] of [[ctx.a, ctx.sessions[0]], [ctx.b, ctx.sessions[1]]]) {
    assert.equal(m.snapshot().phase, 'over');
    assert.deepEqual(m.snapshot().over, {winner: null, reason: 'rounds'});
    assert.deepEqual(s.result, {});
  }
  assert.equal(ctx.a.throw(...MISS), null, 'no throwing after the match');
});

test('more cups after round five wins the match', async () => {
  const ctx = await setup();
  const first = ctx.a.snapshot().first;
  for (let turn = 0; turn < RULES.rounds * 2; turn++) {
    const thrower = ctx.a.snapshot().turn;
    for (let ball = 0; ball < RULES.balls; ball++) {
      if (ctx.a.snapshot().phase === 'over' || ctx.a.snapshot().turn !== thrower) break;
      await throwBy(ctx, thrower === first ? scoringThrow(ctx.byseat[thrower]) : MISS);
    }
  }
  assert.equal(ctx.a.snapshot().phase, 'over');
  const winner = ctx.a.snapshot().over.winner;
  assert.equal(winner, first);
  assert.equal(ctx.sessions[0].result.winnerId, ctx.sessions[0].players[first].id);
  assert.deepEqual(ctx.a.snapshot().over, ctx.b.snapshot().over);
});

test('clearing every cup wins at once', async () => {
  const ctx = await setup();
  const first = ctx.a.snapshot().first;
  for (let i = 0; i < RULES.cups && ctx.a.snapshot().phase === 'play'; i++) await throwBy(ctx, scoringThrow(ctx.byseat[first]));
  assert.equal(ctx.a.snapshot().phase, 'over');
  assert.deepEqual(ctx.a.snapshot().over, {winner: first, reason: 'cups'});
  assert.deepEqual(ctx.b.snapshot().over, {winner: first, reason: 'cups'});
  assert.equal(ctx.a.snapshot().racks[1 - first].some(Boolean), false);
});

test('a throw whose outcome differs from what the receiver computes is a desync', async () => {
  const ctx = await setup();
  const turn = ctx.a.snapshot().turn;
  const thrower = ctx.sessions[turn].selfId;
  ctx.net.intercept = (from, to, msg) => (from === thrower && msg.t === 'throw' ? {...msg, o: msg.o === 'in' ? 'miss' : 'in'} : msg);
  ctx.byseat[turn].throw(...MISS);
  await settle(20);
  assert.equal(ctx.byseat[1 - turn].snapshot().phase, 'desync');
  assert.match(ctx.byseat[1 - turn].snapshot().error, /disagree/);
});

test('a different physics version is refused before any play', async () => {
  const {net, sessions} = memorySessions();
  net.intercept = (from, to, msg) => (msg.t === 'hello' ? {...msg, v: 'other'} : msg);
  const a = new CupPongMatch({session: sessions[0]});
  const b = new CupPongMatch({session: sessions[1]});
  await settle(60);
  assert.equal(a.snapshot().phase, 'incompatible');
  assert.equal(b.snapshot().phase, 'incompatible');
});

test('a tampered coin-flip reveal is caught', async () => {
  const {net, sessions} = memorySessions();
  net.intercept = (from, to, msg) => (from === 'bob' && msg.t === 'reveal' ? {...msg, bit: 1 - msg.bit} : msg);
  const a = new CupPongMatch({session: sessions[0]});
  new CupPongMatch({session: sessions[1]});
  await settle(80);
  assert.equal(a.snapshot().phase, 'desync');
});

test('junk, duplicates and out-of-turn messages never crash or change the score', async () => {
  const ctx = await setup();
  const turn = ctx.a.snapshot().turn;
  const other = ctx.transports[1 - turn];
  const to = ctx.sessions[turn].selfId;
  for (const junk of [null, 'x', 5, {}, {t: 5}, {t: 'throw'}, {t: 'throw', i: 'a', a: 0, p: 0}, {t: 'throw', i: 0, a: 999, p: 0}, {t: 'commit', h: 'zz'}, {t: 'sync', n: -1}, {t: 'log', from: 0, throws: 'no'}]) {
    other.send(junk, to);
  }
  await settle(20);
  assert.equal(ctx.byseat[turn].snapshot().phase, 'play');
  assert.equal(ctx.byseat[turn].snapshot().throws, 0);
  // the opponent throwing when it is not their turn voids the match
  other.send({t: 'throw', i: 0, a: 0, p: 0, o: 'miss', c: -1}, to);
  await settle(20);
  assert.equal(ctx.byseat[turn].snapshot().phase, 'desync');
});

test('a duplicate throw message is ignored', async () => {
  const ctx = await setup();
  const turn = ctx.a.snapshot().turn;
  let copy = null;
  ctx.net.intercept = (from, to, msg) => { if (msg.t === 'throw') copy = {from, to, msg}; return msg; };
  ctx.byseat[turn].throw(...MISS);
  await settle(20);
  ctx.transports[turn].send(copy.msg, copy.to);
  await settle(20);
  assert.equal(ctx.byseat[1 - turn].snapshot().throws, 1);
  assert.equal(ctx.byseat[1 - turn].snapshot().phase, 'play');
});

test('after a dropped connection the sides resync from their throw logs', async () => {
  const ctx = await setup();
  const turn = ctx.a.snapshot().turn;
  const [mine, theirs] = [ctx.byseat[turn], ctx.byseat[1 - turn]];
  await throwBy(ctx, MISS); // both see ball 1
  ctx.net.intercept = () => null; // the connection drops: everything is lost
  mine.throw(...MISS);
  await settle(20);
  assert.equal(mine.snapshot().throws, 2);
  assert.equal(theirs.snapshot().throws, 1, 'the other side missed it');
  ctx.net.intercept = null; // back online
  ctx.sessions.forEach((s) => s.onPeerJoin?.(s.players.find((p) => p.id !== s.selfId).id));
  await settle(40);
  assert.equal(theirs.snapshot().throws, 2, 'caught up from the log');
  assert.deepEqual(mine.snapshot().racks, theirs.snapshot().racks);
  assert.equal(mine.snapshot().turn, theirs.snapshot().turn);
  assert.equal(theirs.snapshot().phase, 'play');
});

test('a throw that arrives after a gap triggers a resync instead of being applied wrongly', async () => {
  const ctx = await setup();
  const turn = ctx.a.snapshot().turn;
  const [mine, theirs] = [ctx.byseat[turn], ctx.byseat[1 - turn]];
  let drop = true;
  ctx.net.intercept = (from, to, msg) => (drop && msg.t === 'throw' ? null : msg);
  mine.throw(...MISS); // lost
  await settle(20);
  drop = false;
  mine.throw(...MISS); // arrives as index 1 while the other side has none
  await settle(60);
  assert.equal(theirs.snapshot().throws, 2, 'filled in through the log');
  assert.equal(theirs.snapshot().phase, 'play');
});

test('presence changes are reported', async () => {
  const ctx = await setup();
  ctx.sessions[0].onPeerLeave?.('bob');
  assert.equal(ctx.a.away, true);
  assert.equal(ctx.a.canThrow(), false);
  assert.ok(ctx.events[0].some((e) => e.type === 'away' && e.away));
});

test('a destroyed match stops reporting', async () => {
  const ctx = await setup();
  const turn = ctx.a.snapshot().turn;
  const before = ctx.events[1 - turn].length;
  ctx.byseat[1 - turn].destroy();
  ctx.byseat[turn].throw(...MISS);
  await settle(20);
  assert.equal(ctx.events[1 - turn].length, before);
});
