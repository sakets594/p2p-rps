import {test} from 'node:test';
import assert from 'node:assert/strict';
import {REFERENCE as P, layoutCups, simulate, predictAtHeight} from '../js/games/cup-pong/physics.js';
import {shapeThrow, ASSIST_DEFAULTS} from '../js/games/cup-pong/aim-assist.js';
import {calibrate, MIN_SAMPLES} from '../js/games/cup-pong/calibrate.js';

const A = {...ASSIST_DEFAULTS, xMargin: 0.06, zOvershoot: 0.25, captureRadius: 0.45, magnetRadius: 0.1, magnet: 0.35, formationPull: 0.6, lateralPull: 0.5, magnetMax: 0.8};

test('cup layouts: 3, 6 and 10 cups in a pyramid with the apex nearest the thrower', () => {
  for (const n of [3, 6, 10]) assert.equal(layoutCups(n, P).length, n);
  const cups = layoutCups(10, P);
  assert.equal(cups[0].z, P.zFront);
  assert.ok(cups.slice(1).every((c) => c.z > cups[0].z));
  assert.throws(() => layoutCups(7, P));
});

test('a simulated throw is deterministic', () => {
  const cups = layoutCups(10, P);
  for (const [a, p] of [[0, 190], [7, 60], [-20, 255], [0, 0], [33, 140]]) {
    assert.equal(JSON.stringify(simulate(a, p, cups, P)), JSON.stringify(simulate(a, p, cups, P)));
  }
});

test('a straight full-power throw can score directly and a mid-power one after one bounce', () => {
  const cups = layoutCups(10, P);
  const direct = simulate(0, 190, cups, P);
  assert.equal(direct.outcome, 'in');
  assert.equal(direct.bounces, 0);
  const bounced = simulate(0, 90, cups, P);
  assert.equal(bounced.outcome, 'in');
  assert.equal(bounced.bounces, 1);
});

test('the ball may bounce once on the table; a second contact ends it', () => {
  const cups = layoutCups(10, P);
  for (let p = 0; p <= 255; p += 5) {
    for (const a of [-20, 0, 20]) {
      const r = simulate(a, p, cups, P);
      assert.ok(r.bounces <= P.maxBounces + 1, `power ${p} angle ${a}: ${r.bounces} contacts`);
    }
  }
});

test('a removed cup cannot be hit again', () => {
  const cups = layoutCups(10, P);
  assert.equal(simulate(0, 190, cups, P).cup, 0);
  cups[0].alive = false;
  assert.notEqual(simulate(0, 190, cups, P).cup, 0);
});

test('aim assist keeps a throw that already scores exactly as thrown', () => {
  const cups = layoutCups(10, P);
  let checked = 0;
  for (let a = -20; a <= 20; a += 4) {
    for (let p = 60; p <= 255; p += 5) {
      if (simulate(a, p, cups, P).outcome !== 'in') continue;
      const r = shapeThrow({angleQ: a, powerQ: p}, cups, P, A);
      assert.deepEqual([r.angleQ, r.powerQ], [a, p]);
      checked++;
    }
  }
  assert.ok(checked > 20);
});

test('aim assist never returns an input outside the valid ranges', () => {
  const cups = layoutCups(10, P);
  for (let a = -127; a <= 127; a += 23) {
    for (let p = 0; p <= 255; p += 17) {
      const r = shapeThrow({angleQ: a, powerQ: p}, cups, P, A);
      assert.ok(Number.isInteger(r.angleQ) && r.angleQ >= -127 && r.angleQ <= 127);
      assert.ok(Number.isInteger(r.powerQ) && r.powerQ >= 0 && r.powerQ <= 255);
    }
  }
});

test('aim assist raises the hit rate, and a longer reach raises it more', () => {
  const cups = layoutCups(10, P);
  const rate = (assist) => {
    let hits = 0, n = 0;
    for (let a = -24; a <= 24; a += 2) {
      for (let p = 70; p <= 250; p += 4) {
        n++;
        const input = assist ? shapeThrow({angleQ: a, powerQ: p}, cups, P, assist) : {angleQ: a, powerQ: p};
        if (simulate(input.angleQ, input.powerQ, cups, P).outcome === 'in') hits++;
      }
    }
    return hits / n;
  };
  const none = rate(null), some = rate(A), more = rate({...A, snap: 2});
  assert.ok(some > none, `${some} > ${none}`);
  assert.ok(more > some, `${more} > ${some}`);
});

test('aim assist with the snap off cannot send a ball off the table sideways', () => {
  const cups = layoutCups(10, P);
  for (const a of [-127, -80, 80, 127]) {
    const r = shapeThrow({angleQ: a, powerQ: 200}, cups, P, {...A, snap: 0});
    const at = predictAtHeight(r.angleQ, r.powerQ, P.cupH, P);
    assert.ok(Math.abs(at.x) <= P.tableHalfW, `x ${at.x}`);
  }
});

test('calibration needs enough throws and learns a sideways lean', () => {
  const I = {minSpeed: 1.2, maxSpeed: 5, curve: 1, angleRangeDeg: 45, angleOffsetDeg: 0};
  assert.equal(calibrate([], P, I, A), null);
  assert.ok(MIN_SAMPLES >= 3);
  const cups = layoutCups(10, P);
  const lean = 4, range = 38;
  const samples = cups.concat(cups).map((c) => ({
    speed: 3 + (c.z - P.zFront) * 4,
    angDeg: Math.round(c.x / c.z / P.aimSlope * 127) / 127 * range + lean,
    target: {x: c.x, z: c.z},
  }));
  const r = calibrate(samples, P, I, A);
  assert.ok(Math.abs(r.input.angleOffsetDeg - lean) < 0.6, `lean ${r.input.angleOffsetDeg}`);
  assert.ok(Math.abs(r.input.angleRangeDeg - range) <= 2, `range ${r.input.angleRangeDeg}`);
  assert.ok(r.report.rmsAfter < r.report.rmsBefore);
});
