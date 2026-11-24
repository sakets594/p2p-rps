import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FX_PARAMS, PRESETS, VIBES, burstParams, expired, fxForScenario, makeBurst, makeRing, ringProgress, stepParticles, stepRings, vibrate} from '../js/fx.js';

const seeded = () => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

test('a burst has the configured number of pieces, all launched upward from the origin', () => {
  const parts = makeBurst(100, 200, {...FX_PARAMS, count: 25}, seeded());
  assert.equal(parts.length, 25);
  for (const q of parts) {
    assert.equal(q.x, 100);
    assert.equal(q.y, 200);
    assert.ok(q.vy < 0, 'moving up');
  }
});

test('a zero spread launches straight up', () => {
  for (const q of makeBurst(0, 0, {...FX_PARAMS, spread: 0}, seeded())) assert.ok(Math.abs(q.vx) < 1e-9);
});

test('pieces fall back down under gravity and the input is left alone', () => {
  const [q] = makeBurst(0, 0, {...FX_PARAMS, count: 1, spread: 0}, seeded());
  const before = {...q};
  let cur = [q];
  for (let i = 0; i < 20; i++) cur = stepParticles(cur, 50, {...FX_PARAMS, life: 5000});
  assert.deepEqual(q, before);
  assert.ok(cur[0].vy > 0, 'now falling');
});

test('pieces disappear once their life is over', () => {
  const parts = makeBurst(0, 0, {...FX_PARAMS, count: 10}, seeded());
  assert.equal(stepParticles(parts, FX_PARAMS.life - 1).length, 10);
  assert.equal(stepParticles(parts, FX_PARAMS.life).length, 0);
});

test('wins, losses and draws get an effect, nothing else does', () => {
  for (const id of ['game.won', 'game.lost', 'game.draw']) assert.equal(typeof fxForScenario(id), 'function', id);
  assert.equal(fxForScenario('room.friend_joined'), null);
});

test('every preset makes a burst with its own colors, life and gravity', () => {
  for (const name of Object.keys(PRESETS)) {
    const {params, palette} = burstParams(name);
    const parts = makeBurst(0, 0, params, seeded(), palette);
    assert.equal(parts.length, PRESETS[name].count, name);
    assert.ok(parts.every((q) => palette.includes(q.color) && q.life === PRESETS[name].life && q.gravity === PRESETS[name].gravity), name);
  }
});

test('a preset can be tinted with the players\' colors, and an unknown preset falls back to pop', () => {
  const {palette} = burstParams('pop', ['#123456']);
  assert.deepEqual(palette, ['#123456']);
  assert.equal(burstParams('nope').params.count, PRESETS.pop.count);
});

test('short-lived pieces go away on their own life, not the confetti life', () => {
  const {params, palette} = burstParams('splash');
  const parts = makeBurst(0, 0, params, seeded(), palette);
  assert.equal(stepParticles(parts, PRESETS.splash.life - 1).length, parts.length);
  assert.equal(stepParticles(parts, PRESETS.splash.life).length, 0);
});

test('vibrate sends the named pattern, does nothing without support and honours the haptics switch', () => {
  const calls = [];
  Object.defineProperty(globalThis, 'navigator', {value: {vibrate: (p) => calls.push(p)}, configurable: true});
  vibrate('hit');
  assert.deepEqual(calls, [VIBES.hit]);
  FX_PARAMS.haptics = false;
  vibrate('hit');
  FX_PARAMS.haptics = true;
  assert.equal(calls.length, 1);
  Object.defineProperty(globalThis, 'navigator', {value: {}, configurable: true});
  assert.doesNotThrow(() => vibrate('hit'));
});

test('presets use the shapes they ask for, and emoji pieces carry a character', () => {
  const shapesOf = (name) => {
    const {params, palette} = burstParams(name);
    return new Set(makeBurst(0, 0, {...params, count: 200}, seeded(), palette).map((q) => q.shape));
  };
  assert.deepEqual([...shapesOf('sparkle')], ['star']);
  assert.ok(shapesOf('bigBoom').size > 1, 'a mix of shapes');
  const {params, palette} = burstParams('fire');
  assert.ok(makeBurst(0, 0, params, seeded(), palette).every((q) => q.shape === 'emoji' && q.char === '🔥'));
  assert.ok(makeBurst(0, 0).every((q) => q.shape === 'rect'), 'confetti stays rectangles');
});

test('smoke rises: negative gravity pulls a piece up', () => {
  const {params, palette} = burstParams('smoke');
  let cur = makeBurst(0, 0, {...params, count: 1, spread: 0}, seeded(), palette);
  const y0 = cur[0].y;
  for (let i = 0; i < 10; i++) cur = stepParticles(cur, 50);
  assert.ok(cur[0].y < y0);
});

test('a firework rocket turns into a burst when its life ends, other pieces do not', () => {
  const {params, palette} = burstParams('rocket');
  const [rocket] = makeBurst(0, 0, params, seeded(), palette);
  assert.equal(rocket.boom, 'firework');
  assert.equal(expired([rocket], params.life - 1).length, 0);
  assert.equal(expired([rocket], params.life).length, 1);
  assert.equal(expired(makeBurst(0, 0, {...FX_PARAMS, count: 5}, seeded()), 100000).length, 0);
  assert.ok(burstParams('firework').params.count > 20, 'the burst it turns into is a real one');
});

test('rockets keep going straight, with no gravity or drag', () => {
  const {params, palette} = burstParams('rocket');
  let cur = makeBurst(0, 100, {...params, speed: 600, spread: 0}, seeded(), palette);
  const vy = cur[0].vy;
  cur = stepParticles(cur, 200);
  assert.equal(cur[0].vy, vy);
  assert.ok(cur[0].y < 100);
});

test('rings wait out their delay, grow, and are removed at the end of their life', () => {
  const r = makeRing(10, 20, '#fff', {life: 500, delay: 200});
  assert.equal(ringProgress(r), 0, 'still waiting');
  let rings = stepRings([r], 200);
  assert.equal(rings[0].age, 0);
  rings = stepRings(rings, 250);
  assert.ok(ringProgress(rings[0]) > 0.4 && ringProgress(rings[0]) < 0.6);
  assert.equal(stepRings(rings, 250).length, 0);
  assert.equal(r.age, -200, 'the input is left alone');
});
