// Forgiveness helpers: reshape a raw flick into the {angleQ, powerQ} that is actually
// thrown (and sent over the network). Runs only on the thrower's device, before
// quantization is sent, so it never has to be deterministic across browsers: the
// receiver just replays the final integers. Pure: no DOM.
//
//   0. scoring snap   a throw that already scores is kept; a near-miss snaps to the nearest
//                      input that would score (direct, or after one table bounce)
//   1. dead zone      tiny finger wobble around straight-up is treated as straight
//   2. lateral shaping gain < 1 and an ease curve: fine control near the centre,
//                      sideways aim is not as twitchy
//   3. stay on table  the landing point is kept inside the table width
//   4. no overshoot   power is capped so the first touch is at most zOvershoot past the cups
//   5. formation pull the landing point is steered toward the nearest remaining cups, so a
//                      wild flick still comes down on the formation (it is the last step, so
//                      it wins over the safety limits above)
//   6. rubber band    the pull gets stronger as cups disappear, so the last few cups can
//                      still be cleared

import {predictAtHeight, simulate} from './physics.js';

export const ASSIST_DEFAULTS = {
  snap: 1, // 0 = off; scales the reach of the scoring snap
  snapPower: 4, // powerQ units searched either way (255 = the full swipe range)
  snapAngle: 2, // angleQ units searched either way (127 = a 90 degree flick)
  deadZoneQ: 4, // |angleQ| below this becomes 0 (127 = a flick 90 deg off vertical)
  lateralGain: 0.9, // 1 = raw, lower = less sideways reaction
  lateralCurve: 1.15, // > 1: small angles shrink more than large ones
  xMargin: 0.12, // keep the landing this far inside the table edge
  zOvershoot: 0.3, // first touch may be at most this far past the back row of cups
  lateralPull: 0.45, // 0..1: how much of the formation pull applies sideways (z always gets all of it)
  formationPull: 0.7, // 0..1: share of the distance outside the cluster that is pulled away
  captureRadius: 1.0, // m: only flicks landing within this of a cup are steered
  magnet: 0.4, // 0..1: pull of a landing inside magnetRadius toward the closest cup
  magnetRadius: 0.22, // m
  magnetMax: 0.85, // magnet strength when only one cup is left (rubber band)
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const sign = (v) => (v < 0 ? -1 : 1);

/** Smallest powerQ whose rim crossing lands at or beyond z (landing z grows with power). */
function powerForZ(zTarget, angleQ, p) {
  let lo = 0, hi = 255;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (predictAtHeight(angleQ, mid, p.cupH, p).z >= zTarget) hi = mid; else lo = mid + 1;
  }
  return lo;
}

/** Nearest input (in a scaled ellipse around the raw one) whose simulated throw scores, or null. */
function nearestScoring(raw, cups, p, a, left) {
  const rp = a.snapPower * a.snap * (1 + left), ra = a.snapAngle * a.snap * (1 + left);
  const offs = [];
  for (let dp = -Math.ceil(rp); dp <= rp; dp += 2) {
    for (let da = -Math.ceil(ra); da <= ra; da += 2) {
      const d = (dp / rp) ** 2 + (da / ra) ** 2;
      if (d <= 1) offs.push([d, dp, da]);
    }
  }
  offs.sort((x, y) => x[0] - y[0]); // nearest first, stop at the first that scores
  for (const [, dp, da] of offs) {
    const powerQ = clamp(raw.powerQ + dp, 0, 255), angleQ = clamp(raw.angleQ + da, -127, 127);
    if (simulate(angleQ, powerQ, cups, p).outcome === 'in') return {angleQ, powerQ, dp, da};
  }
  return null;
}

/**
 * @param raw   {angleQ, powerQ} straight from the flick
 * @param cups  [{x, z, alive}]
 * @param p     physics params
 * @param a     ASSIST_DEFAULTS-shaped options
 * @returns {angleQ, powerQ, steps: {...}} where steps records what changed, for debugging
 */
export function shapeThrow(raw, cups, p, a = ASSIST_DEFAULTS) {
  const steps = {};
  // A throw that already scores (direct or after one bounce) is left exactly as it was thrown.
  if (simulate(raw.angleQ, raw.powerQ, cups, p).outcome === 'in') return {angleQ: raw.angleQ, powerQ: raw.powerQ, steps: {kept: true}};
  if (a.snap > 0) {
    const alive = cups.filter((c) => c.alive).length;
    const near = nearestScoring(raw, cups, p, a, 1 - alive / (cups.length || 1));
    if (near) return {angleQ: near.angleQ, powerQ: near.powerQ, steps: {snapped: [near.dp, near.da]}};
  }
  let angleQ = raw.angleQ, powerQ = raw.powerQ;

  // 1 + 2: dead zone, then gain and curve on the magnitude
  if (Math.abs(angleQ) <= a.deadZoneQ) {
    angleQ = 0;
  } else {
    const m = (Math.abs(angleQ) - a.deadZoneQ) / (127 - a.deadZoneQ); // 0..1 past the dead zone
    angleQ = sign(angleQ) * Math.round(127 * a.lateralGain * Math.pow(m, a.lateralCurve));
  }
  steps.shaped = angleQ;

  // 4: no overshoot: cap power so the rim crossing is at most zOvershoot past the back row
  let backZ = 0;
  for (const c of cups) if (c.alive && c.z > backZ) backZ = c.z;
  if (backZ === 0) backZ = p.zFront;
  const zMax = backZ + a.zOvershoot;
  const zNow = predictAtHeight(angleQ, powerQ, p.cupH, p).z;
  if (zNow > zMax) { powerQ = Math.min(powerQ, powerForZ(zMax, angleQ, p)); steps.powerCapped = true; }

  // 3: stay on the table: limit the sideways slope so |x| <= tableHalfW - xMargin
  const landing = predictAtHeight(angleQ, powerQ, p.cupH, p);
  const xLimit = p.tableHalfW - a.xMargin;
  if (Math.abs(landing.x) > xLimit && landing.z > 0) {
    const uMax = xLimit / landing.z; // vx/vz == u, so x = u * z
    const qMax = Math.floor((uMax / p.aimSlope) * 127);
    angleQ = sign(angleQ) * Math.min(Math.abs(angleQ), qMax);
    steps.sideClamped = true;
  }

  // 5 + 6: steer the landing toward the formation. Runs last, so it wins over the caps.
  {
    const alive = cups.filter((c) => c.alive);
    const total = cups.length || 1;
    const at = predictAtHeight(angleQ, powerQ, p.cupH, p);
    let best = null, bestD = Infinity;
    for (const c of alive) {
      const d = Math.hypot(c.x - at.x, c.z - at.z);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best && bestD < a.captureRadius && (a.formationPull > 0 || a.magnet > 0)) {
      const left = 1 - alive.length / total; // 0 full rack .. ~1 last cup
      const radius = a.magnetRadius * (1 + left);
      const strength = a.magnet + (a.magnetMax - a.magnet) * left;
      // distance from the chosen cup that the landing should end up at
      let d = bestD;
      if (d > radius) d = radius + (d - radius) * (1 - a.formationPull); // pull in from outside
      if (d <= radius) d = d * (1 - strength);                           // then toward the cup
      else d = d - 0;                                                    // (outside radius after pull: keep)
      const k = bestD > 0 ? d / bestD : 0;
      const tz = Math.max(0.3, best.z + (at.z - best.z) * k);
      // keep most of the player's sideways intent: x only gets lateralPull of the pull
      const fullX = best.x + (at.x - best.x) * k;
      const tx = at.x + (fullX - at.x) * a.lateralPull;
      angleQ = clamp(Math.round((tx / tz / p.aimSlope) * 127), -127, 127);
      powerQ = powerForZ(tz, angleQ, p);
      steps.steeredTo = alive.indexOf(best);
      steps.pullM = +(bestD - d).toFixed(3);
    }
  }

  return {angleQ: clamp(angleQ, -127, 127), powerQ: clamp(powerQ, 0, 255), steps};
}
