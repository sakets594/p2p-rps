// Shared game-moment effects. One fixed full-screen canvas (created on first use, running only while
// something is alive) draws glowing particles in several shapes, shockwave rings and fireworks; small
// DOM helpers add floating "+1" text, a screen flash, a score bump and the VICTORY / DEFEAT banner.
// Everything is skipped (or reduced to a plain fade) for people who ask for reduced motion.
//
// The maths (makeBurst, stepParticles, expired, makeRing, stepRings, burstParams) is pure so it can be
// tested; the canvas and the DOM bits are the only browser parts. Open the site with ?tune to get
// sliders for every number in FX_PARAMS (Tweakpane, loaded from a CDN only in that case).

export const FX_PARAMS = {
  count: 110,       // confetti pieces per burst
  speed: 780,       // launch speed, px/s
  spread: 70,       // launch cone half-angle, degrees (0 = straight up, 180 = every direction)
  gravity: 1500,    // px/s^2
  drag: 1.6,        // air resistance per second
  life: 1700,       // ms before a piece is gone
  size: 9,          // piece size, px
  shakePx: 9,       // loss shake distance, px
  shakeMs: 420,     // loss shake length, ms
  haptics: true,    // vibrate on phones that can
};

const PALETTE = ['#4f46e5', '#e11d74', '#16a34a', '#f59e0b', '#06b6d4', '#a855f7'];
const FIRE = ['#ff3b30', '#ff9500', '#ffcc00', '#ffffff'];
const GOLD = ['#fff7c2', '#ffd84a', '#ffb703', '#ffffff'];

/**
 * Bursts for board moments: each overrides some FX_PARAMS and brings its own colors.
 * Extra keys: shapes (rect | circle | star | spark | emoji), glow (additive light), alpha, chars (emoji),
 * trail (leaves a fading tail), boom (the preset it turns into when its life ends: a firework rocket).
 */
export const PRESETS = {
  boom: {count: 34, speed: 440, spread: 180, gravity: 700, drag: 2.2, life: 800, size: 7, shapes: ['circle', 'spark'], glow: true, palette: FIRE},
  bigBoom: {count: 80, speed: 620, spread: 180, gravity: 600, drag: 2, life: 1100, size: 8, shapes: ['circle', 'spark', 'star'], glow: true, palette: FIRE},
  splash: {count: 18, speed: 300, spread: 180, gravity: 1100, drag: 2.5, life: 650, size: 5, shapes: ['circle'], palette: ['#bfe6ff', '#6cb8f0', '#ffffff']},
  good: {count: 28, speed: 400, spread: 180, gravity: 500, drag: 2, life: 850, size: 7, shapes: ['star', 'circle'], glow: true, palette: ['#16a34a', '#4ade80', '#facc15', '#ffffff']},
  pop: {count: 14, speed: 300, spread: 180, gravity: 600, drag: 2.4, life: 600, size: 6, shapes: ['circle', 'rect'], palette: PALETTE},
  sparkle: {count: 20, speed: 240, spread: 180, gravity: 120, drag: 2, life: 1000, size: 10, shapes: ['star'], glow: true, palette: GOLD},
  smoke: {count: 9, speed: 90, spread: 35, gravity: -140, drag: 1.2, life: 1300, size: 18, shapes: ['circle'], alpha: 0.32, palette: ['#8a8f98', '#b8bcc4']},
  fire: {count: 8, speed: 260, spread: 40, gravity: -200, drag: 1.5, life: 1000, size: 12, shapes: ['emoji'], chars: ['🔥'], palette: ['#fff']},
  firework: {count: 64, speed: 380, spread: 180, gravity: 240, drag: 1.4, life: 1300, size: 5, shapes: ['circle', 'spark'], glow: true, palette: GOLD},
  rocket: {count: 1, speed: 700, spread: 4, gravity: 0, drag: 0, life: 620, size: 4, shapes: ['circle'], glow: true, trail: true, boom: 'firework', palette: GOLD},
};

export const VIBES = {tap: [20], hit: [60], bigHit: [90, 40, 140], win: [60, 40, 60, 40, 160], loss: [260], good: [35], bad: [120]};

/** Pieces for one burst, launched from (x, y). `rand` is injectable for tests. */
export function makeBurst(x, y, p = FX_PARAMS, rand = Math.random, palette = PALETTE) {
  const out = [];
  const shapes = p.shapes ?? ['rect'];
  for (let i = 0; i < p.count; i++) {
    const angle = ((rand() - 0.5) * 2 * p.spread * Math.PI) / 180; // 0 = straight up
    const v = p.speed * (0.45 + rand() * 0.55);
    const color = palette[Math.floor(rand() * palette.length)];
    out.push({
      x, y,
      vx: Math.sin(angle) * v,
      vy: -Math.cos(angle) * v,
      rot: rand() * Math.PI * 2,
      vr: (rand() - 0.5) * 14,
      w: p.size * (0.6 + rand() * 0.8),
      h: p.size * (0.4 + rand() * 0.5),
      color,
      shape: shapes[Math.floor(rand() * shapes.length)],
      char: p.chars ? p.chars[Math.floor(rand() * p.chars.length)] : null,
      glow: !!p.glow,
      alpha: p.alpha ?? 1,
      trail: !!p.trail,
      boom: p.boom ?? null,
      boomColors: p.boom ? [color, '#ffffff'] : null,
      age: 0,
      life: p.life,
      gravity: p.gravity,
      drag: p.drag,
    });
  }
  return out;
}

/** The FX_PARAMS a named preset (see PRESETS) resolves to, plus its palette. `colors` replaces the palette. */
export function burstParams(name, colors = null) {
  const {palette, ...over} = PRESETS[name] ?? PRESETS.pop;
  return {params: {...FX_PARAMS, ...over}, palette: colors ?? palette};
}

/** Advance every piece by `dtMs`; returns the ones still alive (the input is not modified). */
export function stepParticles(parts, dtMs, p = FX_PARAMS) {
  const dt = dtMs / 1000;
  const out = [];
  for (const q of parts) {
    const age = q.age + dtMs;
    if (age >= (q.life ?? p.life)) continue;
    const keep = Math.exp(-(q.drag ?? p.drag) * dt);
    const vx = q.vx * keep;
    const vy = q.vy * keep + (q.gravity ?? p.gravity) * dt;
    out.push({...q, age, vx, vy, x: q.x + vx * dt, y: q.y + vy * dt, rot: q.rot + q.vr * dt});
  }
  return out;
}

/** The pieces that reach the end of their life within `dtMs` and turn into something else (a firework rocket). */
export function expired(parts, dtMs, p = FX_PARAMS) {
  return parts.filter((q) => q.boom && q.age + dtMs >= (q.life ?? p.life));
}

/** A shockwave ring: grows from r0 to r1 and fades over `life` ms. */
export function makeRing(x, y, color, {r0 = 4, r1 = 60, life = 600, width = 4, delay = 0} = {}) {
  return {x, y, color, r0, r1, life, width, age: -delay};
}

export function stepRings(rings, dtMs) {
  return rings.map((r) => ({...r, age: r.age + dtMs})).filter((r) => r.age < r.life);
}

/** How far through its life a ring is, 0 to 1 (0 while it is still waiting out its delay). */
export const ringProgress = (r) => Math.max(0, Math.min(1, r.age / r.life));

// --- browser side ----------------------------------------------------------------------------------------

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
let canvas = null, ctx = null, parts = [], rings = [], raf = 0, last = 0;

function star(r) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, rr = i % 2 ? r * 0.35 : r;
    ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function drawPart(q, dpr) {
  const fade = Math.max(0, Math.min(1, (q.life - q.age) / Math.min(400, q.life * 0.4)));
  ctx.globalAlpha = fade * q.alpha;
  ctx.globalCompositeOperation = q.glow ? 'lighter' : 'source-over';
  ctx.fillStyle = q.color;
  ctx.save();
  ctx.translate(q.x * dpr, q.y * dpr);
  if (q.glow && q.shape !== 'spark') { // a soft halo under the piece (cheaper than a canvas shadow blur)
    ctx.globalAlpha = fade * q.alpha * 0.22;
    ctx.beginPath(); ctx.arc(0, 0, q.w * 1.5 * dpr, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = fade * q.alpha;
  }
  switch (q.shape) {
    case 'circle': ctx.beginPath(); ctx.arc(0, 0, (q.w * dpr) / 2, 0, Math.PI * 2); ctx.fill(); break;
    case 'star': ctx.rotate(q.rot); star((q.w * dpr) / 1.3); break;
    case 'spark': {
      ctx.rotate(Math.atan2(q.vy, q.vx));
      const len = (Math.min(26, Math.hypot(q.vx, q.vy) / 14) + q.w) * dpr;
      ctx.fillRect(-len / 2, -dpr, len, 2 * dpr);
      break;
    }
    case 'emoji':
      ctx.globalAlpha = fade;
      ctx.font = `${q.w * 2 * dpr}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(q.char ?? '✨', 0, 0);
      break;
    default: ctx.rotate(q.rot); ctx.fillRect((-q.w / 2) * dpr, (-q.h / 2) * dpr, q.w * dpr, q.h * dpr);
  }
  ctx.restore();
}

function drawRing(r, dpr) {
  if (r.age < 0) return;
  const k = ringProgress(r), e = 1 - (1 - k) ** 3;
  ctx.globalAlpha = 1 - k;
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = r.color;
  const radius = (r.r0 + (r.r1 - r.r0) * e) * dpr;
  ctx.beginPath();
  ctx.arc(r.x * dpr, r.y * dpr, radius, 0, Math.PI * 2);
  ctx.globalAlpha = (1 - k) * 0.25;
  ctx.lineWidth = Math.max(1, r.width * (1 - k)) * 3 * dpr; // wide faint stroke = glow
  ctx.stroke();
  ctx.globalAlpha = 1 - k;
  ctx.lineWidth = Math.max(1, r.width * (1 - k)) * dpr;
  ctx.stroke();
}

function frame(now) {
  const dt = Math.min(50, now - last);
  last = now;
  const trails = [], chain = [];
  for (const q of parts) if (q.trail) trails.push({...q, trail: false, boom: null, shape: 'circle', w: q.w * 0.8, vx: 0, vy: 0, gravity: 0, drag: 0, age: 0, life: 320, alpha: 0.7});
  for (const q of expired(parts, dt)) {
    const {params, palette} = burstParams(q.boom, q.boomColors);
    chain.push(...makeBurst(q.x, q.y, params, Math.random, palette));
    rings.push(makeRing(q.x, q.y, q.boomColors[0], {r1: 90, life: 700, width: 3}));
  }
  parts = [...stepParticles(parts, dt), ...trails, ...chain];
  rings = stepRings(rings, dt);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const dpr = canvas.width / innerWidth;
  for (const r of rings) drawRing(r, dpr);
  for (const q of parts) drawPart(q, dpr);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  if (parts.length || rings.length) raf = requestAnimationFrame(frame);
  else { raf = 0; canvas.remove(); canvas = ctx = null; }
}

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1000';
  document.body.append(canvas);
  ctx = canvas.getContext('2d');
}

const MAX_PARTS = 700; // a flurry of quick moves must not slow the page down
const MAX_RINGS = 40;

function emit(newParts, newRings = []) {
  ensureCanvas();
  parts.push(...newParts.slice(0, Math.max(0, MAX_PARTS - parts.length)));
  rings.push(...newRings.slice(0, Math.max(0, MAX_RINGS - rings.length)));
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
}

const centerOf = (el) => {
  const r = el?.getBoundingClientRect?.();
  return r && (r.width || r.height) ? {x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height} : null;
};

/** A small burst from the middle of `el` (HTML or SVG): see PRESETS. `colors` replaces the preset's palette. */
export function burstAt(el, preset = 'pop', colors = null) {
  const c = centerOf(el);
  if (reduced() || !c) return;
  const {params, palette} = burstParams(preset, colors);
  emit(makeBurst(c.x, c.y, params, Math.random, palette));
}

/** Shockwave rings from the middle of `el`: one, or a ripple of `count` one after another. */
export function ringAt(el, color = '#ffffff', {count = 1, size = 1} = {}) {
  const c = centerOf(el);
  if (reduced() || !c) return;
  const base = Math.max(c.w, c.h);
  emit([], Array.from({length: count}, (_, i) => makeRing(c.x, c.y, color, {r1: base * (1.4 + i * 0.7) * size, life: 650 + i * 120, delay: i * 140, width: 4 - i})));
}

/** The two player colors from css/style.css, for tinting a burst: [mine, theirs]. */
export function playerColors() {
  const cs = getComputedStyle(document.documentElement);
  return [cs.getPropertyValue('--me').trim() || '#4f46e5', cs.getPropertyValue('--them').trim() || '#e11d74'];
}

/** Confetti cannons from two low corners. */
export function confetti() {
  if (reduced()) return;
  const y = innerHeight * 0.92;
  emit([...makeBurst(innerWidth * 0.18, y), ...makeBurst(innerWidth * 0.82, y)]);
}

/** `n` firework rockets launched over about two seconds. */
export function fireworks(n = 7) {
  if (reduced()) return;
  for (let i = 0; i < n; i++) {
    setTimeout(() => {
      const x = innerWidth * (0.15 + Math.random() * 0.7);
      const rise = innerHeight * (0.45 + Math.random() * 0.3);
      const {params, palette} = burstParams('rocket');
      emit(makeBurst(x, innerHeight * 0.95, {...params, speed: rise / (params.life / 1000)}, Math.random, [palette[Math.floor(Math.random() * 3)]]));
    }, i * 260);
  }
}

/** The big win moment: confetti cannons and a volley of fireworks. */
export function celebrate() {
  confetti();
  fireworks();
}

/** A short horizontal shake of `el`: the whole page for a loss, or one cell or card. */
export function shake(el = document.querySelector('main'), scale = 1) {
  if (reduced() || !el?.animate) return;
  const d = FX_PARAMS.shakePx * scale;
  el.animate(
    [0, -d, d, -d * 0.7, d * 0.7, -d * 0.35, d * 0.35, 0].map((tx) => ({transform: `translateX(${tx}px)`})),
    {duration: FX_PARAMS.shakeMs * Math.max(0.5, scale), easing: 'ease-out'},
  );
}

/** A ring that expands from an HTML element and fades, in `color`. */
export function flash(el, color) {
  if (reduced() || !el?.animate) return;
  el.animate([{boxShadow: `0 0 0 0 ${color}`}, {boxShadow: '0 0 0 10px transparent'}], {duration: 520, easing: 'ease-out'});
}

/** A quick pop of a number or label (a score going up). */
export function bump(el) {
  if (reduced() || !el?.animate) return;
  el.animate([{transform: 'scale(1)'}, {transform: 'scale(1.9)', offset: 0.35}, {transform: 'scale(1)'}], {duration: 460, easing: 'cubic-bezier(.3,1.6,.5,1)'});
}

function overlay(css) {
  const d = document.createElement('div');
  d.setAttribute('aria-hidden', 'true');
  d.style.cssText = `position:fixed;pointer-events:none;${css}`;
  document.body.append(d);
  return d;
}

/** Text that pops up over `el`, floats up and fades: "+1", "MATCH!", "SHIP SUNK!". */
export function floatText(el, text, {color = '#ffffff', size = 22} = {}) {
  const c = centerOf(el);
  if (!c) return;
  const d = overlay(`left:${c.x}px;top:${c.y}px;z-index:1002;font:900 ${size}px system-ui,sans-serif;letter-spacing:.04em;white-space:nowrap;color:${color};text-shadow:0 2px 0 rgba(0,0,0,.45),0 0 12px ${color}`);
  d.textContent = text;
  const move = reduced() ? 0 : 1;
  d.animate([
    {transform: 'translate(-50%,-50%) scale(.4)', opacity: 0},
    {transform: 'translate(-50%,-70%) scale(1.25)', opacity: 1, offset: 0.2},
    {transform: `translate(-50%,${-70 - 60 * move}%) scale(1)`, opacity: 0},
  ], {duration: 1100, easing: 'ease-out'}).finished.then(() => d.remove(), () => d.remove());
}

/** A colored glow around the screen edges that fades out (a hit you took, a wrong answer). */
export function screenFlash(color = '#ff2d2d', strength = 0.45, ms = 420) {
  const d = overlay(`inset:0;z-index:999;background:radial-gradient(ellipse at center,transparent 45%,${color} 130%)`);
  d.animate([{opacity: 0}, {opacity: reduced() ? strength * 0.5 : strength, offset: 0.15}, {opacity: 0}], {duration: ms, easing: 'ease-out'})
    .finished.then(() => d.remove(), () => d.remove());
}

const BANNERS = {
  win: {text: 'VICTORY', icon: '🏆', color: '#ffd84a', glow: 'rgba(255,200,40,.55)'},
  loss: {text: 'DEFEAT', icon: '💀', color: '#ff5a5a', glow: 'rgba(255,40,40,.4)'},
  draw: {text: 'DRAW', icon: '🤝', color: '#9fd0ff', glow: 'rgba(120,180,255,.35)'},
};

/** The result slam across the screen: 'win' | 'loss' | 'draw'. */
export function banner(kind) {
  const b = BANNERS[kind];
  if (!b) return;
  const wrap = overlay('inset:0;z-index:1001;display:grid;place-items:center;overflow:hidden');
  wrap.style.background = `radial-gradient(circle at center,rgba(0,0,0,.62) 0%,rgba(0,0,0,.45) 25%,${b.glow} 55%,transparent 78%)`; // dark center so the text always reads
  const label = document.createElement('div');
  label.style.cssText = `text-align:center;font:900 clamp(44px,15vw,130px)/1 system-ui,sans-serif;letter-spacing:.06em;color:${b.color};-webkit-text-stroke:3px rgba(0,0,0,.65);paint-order:stroke fill;text-shadow:0 6px 0 rgba(0,0,0,.4),0 0 40px ${b.glow}`;
  label.innerHTML = `<div style="font-size:.5em;margin-bottom:.1em">${b.icon}</div>${b.text}`;
  wrap.append(label);
  const tilt = kind === 'loss' ? 2 : -3;
  if (reduced()) {
    wrap.animate([{opacity: 0}, {opacity: 1, offset: 0.2}, {opacity: 1, offset: 0.8}, {opacity: 0}], {duration: 1600}).finished.then(() => wrap.remove(), () => wrap.remove());
    return;
  }
  const from = kind === 'loss' ? 'translateY(-60vh) scale(1.2)' : 'scale(3.2)';
  // The overshoot easing belongs on the slam keyframe, not on the whole timeline (that would run the fade-out early).
  label.animate([
    {transform: `${from} rotate(${tilt}deg)`, opacity: 0, easing: 'cubic-bezier(.2,1.3,.4,1)'},
    {transform: `scale(1) rotate(${tilt}deg)`, opacity: 1, offset: 0.22},
    {transform: `scale(1.05) rotate(${tilt}deg)`, opacity: 1, offset: 0.8},
    {transform: `scale(1.3) rotate(${tilt}deg)`, opacity: 0},
  ], {duration: 2000, easing: 'linear'});
  wrap.animate([{opacity: 0}, {opacity: 1, offset: 0.15}, {opacity: 1, offset: 0.8}, {opacity: 0}], {duration: 2000}).finished.then(() => wrap.remove(), () => wrap.remove());
}

/** The whole screen drains of color for a moment (a loss). */
export function drain(el = document.querySelector('main')) {
  if (reduced() || !el?.animate) return;
  el.animate([{filter: 'grayscale(0)'}, {filter: 'grayscale(.9) brightness(.8)', offset: 0.2}, {filter: 'grayscale(.9) brightness(.8)', offset: 0.7}, {filter: 'grayscale(0)'}], {duration: 2000});
}

/** Vibrate on phones that can (a named pattern from VIBES). Silent everywhere else. */
export function vibrate(name) {
  if (!FX_PARAMS.haptics) return;
  try { navigator.vibrate?.(VIBES[name] ?? name); } catch { /* not allowed before a tap, or unsupported */ }
}

/** What to show for a sound scenario id from js/sound-events.js. */
export function fxForScenario(id) {
  if (id === 'game.won') return () => { celebrate(); banner('win'); vibrate('win'); };
  if (id === 'game.lost') return () => { shake(); drain(); screenFlash('#ff2d2d', 0.5, 900); banner('loss'); vibrate('loss'); };
  if (id === 'game.draw') return () => banner('draw');
  return null;
}

// --- ?tune: sliders for every number above -----------------------------------------------------------------

export async function mountTunePanel() {
  const {Pane} = await import('https://esm.sh/tweakpane@4.0.5');
  const pane = new Pane({title: 'FX tuning'});
  const ranges = {
    count: [10, 400, 1], speed: [200, 1600, 10], spread: [0, 180, 1], gravity: [200, 3000, 10],
    drag: [0, 5, 0.1], life: [400, 4000, 50], size: [3, 20, 1], shakePx: [0, 30, 1], shakeMs: [100, 1200, 20],
  };
  for (const [key, [min, max, step]] of Object.entries(ranges)) pane.addBinding(FX_PARAMS, key, {min, max, step});
  pane.addBinding(FX_PARAMS, 'haptics');
  pane.addButton({title: 'Win (confetti + fireworks)'}).on('click', fxForScenario('game.won'));
  pane.addButton({title: 'Loss'}).on('click', fxForScenario('game.lost'));
  pane.addButton({title: 'Draw'}).on('click', fxForScenario('game.draw'));
  return pane;
}
