// Cup Pong throw physics. Pure: no DOM, no Three.js, no Date/Math.random.
//
// DRAFT (seed of the real module, being tuned by preview/cup-pong-proto.html).
// Determinism rule: simulate() uses only + - * / and sqrt, which are IEEE-exact on
// every engine. No sin/cos/tan in here: the launch direction comes from sinP/cosP
// constants (freeze them as literals) and a slope, not an angle.
//
// World (meters): x lateral (0 = table centre), y up (table top = 0), z along the
// table, thrower at z = 0 throwing toward +z. Both players use the same coordinates;
// each client only flips its camera.

export const DEFAULTS = {
  g: 6.0, // lower than 9.81 so the arc is readable on a phone
  sinP: 0.766, // launch pitch ~50 deg, as literals
  cosP: 0.6428,
  releaseH: 0.3,
  minRange: 0.7, // landing distance at power 0
  maxRange: 2.0, // landing distance at power 255
  aimSlope: 0.35, // lateral/forward slope at a full-left or full-right flick
  ballR: 0.02,
  cupRimR: 0.055,
  cupH: 0.12,
  cupSpacing: 0.12, // centre to centre in a row
  zFront: 1.2, // z of the front (apex) cup
  rimRestitution: 0.5,
  sideRestitution: 0.4,
  // Table: the ball bounces on it (bounce shots), and falls off its edges.
  tableHalfW: 0.5,
  tableZ0: -0.45,
  tableZ1: 2.4,
  tableRestitution: 0.5, // vertical speed kept per bounce
  tableFriction: 0.8, // horizontal speed kept per bounce
  maxBounces: 3,
  minBounceVy: 0.35, // below this the ball is considered settled
  dt: 1 / 240,
  maxTicks: 2400,
};

// "Reference feel": proportions and numbers measured from a popular cup-pong game, scaled so
// the ball radius is 0.02 m (1 reference unit = 0.08 m). Gravity -48 u/s2 -> 3.84 m/s2.
// Throw: impulse 4.1..6.5 on a 0.22 mass ball -> 18.6..29.5 u/s -> 1.49..2.36 m/s, launch
// pitch 78 deg (short swipe) .. 65 deg (full swipe), sideways flick range +-50 deg -> ~+-32 deg.
export const REFERENCE = {
  ...DEFAULTS,
  g: 3.84,
  vMin: 1.49, vMax: 2.36,
  sinP0: 0.9781, cosP0: 0.2079, // 78 deg
  sinP1: 0.9063, cosP1: 0.4226, // 65 deg
  releaseH: 0.076,
  aimSlope: 0.62, // tan(32 deg)
  ballR: 0.02,
  cupRimR: 0.054,
  cupH: 0.14,
  cupSpacing: 0.105,
  zFront: 0.8,
  tableHalfW: 0.36,
  tableZ0: -0.36,
  tableZ1: 1.32,
  tableRestitution: 0.85, // ball 0.95 x table 0.9
  tableFriction: 0.9,
  rimRestitution: 0.4,
  sideRestitution: 0.4,
  maxBounces: 1, // one table bounce is allowed (bounce shot); a second contact ends the ball
  minBounceVy: 0.2,
};

const PRESETS = {3: 2, 6: 3, 10: 4}; // cups -> rows of the pyramid (apex nearest the thrower)

export function layoutCups(count, p = DEFAULTS) {
  const rows = PRESETS[count];
  if (!rows) throw new Error(`unsupported cup count ${count}`);
  const rowStep = p.cupSpacing * 0.866;
  const cups = [];
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i <= r; i++) {
      cups.push({x: (i - r / 2) * p.cupSpacing, z: p.zFront + r * rowStep, alive: true});
    }
  }
  return cups;
}

/**
 * angleQ -127..127 (full left..full right), powerQ 0..255 -> initial velocity.
 * Two launch models, picked by the params:
 *  - range model (default): power sets the landing distance at a fixed pitch;
 *  - reference model (p.vMax set): power sets both speed (vMin..vMax) and pitch
 *    (a steep lob for a short swipe, flatter for a long one).
 * Arithmetic only (+ - * / sqrt) so it stays identical across engines.
 */
export function launch(angleQ, powerQ, p = DEFAULTS) {
  const t = powerQ / 255;
  let v, sinP, cosP;
  if (p.vMax) {
    v = p.vMin + (p.vMax - p.vMin) * t;
    const sx = p.sinP0 + (p.sinP1 - p.sinP0) * t, cx = p.cosP0 + (p.cosP1 - p.cosP0) * t;
    const n = Math.sqrt(sx * sx + cx * cx); // blend the two unit directions, then renormalise
    sinP = sx / n; cosP = cx / n;
  } else {
    const range = p.minRange + (p.maxRange - p.minRange) * t;
    v = Math.sqrt((range * p.g) / (2 * p.sinP * p.cosP));
    sinP = p.sinP; cosP = p.cosP;
  }
  const u = (angleQ / 127) * p.aimSlope;
  const norm = Math.sqrt(1 + u * u);
  const vh = v * cosP;
  return {vx: (vh * u) / norm, vy: v * sinP, vz: vh / norm};
}

/**
 * Where the flight will be when it descends through height h (ignores cups and bounces).
 * Pure arithmetic, used by the aim-assist helpers. Returns {x, z, t}.
 */
export function predictAtHeight(angleQ, powerQ, h, p = DEFAULTS) {
  const v = launch(angleQ, powerQ, p);
  const t = (v.vy + Math.sqrt(v.vy * v.vy + 2 * p.g * (p.releaseH - h))) / p.g;
  return {x: v.vx * t, z: v.vz * t, t};
}

/**
 * Simulate one ball. `cups` is not mutated; the result says what to do.
 * Returns {frames: [x,y,z,...] every 4th tick, outcome: 'in'|'miss', cup: index|-1, rimHits, bounces, ticks}
 */
export function simulate(angleQ, powerQ, cups, p = DEFAULTS) {
  const v = launch(angleQ, powerQ, p);
  let {vx, vy, vz} = v;
  let x = 0, y = p.releaseH, z = 0;
  const frames = [x, y, z];
  const dt = p.dt;
  let rimHits = 0;
  let bounces = 0;
  let outcome = 'miss';
  let cup = -1;
  const inR = p.cupRimR - p.ballR;
  const rimR = p.cupRimR + p.ballR;
  let ticks = 0;

  for (; ticks < p.maxTicks; ticks++) {
    const py = y;
    vy -= p.g * dt;
    const px = x, pz = z;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;

    // Crossing the rim plane while descending: in, rim hit, or nothing.
    if (vy < 0 && py >= p.cupH && y < p.cupH) {
      const f = (py - p.cupH) / (py - y);
      const cx = px + (x - px) * f;
      const cz = pz + (z - pz) * f;
      let hit = -1, hitD2 = 1e9, rim = -1, rimD2 = 1e9;
      for (let i = 0; i < cups.length; i++) {
        if (!cups[i].alive) continue;
        const dx = cx - cups[i].x, dz = cz - cups[i].z;
        const d2 = dx * dx + dz * dz;
        if (d2 < inR * inR && d2 < hitD2) { hit = i; hitD2 = d2; }
        else if (d2 < rimR * rimR && d2 < rimD2) { rim = i; rimD2 = d2; }
      }
      if (hit >= 0) {
        outcome = 'in';
        cup = hit;
        // drop to the cup floor
        frames.push(cups[hit].x, 0.03, cups[hit].z);
        break;
      }
      if (rim >= 0 && rimHits < 3) {
        // Lip: reflect the horizontal velocity off the rim circle, pop up a little.
        const dx = cx - cups[rim].x, dz = cz - cups[rim].z;
        const d = Math.sqrt(rimD2) || 1e-6;
        const nx = dx / d, nz = dz / d;
        const vn = vx * nx + vz * nz;
        const out = vn < 0 ? -vn : vn; // always push away from the cup centre
        vx = vx - vn * nx + out * p.rimRestitution * nx;
        vz = vz - vn * nz + out * p.rimRestitution * nz;
        vy = -vy * 0.35;
        x = cx; z = cz; y = p.cupH + 0.001;
        rimHits++;
        continue;
      }
    }

    // Below the rim plane: bumping the outside of a cup.
    if (y < p.cupH && y > 0) {
      for (let i = 0; i < cups.length; i++) {
        if (!cups[i].alive) continue;
        const dx = x - cups[i].x, dz = z - cups[i].z;
        const d2 = dx * dx + dz * dz;
        if (d2 < rimR * rimR) {
          const d = Math.sqrt(d2) || 1e-6;
          const nx = dx / d, nz = dz / d;
          const vn = vx * nx + vz * nz;
          if (vn < 0) {
            vx -= (1 + p.sideRestitution) * vn * nx;
            vz -= (1 + p.sideRestitution) * vn * nz;
          }
          x = cups[i].x + nx * rimR;
          z = cups[i].z + nz * rimR;
        }
      }
    }

    if (y <= p.ballR) {
      const onTable = x > -p.tableHalfW && x < p.tableHalfW && z > p.tableZ0 && z < p.tableZ1;
      if (onTable) {
        y = p.ballR;
        if (vy < 0) {
          vy = -vy * p.tableRestitution;
          vx *= p.tableFriction;
          vz *= p.tableFriction;
          bounces++;
          if (bounces > p.maxBounces || vy < p.minBounceVy) break; // settled: miss
        }
      } else if (y < -0.4) {
        break; // fell off the table
      }
    }
    if ((ticks & 3) === 0) frames.push(x, y, z);
  }
  frames.push(x, y, z);
  return {frames, outcome, cup, rimHits, bounces, ticks};
}
