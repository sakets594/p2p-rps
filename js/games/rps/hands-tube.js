// 2D "tube" hands. Each finger is a 3-bone chain with real joint angles, drawn
// as thick round-capped strokes (round caps/joins = smooth joints by
// construction). Curling bends the bones toward the camera, so the projected
// finger shortens and folds over the palm like a real fist seen from the front.
// Same stage API as hands.js / hands3d.js.

const NS = 'http://www.w3.org/2000/svg';
const BASE_Y = 140;
const OUTLINE = 6; // extra stroke width for the outline layer
const CURL = [1.5, 1.9, 1.2]; // per-joint bend at curl = 1 (radians)

const FINGERS = [
  {x: 62,  L: [40, 26, 20], w: 19},
  {x: 87,  L: [44, 28, 22], w: 19},
  {x: 112, L: [40, 26, 20], w: 19},
  {x: 137, L: [32, 20, 17], w: 18},
];
const THUMB = {x: 56, y: 178, L: [34, 30], w: 22};

// curl per finger, in-plane spread per finger (radians, + = clockwise), thumb fold 0..1
const POSES = {
  open:     {curl: [0, 0, 0, 0], spread: [-0.1, -0.03, 0.04, 0.12], thumb: 0},
  paper:    {curl: [0, 0, 0, 0], spread: [-0.1, -0.03, 0.04, 0.12], thumb: 0},
  rock:     {curl: [1, 1, 1, 1], spread: [0, 0, 0, 0],              thumb: 1},
  scissors: {curl: [0, 0, 1, 1], spread: [-0.2, 0.2, 0, 0],         thumb: 1},
};

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mk = (tag, attrs, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
};
const pathD = (pts) => 'M' + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L');

class TubeHand {
  constructor(side, defs) {
    this.side = side;
    this.g = mk('g', {class: `tube-hand ${side}`});

    // Layer order: outlines -> skins -> fold details -> front thumb -> cuff.
    const L = (cls) => mk('g', {class: cls}, this.g);
    const outlines = L('outlines'), skins = L('skins'), folds = L('folds'), front = L('front');

    this.palmO = mk('rect', {x: 50, y: 126, width: 100, height: 108, rx: 32, class: 'o', 'stroke-width': OUTLINE}, outlines);
    this.thumbBackO = mk('path', {class: 'line o', 'stroke-width': THUMB.w + OUTLINE}, outlines);
    this.fingO = FINGERS.map((f) => mk('path', {class: 'line o', 'stroke-width': f.w + OUTLINE}, outlines));

    this.palmS = mk('rect', {x: 50, y: 126, width: 100, height: 108, rx: 32, class: 's'}, skins);
    this.thumbBackS = mk('path', {class: 'line s', 'stroke-width': THUMB.w}, skins);
    this.fingS = FINGERS.map((f) => mk('path', {class: 'line s', 'stroke-width': f.w}, skins));

    // the middle and tip bones re-drawn on top so a curled fingertip reads as folded over
    this.fold = FINGERS.map((f) => [1, 2].map(() => ({
      o: mk('path', {class: 'line o', 'stroke-width': f.w + OUTLINE * 0.7}, folds),
      s: mk('path', {class: 'line s', 'stroke-width': f.w}, folds),
    })));

    this.thumbFrontO = mk('path', {class: 'line o', 'stroke-width': THUMB.w + OUTLINE}, front);
    this.thumbFrontS = mk('path', {class: 'line s', 'stroke-width': THUMB.w}, front);

    this.cuff = mk('rect', {x: 46, y: 218, width: 108, height: 64, rx: 16, class: 'cuff'}, this.g);

    this.cur = structuredClone(POSES.open);
    this.target = structuredClone(POSES.open);
    this.appear = 0;
    this.appearTarget = 0;
    this.resultScale = 1;
    this.draw();
  }

  setPose(name) { this.target = structuredClone(POSES[name]); }

  step(dt) {
    const k = 1 - Math.exp(-dt * 13);
    const lerp = (a, b) => { const v = a + (b - a) * k; return Math.abs(b - v) > 1e-4 ? v : b; };
    this.cur.curl = this.cur.curl.map((v, i) => lerp(v, this.target.curl[i]));
    this.cur.spread = this.cur.spread.map((v, i) => lerp(v, this.target.spread[i]));
    this.cur.thumb = lerp(this.cur.thumb, this.target.thumb);
    this.appear += (this.appearTarget - this.appear) * (1 - Math.exp(-dt * 10));
    this.draw();
  }

  #fingerPoints(i) {
    const f = FINGERS[i];
    const c = this.cur.curl[i];
    const rot = this.cur.spread[i];
    let phi = 0, y = BASE_Y;
    const pts = [[f.x, y]];
    for (let k = 0; k < 3; k++) {
      phi += CURL[k] * c;
      y -= f.L[k] * Math.cos(phi);
      pts.push([f.x, y]);
    }
    // spread: rotate the whole chain about its base
    const cs = Math.cos(rot), sn = Math.sin(rot);
    return pts.map(([px, py]) => {
      const dx = px - f.x, dy = py - BASE_Y;
      return [f.x + dx * cs - dy * sn, BASE_Y + dx * sn + dy * cs];
    });
  }

  #thumbPoints() {
    const t = this.cur.thumb;
    const a1 = (-52 + (55 + 52) * t) * Math.PI / 180;
    const a2 = a1 + ((-10) + (40 + 10) * t) * Math.PI / 180;
    const p0 = [THUMB.x, THUMB.y];
    const p1 = [p0[0] + THUMB.L[0] * Math.sin(a1), p0[1] - THUMB.L[0] * Math.cos(a1)];
    const p2 = [p1[0] + THUMB.L[1] * Math.sin(a2), p1[1] - THUMB.L[1] * Math.cos(a2)];
    return [p0, p1, p2];
  }

  draw() {
    FINGERS.forEach((f, i) => {
      const pts = this.#fingerPoints(i);
      const d = pathD(pts);
      this.fingO[i].setAttribute('d', d);
      this.fingS[i].setAttribute('d', d);
      const op = smooth(0.35, 0.8, this.cur.curl[i]);
      [[1, 2], [2, 3]].forEach(([a, b], k) => {
        const dd = pathD([pts[a], pts[b]]);
        const fo = this.fold[i][k];
        fo.o.setAttribute('d', dd); fo.s.setAttribute('d', dd);
        fo.o.style.opacity = fo.s.style.opacity = op;
      });
    });

    const td = pathD(this.#thumbPoints());
    const front = this.cur.thumb > 0.35;
    for (const e of [this.thumbBackO, this.thumbBackS]) { e.setAttribute('d', td); e.style.opacity = front ? 0 : 1; }
    for (const e of [this.thumbFrontO, this.thumbFrontS]) { e.setAttribute('d', td); e.style.opacity = front ? 1 : 0; }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const PUMP_S = 0.45;
const MIN_PUMPS = 3;

export class HandStageTube {
  constructor(container) {
    this.slow = 1;
    this.svg = mk('svg', {viewBox: '70 10 380 330', class: 'tube-stage', role: 'img', 'aria-label': 'Rock paper scissors hands'}, container);
    this.hands = {me: new TubeHand('me'), them: new TubeHand('them')};
    this.svg.append(this.hands.me.g, this.hands.them.g);
    this.pumpT = 0;
    this.pumping = false;
    this.pending = null;
    this.last = performance.now();
    this.reset();
    const loop = () => { this.#tick(); this.raf = requestAnimationFrame(loop); };
    loop();
  }

  #place(h, side, lift) {
    const s = Math.max(0.001, h.appear) * h.resultScale;
    const y = 40 + 60 * (1 - h.appear) - lift;
    const tilt = 9 * (1 - 0 * h.appear);
    const pivot = '100 250';
    h.g.style.opacity = Math.min(1, h.appear * 1.6) * (h.dim ?? 1);
    h.g.setAttribute('transform', side === 'me'
      ? `translate(90 ${y}) rotate(${tilt} ${pivot}) translate(100 250) scale(${s}) translate(-100 -250)`
      : `translate(430 ${y}) scale(-1 1) rotate(${tilt} ${pivot}) translate(100 250) scale(${s}) translate(-100 -250)`);
  }

  #tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000) / this.slow;
    this.last = now;
    if (this.pumping) this.pumpT += dt;
    if (this.pending && this.pumpT >= this.pending.until) {
      this.pumping = false;
      const {resolve} = this.pending;
      this.pending = null;
      resolve();
    }
    const phase = (this.pumpT % PUMP_S) / PUMP_S;
    const lift = this.pumping && !REDUCED ? 28 * (1 - Math.cos(phase * Math.PI * 2)) / 2 : 0;
    for (const [side, h] of Object.entries(this.hands)) {
      h.step(dt);
      this.#place(h, side, lift);
    }
  }

  setSlow(f) { this.slow = f; }
  #ms(n) { return n * this.slow; }

  reset() {
    this.epoch = (this.epoch ?? 0) + 1; // cancels any sequence still in flight
    this.pumping = false;
    this.pending = null;
    this.pumpT = 0;
    for (const h of Object.values(this.hands)) {
      h.appearTarget = 0; h.appear = 0;
      h.cur = structuredClone(POSES.open); h.setPose('open');
      this.setResult(h, null);
    }
  }

  setResult(h, result) {
    h.resultScale = result === 'win' ? 1.1 : result === 'lose' ? 0.92 : 1;
    h.dim = result === 'lose' ? 0.55 : 1;
    h.g.classList.toggle('win', result === 'win');
    h.g.classList.toggle('lose', result === 'lose');
  }

  async lockIn(side) {
    const h = this.hands[side];
    const epoch = this.epoch;
    h.setPose('open');
    h.appearTarget = 1;
    await sleep(this.#ms(450));
    if (epoch !== this.epoch) return;
    h.setPose('rock');
    await sleep(this.#ms(400));
  }

  startShake() {
    if (this.pumping) return;
    this.pumpT = 0;
    this.pumping = true;
  }

  async reveal({mine, theirs, outcome}) {
    if (!this.pumping && !this.pending) this.startShake();
    const epoch = this.epoch;
    const periods = REDUCED ? 1 : Math.max(MIN_PUMPS, Math.ceil(this.pumpT / PUMP_S));
    await new Promise((resolve) => { this.pending = {until: periods * PUMP_S, resolve}; });
    if (epoch !== this.epoch) return;
    this.hands.me.setPose(mine);
    this.hands.them.setPose(theirs);
    await sleep(this.#ms(350));
    if (epoch !== this.epoch) return;
    this.setResult(this.hands.me, outcome);
    this.setResult(this.hands.them, {win: 'lose', lose: 'win', draw: 'draw'}[outcome]);
  }
}
