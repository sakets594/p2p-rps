import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlayer} from '../js/sound.js';
import {clipsFor, DEFAULT_MAX_SECS, maxSecsFor} from '../js/sound-map.js';

// A fake audio engine that records what was started and stopped.
function fakeEngine({duration = 2} = {}) {
  const log = {started: [], stopped: [], loaded: [], resumed: 0};
  const ctx = {
    state: 'suspended',
    currentTime: 0,
    destination: {},
    resume: async () => { log.resumed++; },
    decodeAudioData: async (bytes) => ({duration, bytes}),
    createGain: () => ({gain: {value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}}, connect() {}}),
    createBufferSource() {
      const src = {
        buffer: null,
        connect() {},
        start() { log.started.push(src); },
        stop(t) { log.stopped.push({src, t}); },
      };
      return src;
    },
  };
  return {log, ctx, load: async (path) => { log.loaded.push(path); return path; }};
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('play: loads the picked clip, starts it, and returns its path', async () => {
  const e = fakeEngine();
  const p = createPlayer({makeContext: () => e.ctx, load: e.load, rng: () => 0});
  const path = p.play('cp.my_hit');
  assert.equal(path, clipsFor('cp.my_hit')[0]);
  await tick();
  assert.deepEqual(e.log.loaded, [path]);
  assert.equal(e.log.started.length, 1);
});

test('play: a clip is fetched once, then reused', async () => {
  const e = fakeEngine();
  const p = createPlayer({makeContext: () => e.ctx, load: e.load, rng: () => 0});
  p.play('game.start');
  await tick();
  p.play('game.start'); // different clip: the no-repeat rule
  p.play('game.start'); // back to the first: already decoded
  await tick();
  assert.equal(new Set(e.log.loaded).size, e.log.loaded.length, 'no clip fetched twice');
});

test('play: a newer moment cuts the clip that is still playing', async () => {
  const e = fakeEngine({duration: 10});
  const p = createPlayer({makeContext: () => e.ctx, load: e.load, rng: () => 0});
  p.play('cp.my_hit');
  await tick();
  p.play('cp.their_hit');
  await tick();
  assert.equal(e.log.started.length, 2);
  assert.ok(e.log.stopped.some((s) => s.src === e.log.started[0]), 'the first one was stopped');
});

test('play: a long clip is cut to the scenario maxSecs', async () => {
  const e = fakeEngine({duration: 10});
  const p = createPlayer({makeContext: () => e.ctx, load: e.load, rng: () => 0});
  p.play('cp.my_hit');
  await tick();
  const stop = e.log.stopped.find((s) => s.src === e.log.started[0]);
  assert.ok(stop && stop.t <= maxSecsFor('cp.my_hit') + 0.1, 'scheduled to stop at the cap');
  assert.equal(maxSecsFor('cp.my_hit'), DEFAULT_MAX_SECS);
});

test('muted: nothing loads or plays, and unmuting brings sound back', async () => {
  const e = fakeEngine();
  const p = createPlayer({makeContext: () => e.ctx, load: e.load});
  p.setMuted(true);
  assert.equal(p.isMuted(), true);
  assert.equal(p.play('cp.my_hit'), null);
  await tick();
  assert.equal(e.log.started.length, 0);
  p.setMuted(false);
  assert.ok(p.play('cp.my_hit'));
  await tick();
  assert.equal(e.log.started.length, 1);
});

test('muting while a clip is loading stops it from playing afterwards', async () => {
  const e = fakeEngine();
  const p = createPlayer({makeContext: () => e.ctx, load: e.load});
  p.play('cp.my_hit');
  p.setMuted(true);
  await tick();
  assert.equal(e.log.started.length, 0);
});

test('a clip that arrives too late for its moment is dropped', async () => {
  const e = fakeEngine();
  let t = 0;
  const p = createPlayer({makeContext: () => e.ctx, load: async (path) => { t += 5000; return path; }, now: () => t});
  p.play('cp.my_hit');
  await tick();
  assert.equal(e.log.started.length, 0);
});

test('unknown scenario, missing audio support and failed downloads are all silent no-ops', async () => {
  const none = createPlayer({makeContext: () => { throw new Error('no audio'); }});
  assert.doesNotThrow(() => none.play('cp.my_hit'));
  assert.doesNotThrow(() => none.unlock());

  const e = fakeEngine();
  const broken = createPlayer({makeContext: () => e.ctx, load: async () => { throw new Error('404'); }});
  assert.equal(broken.play('nope.nothing'), null);
  assert.doesNotThrow(() => broken.play('cp.my_hit'));
  await tick();
  assert.equal(e.log.started.length, 0);
});

test('unlock: wakes the audio engine and preloads every mapped clip', async () => {
  const e = fakeEngine();
  const p = createPlayer({makeContext: () => e.ctx, load: e.load});
  p.unlock();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(e.log.resumed, 1);
  assert.equal(new Set(e.log.loaded).size, 31);
});
