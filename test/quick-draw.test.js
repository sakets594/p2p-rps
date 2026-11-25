import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  HUMAN_LIMIT_MS, MAX_WAIT_MS, MIN_WAIT_MS, REACT_TIMEOUT_MS, classify, fakeouts, judge, standoffMs, validResult,
} from '../js/games/quick-draw/rules.js';
import {QuickDrawMatch} from '../js/games/quick-draw/match.js';
import {memorySessions} from '../js/memory-transport.js';

test('rules: the standoff length is the same for the same session and round, and within bounds', () => {
  for (let round = 1; round <= 7; round++) {
    const ms = standoffMs('sid-1', round);
    assert.equal(ms, standoffMs('sid-1', round));
    assert.ok(ms >= MIN_WAIT_MS && ms < MAX_WAIT_MS, String(ms));
  }
  const lengths = new Set([1, 2, 3, 4, 5].map((r) => standoffMs('sid-1', r)));
  assert.ok(lengths.size > 1, 'it varies between rounds, so it cannot be guessed');
  assert.notEqual(standoffMs('sid-1', 1), standoffMs('sid-2', 1));
});

test('rules: fake-outs are deterministic, sorted, spaced, and never close to DRAW', () => {
  for (let round = 1; round <= 7; round++) {
    const wait = standoffMs('sid-x', round);
    const f = fakeouts('sid-x', round, wait);
    assert.deepEqual(f, fakeouts('sid-x', round, wait));
    for (const [i, e] of f.entries()) {
      assert.ok(e.at >= 400 && e.at <= wait - 700, `${e.at} of ${wait}`);
      if (i) assert.ok(e.at - f[i - 1].at > 500);
    }
  }
  assert.deepEqual(fakeouts('s', 1, 1000), [], 'a short wait has none');
});

test('rules: judging a round', () => {
  const t = (ms) => ({early: false, ms});
  const early = {early: true, ms: null};
  const none = {early: false, ms: null};
  assert.equal(judge(t(200), t(300)), 0);
  assert.equal(judge(t(300), t(200)), 1);
  assert.equal(judge(t(250), t(250)), 'draw');
  assert.equal(judge(early, t(900)), 1, 'a false start loses even to a slow tap');
  assert.equal(judge(t(900), early), 0);
  assert.equal(judge(early, early), 'draw');
  assert.equal(judge(none, t(1100)), 1, 'a tap beats no tap');
  assert.equal(judge(none, none), 'draw');
  assert.equal(judge(early, none), 1);
});

test('rules: classify and validate reports', () => {
  assert.deepEqual(classify(null), {early: false, ms: null});
  assert.deepEqual(classify(HUMAN_LIMIT_MS - 1), {early: true, ms: null}, 'too quick to be a reaction');
  assert.deepEqual(classify(231.6), {early: false, ms: 232});
  assert.equal(validResult({early: false, ms: 200}), true);
  assert.equal(validResult({early: true, ms: null}), true);
  assert.equal(validResult({early: 'no', ms: 200}), false);
  assert.equal(validResult({early: false, ms: -5}), false);
  assert.equal(validResult({early: false, ms: NaN}), false);
  assert.equal(validResult(null), false);
});

// --- the match ----------------------------------------------------------------------------------

const turn = () => new Promise((r) => setImmediate(r));

function pair() {
  const {net, sessions: [sa, sb]} = memorySessions({sid: 'duel-1'});
  const p = {net, sa, sb, clock: {t: 1000}};
  p.a = new QuickDrawMatch({session: sa});
  p.b = new QuickDrawMatch({session: sb});
  return p;
}

async function runTo(p, t) {
  while (p.clock.t < t) {
    p.clock.t += 5;
    p.a.update(p.clock.t);
    p.b.update(p.clock.t);
    await turn();
  }
}

/** Both ready, then play until just before DRAW. Returns the DRAW time (on the shared fake clock). */
async function standoff(p) {
  p.a.ready(); p.b.ready();
  await turn();
  await runTo(p, p.clock.t + 20);
  assert.equal(p.a.snapshot().phase, 'standoff');
  return p.a.snapshot().drawAt;
}

test('match: nothing happens until both are ready, then the standoff runs and DRAW arrives on both screens', async () => {
  const p = pair();
  await runTo(p, 2000);
  assert.equal(p.a.snapshot().phase, 'waiting');
  p.a.ready();
  await runTo(p, 3000);
  assert.equal(p.a.snapshot().phase, 'waiting');
  p.b.ready();
  await runTo(p, 3100);
  assert.equal(p.a.snapshot().phase, 'standoff');
  const wait = p.a.snapshot().waitMs;
  assert.equal(wait, standoffMs('duel-1', 1));
  await runTo(p, 3000 + wait + 50);
  assert.equal(p.a.snapshot().phase, 'draw');
  assert.equal(p.b.snapshot().phase, 'draw');
});

test('match: the faster reaction wins on both screens and scores once', async () => {
  const p = pair();
  const drawAt = await standoff(p);
  await runTo(p, drawAt + 210);
  assert.equal(p.b.tap(p.clock.t), true);     // seat 1 fires at +210
  await runTo(p, drawAt + 300);
  assert.equal(p.a.tap(p.clock.t), true);     // seat 0 at +300
  await runTo(p, drawAt + 400);
  for (const m of [p.a, p.b]) {
    const s = m.snapshot();
    assert.equal(s.phase, 'result');
    assert.equal(s.last.winner, 1);
    assert.deepEqual(s.scores, [0, 1]);
    assert.ok(s.last.results[1].ms < s.last.results[0].ms);
  }
  assert.equal(p.a.tap(p.clock.t), false, 'cannot fire twice');
});

test('match: firing early is a false start and loses at once, even if the other has not fired', async () => {
  const p = pair();
  const drawAt = await standoff(p);
  assert.ok(p.clock.t < drawAt - 500);
  assert.equal(p.a.tap(p.clock.t), true);
  await runTo(p, p.clock.t + 50);
  for (const m of [p.a, p.b]) {
    const s = m.snapshot();
    assert.equal(s.phase, 'result', 'no need to wait for the other to react');
    assert.equal(s.last.winner, 1);
    assert.equal(s.last.results[0].early, true);
  }
});

test('match: both firing early replays the round, nobody scores', async () => {
  const p = pair();
  await standoff(p);
  p.a.tap(p.clock.t);
  p.b.tap(p.clock.t);
  await runTo(p, p.clock.t + 50);
  assert.equal(p.a.snapshot().last.winner, 'draw');
  assert.deepEqual(p.a.snapshot().scores, [0, 0]);
  assert.equal(p.a.nextRound(), true);
  assert.equal(p.a.snapshot().round, 2);
  assert.equal(p.a.snapshot().phase, 'waiting');
});

test('match: nobody firing is a draw after the timeout; one slow tap still beats no tap', async () => {
  let p = pair();
  let drawAt = await standoff(p);
  await runTo(p, drawAt + REACT_TIMEOUT_MS + 100);
  assert.equal(p.a.snapshot().last.winner, 'draw');

  p = pair();
  drawAt = await standoff(p);
  await runTo(p, drawAt + 900);
  p.a.tap(p.clock.t);
  await runTo(p, drawAt + REACT_TIMEOUT_MS + 200);
  assert.equal(p.a.snapshot().last.winner, 0);
  assert.equal(p.b.snapshot().last.winner, 0);
});

test('match: a reaction under the human limit counts as a guess (false start)', async () => {
  const p = pair();
  const drawAt = await standoff(p);
  await runTo(p, drawAt + 30);
  p.a.tap(p.clock.t);
  await runTo(p, drawAt + 400);
  p.b.tap(p.clock.t);
  await runTo(p, drawAt + 500);
  assert.equal(p.a.snapshot().last.winner, 1);
});

test('match: first to three wins the match; the session reports it once', async () => {
  const p = pair();
  for (let r = 1; r <= 3; r++) {
    const drawAt = await standoff(p);
    await runTo(p, drawAt + 200);
    p.a.tap(p.clock.t);                    // seat 0 always fires first
    await runTo(p, p.clock.t + 150);
    p.b.tap(p.clock.t);
    await runTo(p, p.clock.t + 100);
    assert.equal(p.a.snapshot().last.winner, 0);
    if (r < 3) { p.a.nextRound(); p.b.nextRound(); await turn(); }
  }
  assert.equal(p.a.snapshot().finished, true);
  assert.equal(p.a.snapshot().phase, 'finished');
  assert.deepEqual(p.a.snapshot().scores, [3, 0]);
  assert.deepEqual(p.sa.result, {winnerId: 'alice'});
  assert.deepEqual(p.sb.result, {winnerId: 'alice'});
  assert.equal(p.a.nextRound(), false);
});

test('match: junk and out-of-turn messages are ignored', async () => {
  const p = pair();
  const drawAt = await standoff(p);
  for (const m of [null, 'x', {t: 'result', round: 1, early: 'yes', ms: 5}, {t: 'result', round: 1, early: false, ms: -3},
    {t: 'result', round: 9, early: false, ms: 300}, {t: 'ready', round: 1}, {t: 'nope', round: 1}]) p.sa.onMessage(m);
  assert.equal(p.a.snapshot().phase, 'standoff');
  await runTo(p, drawAt + 100);
  assert.equal(p.a.snapshot().phase, 'draw');
  assert.equal(p.a.snapshot().theirs, null);
});
