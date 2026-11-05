import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SHIPS, SIZE, cellsOf, randomFleet, resolveShot, validFleet} from '../js/games/battleship/rules.js';
import {BattleshipMatch} from '../js/games/battleship/match.js';
import {seededRandom} from '../js/rng.js';
import {memorySessions, settle} from '../js/memory-transport.js';

test('random fleets are always legal and differ between seeds', () => {
  for (let i = 0; i < 200; i++) {
    const f = randomFleet(seededRandom(`seed${i}`));
    assert.ok(validFleet(f), `fleet ${i}`);
    assert.equal(f.reduce((n, s) => n + s.size, 0), SHIPS.reduce((a, b) => a + b));
  }
  assert.notDeepEqual(randomFleet(seededRandom('a')), randomFleet(seededRandom('b')));
});

test('validFleet rejects overlap, off-sea ships, wrong sizes and junk', () => {
  const good = randomFleet(seededRandom('g'));
  assert.equal(validFleet(good), true);
  assert.equal(validFleet(good.slice(1)), false);
  assert.equal(validFleet(null), false);
  assert.equal(validFleet(good.map((s, i) => (i === 0 ? {...s, r: SIZE - 1, c: SIZE - 1, h: true} : s))), false);
  assert.equal(validFleet(good.map((s) => ({...s, r: good[0].r, c: good[0].c}))), false);
  assert.equal(validFleet(good.map((s, i) => (i === 0 ? {...s, size: 9} : s))), false);
  assert.equal(validFleet(good.map((s, i) => (i === 0 ? {...s, h: 'yes'} : s))), false);
});

test('resolveShot: miss, hit, sink and fleet over', () => {
  const fleet = [{size: 2, r: 0, c: 0, h: true}];
  assert.deepEqual(resolveShot(fleet, [], 5, 5), {hit: false, sunk: 0, over: false});
  assert.deepEqual(resolveShot(fleet, [], 0, 0), {hit: true, sunk: 0, over: false});
  assert.deepEqual(resolveShot(fleet, ['0,0'], 0, 1), {hit: true, sunk: 2, over: true});
});

const pair = () => {
  const {net, sessions: [sa, sb], transports} = memorySessions();
  const a = new BattleshipMatch({session: sa, random: seededRandom('alice')});
  const b = new BattleshipMatch({session: sb, random: seededRandom('bob')});
  return {net, transports, a, b, sa, sb};
};

const start = async ({a, b}) => { a.ready(); b.ready(); await settle(); };

async function playOut(a, b) {
  const order = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) order.push([r, c]);
  const next = {a: 0, b: 0};
  for (let guard = 0; guard < 400 && a.snapshot().phase !== 'over'; guard++) {
    const [who, key] = a.snapshot().myTurn ? [a, 'a'] : [b, 'b'];
    const [r, c] = order[next[key]++];
    who.fire(r, c);
    await settle(2);
  }
  await settle(30);
}

test('both fleets are committed before battle starts, and the first shooter is agreed', async () => {
  const p = pair();
  assert.equal(p.a.snapshot().phase, 'placing');
  p.a.ready();
  await settle();
  assert.equal(p.a.snapshot().phase, 'waiting');
  assert.equal(p.a.fire(0, 0), false, 'cannot shoot before the other is ready');
  p.b.ready();
  await settle();
  assert.equal(p.a.snapshot().phase, 'battle');
  assert.equal(p.b.snapshot().phase, 'battle');
  assert.equal(p.a.snapshot().myTurn, !p.b.snapshot().myTurn);
});

test('shuffle changes the fleet only while placing', async () => {
  const p = pair();
  const before = JSON.stringify(p.a.snapshot().fleet);
  p.a.shuffle();
  assert.notEqual(JSON.stringify(p.a.snapshot().fleet), before);
  await start(p);
  const locked = JSON.stringify(p.a.snapshot().fleet);
  p.a.shuffle();
  assert.equal(JSON.stringify(p.a.snapshot().fleet), locked);
});

test('a full honest game ends with one winner, the same on both sides, and both fleets verify', async () => {
  const p = pair();
  await start(p);
  await playOut(p.a, p.b);
  const sa = p.a.snapshot(), sb = p.b.snapshot();
  assert.equal(sa.phase, 'over');
  assert.equal(sa.winner, sb.winner);
  assert.equal(sa.won, !sb.won);
  assert.equal(sa.verified, true);
  assert.equal(sb.verified, true);
  assert.deepEqual(p.sa.result, p.sb.result);
  assert.ok(p.sa.result.winnerId);
  assert.equal(sa.theirFleet.length, 5);
});

test('shooting out of turn, twice at one cell, or off the map does nothing', async () => {
  const p = pair();
  await start(p);
  const [mine, theirs] = p.a.snapshot().myTurn ? [p.a, p.b] : [p.b, p.a];
  assert.equal(theirs.fire(0, 0), false);
  assert.equal(mine.fire(-1, 0), false);
  assert.equal(mine.fire(0, SIZE), false);
  assert.equal(mine.fire(2, 2), true);
  assert.equal(mine.fire(3, 3), false, 'still waiting for the answer');
  await settle();
  assert.equal(theirs.snapshot().incoming.length, 1);
  theirs.fire(0, 0);
  await settle();
  assert.equal(mine.fire(2, 2), false, 'cell already shot');
});

test('a lying answer is caught when the fleets are revealed', async () => {
  const p = pair();
  // The friend (bob) says "miss" to every hit.
  p.net.intercept = (from, to, msg) => (from === 'bob' && msg.t === 'result' && msg.hit ? {...msg, hit: false, sunk: 0} : msg);
  await start(p);
  await playOut(p.a, p.b);
  assert.equal(p.a.snapshot().phase, 'over');
  assert.equal(p.a.snapshot().verified, false);
  assert.match(p.a.snapshot().error, /may have cheated/);
  assert.equal(p.b.snapshot().verified, true, 'the honest side is not accused');
});

test('a fleet swapped after committing is caught', async () => {
  const p = pair();
  // Bob reveals a different (still legal) fleet from the one he committed to.
  p.net.intercept = (from, to, msg) => (from === 'bob' && msg.t === 'reveal' ? {...msg, nonce: 'tampered'} : msg);
  await start(p);
  await playOut(p.a, p.b);
  assert.equal(p.a.snapshot().verified, false);
});

test('junk messages are ignored', async () => {
  const p = pair();
  await start(p);
  const [, ta] = [0, p.transports[0]];
  for (const junk of [null, 5, 'x', {t: 'shot', r: 'a', c: 1}, {t: 'result', r: 1, c: 1, hit: 'yes'}, {t: 'reveal', fleet: 3, nonce: 1}, {t: 'fleet', hash: 'zz'}]) {
    ta.send(junk, 'bob');
  }
  await settle();
  assert.equal(p.b.snapshot().phase, 'battle');
  assert.equal(p.b.snapshot().incoming.length, 0);
  assert.equal(p.b.snapshot().error, null);
});
