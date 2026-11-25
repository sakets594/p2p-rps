import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DOWN, DX, DY, H, INPUT_DELAY, LEFT, RIGHT, UP, W, newRound, stateHash, step, tickMsAt} from '../js/games/tron/rules.js';
import {COUNT_MS, COUNT_STEPS, TronMatch} from '../js/games/tron/match.js';
import {memorySessions} from '../js/memory-transport.js';

test('rules: a new round has the bikes facing each other on different rows, each on its own trail', () => {
  const s = newRound();
  assert.equal(s.bikes[0].d, RIGHT);
  assert.equal(s.bikes[1].d, LEFT);
  assert.notEqual(s.bikes[0].y, s.bikes[1].y);
  assert.equal(s.grid[s.bikes[0].y * W + s.bikes[0].x], 1);
  assert.equal(s.grid[s.bikes[1].y * W + s.bikes[1].x], 2);
  assert.equal(s.over, false);
});

test('rules: bikes move one cell a tick and leave a trail', () => {
  const s = newRound();
  const {x, y} = s.bikes[0];
  step(s, [null, null]);
  assert.deepEqual([s.bikes[0].x, s.bikes[0].y], [x + 1, y]);
  assert.equal(s.grid[y * W + x + 1], 1);
  assert.equal(s.grid[y * W + x], 1, 'the old cell stays a wall');
  assert.equal(s.tick, 1);
});

test('rules: turning works, reversing is ignored', () => {
  const s = newRound();
  step(s, [UP, LEFT]);                  // seat 1 asked to go left: it already is
  assert.equal(s.bikes[0].d, UP);
  step(s, [DOWN, null]);               // reversing seat 0 (heading up) is ignored
  assert.equal(s.bikes[0].d, UP);
});

test('rules: hitting the edge, a trail or the other bike ends the round; same-cell is a draw', () => {
  let s = newRound();
  s.bikes[0].x = W - 1; s.bikes[0].d = RIGHT;
  step(s, [null, null]);
  assert.equal(s.over, true);
  assert.equal(s.winner, 1);
  assert.deepEqual(s.crashed, [0]);

  // seat 0 turns back across its own trail
  s = newRound();
  step(s, [UP, null]); step(s, [LEFT, null]); step(s, [DOWN, null]);
  step(s, [RIGHT, null]);
  assert.equal(s.over, true);
  assert.equal(s.winner, 1);

  // both bikes into the same empty cell
  s = newRound();
  s.bikes[0].x = 10; s.bikes[0].y = 10; s.bikes[0].d = RIGHT;
  s.bikes[1].x = 12; s.bikes[1].y = 10; s.bikes[1].d = LEFT;
  step(s, [null, null]);
  assert.equal(s.winner, 'draw');
  assert.equal(s.over, true);
});

test('rules: stepping a finished round does nothing, and the hash follows the state', () => {
  const a = newRound(); const b = newRound();
  assert.equal(stateHash(a), stateHash(b));
  step(a, [null, null]);
  assert.notEqual(stateHash(a), stateHash(b));
  step(b, [null, null]);
  assert.equal(stateHash(a), stateHash(b));
  a.over = true;
  const before = stateHash(a);
  step(a, [UP, UP]);
  assert.equal(stateHash(a), before);
  assert.ok(tickMsAt(0) > tickMsAt(500));
  assert.ok(DX.length === 4 && DY.length === 4 && H === W);
});

// --- the match ----------------------------------------------------------------------------------

const turn = () => new Promise((r) => setImmediate(r));

function pair() {
  const {net, sessions: [sa, sb]} = memorySessions();
  const a = new TronMatch({session: sa});
  const b = new TronMatch({session: sb});
  return {net, a, b, sa, sb, clock: {t: 1000}};
}

/** Advance the shared fake clock in 5 ms steps, letting messages travel between steps. */
async function run(p, ms, onTick = () => {}) {
  for (let i = 0; i < ms / 5; i++) {
    p.clock.t += 5;
    p.a.update(p.clock.t);
    p.b.update(p.clock.t);
    onTick();
    await turn();
  }
}

async function startRound(p) {
  p.a.ready(); p.b.ready();
  await turn();
  await run(p, COUNT_STEPS * COUNT_MS + 50);
}

test('match: nobody moves until both are ready, then a countdown, then play', async () => {
  const p = pair();
  await run(p, 500);
  assert.equal(p.a.snapshot().phase, 'waiting');
  p.a.ready();
  await run(p, 500);
  assert.equal(p.a.snapshot().phase, 'waiting', 'one ready is not enough');
  p.b.ready();
  await run(p, 100);
  assert.equal(p.a.snapshot(p.clock.t).phase, 'countdown');
  assert.equal(p.b.snapshot(p.clock.t).phase, 'countdown');
  assert.ok([1, 2, 3].includes(p.a.snapshot(p.clock.t).countdown));
  await run(p, COUNT_STEPS * COUNT_MS);
  assert.equal(p.a.snapshot().phase, 'playing');
  await run(p, 400);
  assert.ok(p.a.snapshot().state.tick > 0, 'the bikes are moving');
});

test('match: going straight, both bikes hit the far walls on the same tick and the round is a draw to replay', async () => {
  const p = pair();
  await startRound(p);
  await run(p, 5000);
  for (const m of [p.a, p.b]) {
    const s = m.snapshot();
    assert.equal(s.phase, 'over');
    assert.equal(s.last.winner, 'draw');
    assert.deepEqual(s.scores, [0, 0]);
  }
  assert.equal(p.a.snapshot().state.tick, p.b.snapshot().state.tick);
  assert.equal(stateHash(p.a.snapshot().state), stateHash(p.b.snapshot().state), 'both screens ended in the same place');
  assert.equal(p.a.snapshot().error, null);
  assert.equal(p.a.nextRound(), true);
  assert.equal(p.a.snapshot().round, 2);
  assert.equal(p.a.snapshot().phase, 'waiting');
});

test('match: a steer shows up on both screens, and the bike that turns away outlives the one that does not', async () => {
  const p = pair();
  await startRound(p);
  await run(p, 300);
  assert.equal(p.b.steer(DOWN), true);       // seat 1 heads for the bottom edge (17 cells away), seat 0 keeps going
  await run(p, 5000);
  const sa = p.a.snapshot();
  const sb = p.b.snapshot();
  assert.equal(sa.phase, 'over');
  assert.equal(sa.last.winner, 0, 'seat 0 had further to go');
  assert.deepEqual(sa.scores, [1, 0]);
  assert.deepEqual(sb.scores, [1, 0]);
  assert.equal(stateHash(sa.state), stateHash(sb.state));
  assert.equal(sa.error, null);
  assert.equal(sb.error, null);
});

test('match: first to two rounds wins the match and the session reports it once', async () => {
  const p = pair();
  for (let round = 1; round <= 2; round++) {
    await startRound(p);
    await run(p, 300);
    p.b.steer(DOWN);
    await run(p, 5000);
    assert.equal(p.a.snapshot().phase === 'over' || p.a.snapshot().phase === 'finished', true);
    if (round === 1) {
      p.a.nextRound(); p.b.nextRound();
      await turn();
    }
  }
  assert.equal(p.a.snapshot().finished, true);
  assert.equal(p.b.snapshot().finished, true);
  assert.deepEqual(p.a.snapshot().scores, [2, 0]);
  assert.deepEqual(p.sa.result, {winnerId: 'alice'});
  assert.deepEqual(p.sb.result, {winnerId: 'alice'});
});

test('match: reversing and invalid steers are refused, and turn() is relative to the heading', async () => {
  const p = pair();
  assert.equal(p.a.steer(UP), false, 'not playing yet');
  await startRound(p);
  assert.equal(p.a.steer(LEFT), false, 'seat 0 heads right: left is a reversal');
  assert.equal(p.a.steer(9), false);
  assert.equal(p.a.turn(-1), true, 'turning left of right is up');
  assert.equal(p.a.turn(1), true, 'right of up is straight on again: it cancels the pending turn');
  assert.equal(p.a.turn(1), true, 'and right of straight-on is down');
});

test('match: when the other side stops sending, the round waits instead of drifting apart', async () => {
  const p = pair();
  await startRound(p);
  await run(p, 200);
  p.net.intercept = (_f, _t, msg) => (msg.t === 'in' ? null : msg);
  await run(p, 1500);
  const tick = p.a.snapshot().state.tick;
  assert.ok(tick <= 40, `stalled, not running away (tick ${tick})`);
  assert.equal(p.a.snapshot().stalled, true);
  p.net.intercept = null;
  const before = p.a.snapshot().state.tick;
  await run(p, 300);
  assert.equal(p.a.snapshot().state.tick, before, 'lost inputs are not recovered: still waiting, which is the safe failure');
});

test('match: a screen that disagrees is reported', async () => {
  const p = pair();
  await startRound(p);
  p.net.intercept = (_f, _t, msg) => (msg.t === 'in' ? {...msg, h: (msg.h + 1) >>> 0} : msg);
  await run(p, 600);
  assert.match(p.a.snapshot().error ?? '', /disagree/);
});

test('match: junk messages are ignored', async () => {
  const p = pair();
  await startRound(p);
  for (const m of [null, 'x', {t: 'in', round: 1, k: -1, d: 0}, {t: 'in', round: 1, k: 9999, d: 0}, {t: 'in', round: 1, k: 3, d: 7}, {t: 'ready', round: 1}, {t: 'in', round: 5, k: 3, d: 1}]) p.sa.onMessage(m);
  assert.equal(p.a.snapshot().error, null);
  await run(p, 300);
  assert.equal(p.a.snapshot().error, null);
  assert.ok(INPUT_DELAY >= 1);
});
