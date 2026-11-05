// Animated hand stage. Pure presentation: the game tells it what happened,
// it plays the "open -> fist -> pump x3 -> reveal" sequence.
//
//   const stage = new HandStage(containerEl);
//   await stage.lockIn('me');        // my hand appears, closes into a fist
//   await stage.lockIn('them');
//   stage.startShake();              // both fists pump
//   await stage.reveal({mine, theirs, outcome}); // finishes the pump, then opens
//   stage.reset();

const PUMP_MS = 450;
const MIN_PUMPS = 3;
const NS = 'http://www.w3.org/2000/svg';

// One shared "smooth skin" filter: blur the parts, threshold the alpha so
// joints melt into rounded fillets, then draw a single outline around the
// merged silhouette (a wider blur+threshold sits behind the fill).
let uid = 0;
function handSvg() {
  const id = `skin${uid++}`;
  return `
<svg viewBox="0 0 200 270" aria-hidden="true">
  <defs>
    <filter id="${id}" filterUnits="userSpaceOnUse" x="-60" y="-40" width="320" height="340" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="2.6" result="b1"/>
      <feColorMatrix in="b1" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -10" result="fill"/>
      <feGaussianBlur in="SourceAlpha" stdDeviation="3.4" result="b2"/>
      <feColorMatrix in="b2" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 24 -4.2" result="edge"/>
      <feFlood class="outline-flood" result="ink"/>
      <feComposite in="ink" in2="edge" operator="in" result="line"/>
      <feMerge><feMergeNode in="line"/><feMergeNode in="fill"/></feMerge>
    </filter>
  </defs>
  <g filter="url(#${id})">
    <rect class="skin thumb back" x="34" y="126" width="26" height="76" rx="13"/>
    <rect class="skin" x="48" y="125" width="104" height="104" rx="30"/>
    <rect class="skin f i" x="48"  y="48" width="20" height="92" rx="10"/>
    <rect class="skin f m" x="76"  y="36" width="20" height="104" rx="10"/>
    <rect class="skin f r" x="104" y="46" width="20" height="94" rx="10"/>
    <rect class="skin f p" x="132" y="64" width="20" height="76" rx="10"/>
  </g>
  <rect class="cuff" x="46" y="214" width="108" height="54" rx="14"/>
  <g class="creases">
    <path d="M72 102 V126"/><path d="M100 102 V126"/><path d="M128 102 V126"/>
  </g>
  <g filter="url(#${id})">
    <rect class="skin thumb front" x="34" y="126" width="26" height="76" rx="13"/>
  </g>
</svg>`;
}

function buildHand(side) {
  const wrap = document.createElement('div');
  wrap.className = `hand-wrap ${side}`;
  wrap.dataset.state = 'hidden';
  wrap.dataset.shaking = 'false';
  wrap.innerHTML = `<div class="pump"><div class="hand" data-pose="open">${handSvg()}</div></div>`;
  return wrap;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class HandStage {
  constructor(container) {
    this.root = container;
    this.root.classList.add('hand-stage');
    this.hands = {me: buildHand('me'), them: buildHand('them')};
    this.root.append(this.hands.me, this.hands.them);
    this.slow = 1;
    this.shakeStart = null;
    this.reset();
  }

  /** Slow motion factor for debugging (1 = normal). */
  setSlow(factor) {
    this.slow = factor;
    this.root.style.setProperty('--speed', factor);
  }

  #el(side) { return this.hands[side]; }
  #pose(side, pose) { this.#el(side).querySelector('.hand').dataset.pose = pose; }
  #ms(n) { return n * this.slow; }

  reset() {
    this.shakeStart = null;
    this.root.style.setProperty('--pump-ms', PUMP_MS);
    for (const side of ['me', 'them']) {
      const el = this.#el(side);
      el.dataset.state = 'hidden';
      el.dataset.shaking = 'false';
      delete el.dataset.result;
      this.#pose(side, 'open');
    }
  }

  /** Hand rises open, then closes to a fist. */
  async lockIn(side) {
    this.#el(side).dataset.state = 'shown';
    await sleep(this.#ms(450));
    this.#pose(side, 'rock');
    await sleep(this.#ms(400));
  }

  startShake() {
    if (this.shakeStart !== null) return;
    this.shakeStart = performance.now();
    for (const side of ['me', 'them']) this.#el(side).dataset.shaking = 'true';
  }

  /** Waits for the current pump to finish (min 3 pumps), then opens both hands. */
  async reveal({mine, theirs, outcome}) {
    if (this.shakeStart === null) this.startShake();
    const period = this.#ms(PUMP_MS);
    const elapsed = performance.now() - this.shakeStart;
    const pumps = Math.max(MIN_PUMPS, Math.ceil(elapsed / period));
    await sleep(pumps * period - elapsed);

    for (const side of ['me', 'them']) this.#el(side).dataset.shaking = 'false';
    this.#pose('me', mine);
    this.#pose('them', theirs);
    await sleep(this.#ms(350));
    this.#el('me').dataset.result = outcome;
    this.#el('them').dataset.result = {win: 'lose', lose: 'win', draw: 'draw'}[outcome];
  }
}
