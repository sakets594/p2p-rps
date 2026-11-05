// Learn a player's flick habits from a few logged throws and tune the input mapping and
// the aim-assist strength to match. Pure: no DOM, no storage. Runs on the thrower's device
// only; the result changes how a flick becomes {angleQ, powerQ}, never what is sent.
//
// A sample is {speed (screen-heights/s), angDeg (flick direction, 0 = up, + = right, raw,
// before any offset), target: {x, z} (the cup the player was asked to hit)}.

import {predictAtHeight} from './physics.js';

export const MIN_SAMPLES = 5;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const std = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / a.length); };
const RAD = 57.29578;

/** The physical input (before any assist) that would land on `target`. */
function neededInput(target, P) {
  const angleQ = clamp(Math.round((target.x / target.z / P.aimSlope) * 127), -127, 127);
  let lo = 0, hi = 255;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (predictAtHeight(angleQ, mid, P.cupH, P).z >= target.z) hi = mid; else lo = mid + 1;
  }
  return {angleQ, powerQ: lo};
}

/** Where a sample would land under input mapping `I` with no assist. */
function landing(sample, I, P) {
  const ang = sample.angDeg - I.angleOffsetDeg;
  const angleQ = clamp(Math.round((ang / I.angleRangeDeg) * 127), -127, 127);
  const t = clamp((sample.speed - I.minSpeed) / (I.maxSpeed - I.minSpeed), 0, 1);
  const powerQ = Math.round(255 * Math.pow(t, I.curve));
  return predictAtHeight(angleQ, powerQ, P.cupH, P);
}
const rmsError = (samples, I, P) => Math.sqrt(samples.reduce((acc, s) => {
  const l = landing(s, I, P); return acc + (l.x - s.target.x) ** 2 + (l.z - s.target.z) ** 2;
}, 0) / samples.length);

/**
 * @returns null if there are too few samples, else
 *   {input: {minSpeed, maxSpeed, curve, angleRangeDeg, angleOffsetDeg},
 *    assist: {magnetRadius, magnet, formationPull}, report: {...}}
 */
export function calibrate(samples, P, I, A) {
  if (!samples || samples.length < MIN_SAMPLES) return null;
  const need = samples.map((s) => neededInput(s.target, P));

  // Power: the player's typical speed should give the typical needed power.
  const speeds = samples.map((s) => s.speed);
  const medS = median(speeds), sigS = std(speeds);
  const medP = Math.max(20, median(need.map((n) => n.powerQ)));
  let width = clamp(sigS / 0.12, 2, 10); // +-1 sigma of speed ~ +-12% of power: forgiving but not mushy
  let minSpeed = medS - (medP / 255) * width;
  if (minSpeed < 0.3) { minSpeed = 0.3; width = (medS - 0.3) / (medP / 255); }
  const maxSpeed = minSpeed + width;

  // Sideways: fit angDeg = lean + range * (neededAim / 127) over all samples, so a constant
  // lean and the degrees-per-full-aim are estimated together and do not contaminate each other.
  const xs = need.map((n) => n.angleQ / 127), ys = samples.map((s) => s.angDeg);
  const mx = xs.reduce((x, y) => x + y, 0) / xs.length, my = ys.reduce((x, y) => x + y, 0) / ys.length;
  const varX = xs.reduce((acc, x) => acc + (x - mx) ** 2, 0) / xs.length;
  let angleOffsetDeg = 0, angleRangeDeg = I.angleRangeDeg, angleRangeLearned = false;
  if (varX > 0.01) { // targets spread sideways enough to separate lean from scale
    const cov = xs.reduce((acc, x, i) => acc + (x - mx) * (ys[i] - my), 0) / xs.length;
    const slope = cov / varX;
    if (slope > 5) { angleRangeDeg = clamp(Math.round(slope), 25, 80); angleOffsetDeg = my - slope * mx; angleRangeLearned = true; }
  } else {
    angleOffsetDeg = median(ys); // one target (or all near the centre): whatever they flick is their lean; range stays
  }

  const input = {minSpeed: +minSpeed.toFixed(2), maxSpeed: +maxSpeed.toFixed(2), curve: 1, angleRangeDeg, angleOffsetDeg: +angleOffsetDeg.toFixed(1)};
  const rmsBefore = rmsError(samples, {...I}, P);
  const rmsAfter = rmsError(samples, {...I, ...input}, P);

  // Assist strength follows how far off this player lands: accurate -> light help.
  const e = rmsAfter;
  const assist = {
    magnetRadius: +clamp(1.2 * e, 0.08, 0.35).toFixed(2),
    magnet: +clamp(0.15 + 1.4 * e, 0.2, 0.7).toFixed(2),
    formationPull: +clamp(0.3 + 1.6 * e, 0.3, 0.9).toFixed(2),
  };
  return {input, assist, report: {n: samples.length, angleRangeLearned,  medianSpeed: +medS.toFixed(2), speedSigma: +sigS.toFixed(2), leanDeg: +angleOffsetDeg.toFixed(1), rmsBefore: +rmsBefore.toFixed(3), rmsAfter: +rmsAfter.toFixed(3)}};
}
