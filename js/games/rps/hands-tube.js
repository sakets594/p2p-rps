// 2D "tube" hands. Each finger is a 3-bone chain with real joint angles, drawn
// as thick round-capped strokes (round caps/joins = smooth joints by
// construction). Curling bends the bones toward the camera, so the projected
// finger shortens and folds over the palm like a real fist seen from the front.
// Same stage API as hands.js / hands3d.js.

import {burstAt, ringAt, screenFlash, shake, vibrate} from '../../fx.js';
import {callout} from './rules.js';

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
    this.dx = this.dy = this.rot = 0; // showdown offsets: toward the middle, down, lean
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
const ease = {
  out: (k) => 1 - (1 - k) ** 3,
  in: (k) => k ** 3,
  back: (k) => { const c = 1.9; return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2; },
};
const tween = (ms, fn) => new Promise((res) => {
  const t0 = performance.now();
  const f = () => { const k = Math.min(1, (performance.now() - t0) / ms); fn(k); if (k < 1) requestAnimationFrame(f); else res(); };
  f();
});
const COUNT = ['ROCK', 'PAPER', 'SCISSORS'];
const CALL_COLOR = {win: '#ffd84a', lose: '#ff6b6b', draw: '#9fd0ff'};
const PUMP_S = 0.45;
const MIN_PUMPS = 3;

export class HandStageTube {
  constructor(container) {
    this.slow = 1;
    this.box = container;
    container.style.position = 'relative';
    this.call = document.createElement('div'); // the big words over the hands: ROCK, PAPER, SCISSORS, SHOOT!
    this.call.className = 'rps-call';
    this.call.setAttribute('aria-hidden', 'true');
    container.append(this.call);
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
    const y = 40 + 60 * (1 - h.appear) - lift + h.dy;
    const tilt = 9 + h.rot;
    const pivot = '100 250';
    h.g.style.opacity = Math.min(1, h.appear * 1.6) * (h.dim ?? 1);
    h.g.setAttribute('transform', side === 'me'
      ? `translate(${90 + h.dx} ${y}) rotate(${tilt} ${pivot}) translate(100 250) scale(${s}) translate(-100 -250)`
      : `translate(${430 - h.dx} ${y}) scale(-1 1) rotate(${tilt} ${pivot}) translate(100 250) scale(${s}) translate(-100 -250)`);
  }

  #tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000) / this.slow;
    this.last = now;
    if (this.pumping) this.pumpT += dt;
    const beat = Math.floor(this.pumpT / PUMP_S);
    if (this.pumping && beat !== this.lastBeat) { // the fists hit the bottom of a pump: say the next word
      this.lastBeat = beat;
      this.#callout(COUNT[beat % COUNT.length], '#ffffff', 0.9);
      if (!REDUCED) shake(this.box, 0.18);
    }
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

  /** Slam a word onto the stage. `size` scales the pop. */
  #callout(text, color, size = 1) {
    this.call.textContent = text;
    this.call.style.color = color;
    this.call.style.fontSize = text.length > 12 ? 'min(5.2vw, 23px)' : 'min(8vw, 38px)'; // long lines must still fit the column
    if (REDUCED || !this.call.animate) return;
    this.call.animate([
      {transform: `translateX(-50%) scale(${1 + 1.4 * size})`, opacity: 0, easing: 'cubic-bezier(.2,1.4,.4,1)'},
      {transform: 'translateX(-50%) scale(1)', opacity: 1, offset: 0.3},
      {transform: 'translateX(-50%) scale(1)', opacity: 1},
    ], {duration: 320});
  }

  setSlow(f) { this.slow = f; }
  #ms(n) { return n * this.slow; }

  reset() {
    this.epoch = (this.epoch ?? 0) + 1; // cancels any sequence still in flight
    this.pumping = false;
    this.pending = null;
    this.pumpT = 0;
    this.lastBeat = -1;
    this.call.textContent = '';
    for (const h of Object.values(this.hands)) {
      h.dx = h.dy = h.rot = 0;
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
    this.lastBeat = -1;
    this.pumping = true;
  }

  async reveal({mine, theirs, outcome}) {
    if (!this.pumping && !this.pending) this.startShake();
    const epoch = this.epoch;
    const periods = REDUCED ? 1 : Math.max(MIN_PUMPS, Math.ceil(this.pumpT / PUMP_S));
    await new Promise((resolve) => { this.pending = {until: periods * PUMP_S, resolve}; });
    if (epoch !== this.epoch) return;
    await this.#showdown({mine, theirs, outcome}, epoch);
  }

  // SHOOT!: both hands wind back, slam together, freeze for a beat on impact, recoil, then the winner
  // swells and shines while the loser is knocked back.
  async #showdown({mine, theirs, outcome}, epoch) {
    const {me, them} = this.hands;
    const hands = [me, them];
    const live = () => epoch === this.epoch;
    this.#callout('SHOOT!', '#ffd84a', 1.3);
    this.#say('shoot');
    if (REDUCED) {
      me.setPose(mine); them.setPose(theirs);
      await sleep(350);
    } else {
      await tween(this.#ms(190), (k) => { const e = ease.out(k); for (const h of hands) { h.dx = -30 * e; h.dy = -14 * e; h.rot = -9 * e; } });
      if (!live()) return;
      me.setPose(mine); them.setPose(theirs); // the fists open as they come in
      await tween(this.#ms(110), (k) => { const e = ease.in(k); for (const h of hands) { h.dx = -30 + 52 * e; h.dy = -14 + 22 * e; h.rot = -9 + 9 * e; } });
      if (!live()) return;
      this.#impact(outcome, mine, theirs);
      await sleep(this.#ms(110)); // hit-stop: everything holds for a beat
      if (!live()) return;
      const knock = outcome === 'draw' ? 0 : 1;
      await tween(this.#ms(420), (k) => {
        const e = ease.back(k);
        for (const h of hands) { h.dx = 22 * (1 - e); h.dy = 8 * (1 - e); }
        const loser = outcome === 'win' ? them : outcome === 'lose' ? me : null;
        if (loser) { loser.dx = 22 * (1 - e) - 16 * knock * ease.out(k); loser.rot = -22 * ease.out(k); loser.dy = 8 * (1 - e) + 26 * ease.out(k); }
      });
      if (!live()) return;
    }
    this.setResult(me, outcome);
    this.setResult(them, {win: 'lose', lose: 'win', draw: 'draw'}[outcome]);
    this.#aftermath(outcome);
    await sleep(this.#ms(450));
  }

  /** Tell the screen around the hands what just happened (it listens for `rps:shoot` and `rps:clash`). */
  #say(name, detail) { this.box.dispatchEvent(new CustomEvent(`rps:${name}`, {detail, bubbles: true})); }

  #impact(outcome, mine, theirs) {
    this.#callout(callout(mine, theirs), CALL_COLOR[outcome], 1);
    this.#say('clash', outcome);
    screenFlash('#ffffff', 0.6, 240);
    ringAt(this.svg, '#ffffff', {count: 3, size: 0.22});
    burstAt(this.svg, 'bigBoom');
    shake(this.box, 1.2);
    vibrate('hit');
  }

  #aftermath(outcome) {
    const {me, them} = this.hands;
    if (outcome === 'draw') {
      ringAt(this.svg, '#9fd0ff', {count: 2, size: 0.4});
      return;
    }
    const [winner, loser] = outcome === 'win' ? [me, them] : [them, me];
    burstAt(winner.g, 'sparkle');
    burstAt(winner.g, 'sparkle');
    ringAt(winner.g, '#ffd84a', {count: 2, size: 0.5});
    burstAt(loser.g, 'smoke');
    if (outcome === 'win') { vibrate('good'); } else { vibrate('bad'); screenFlash('#ff2d2d', 0.3, 500); }
  }
}
