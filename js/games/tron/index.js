// Light Cycles as a room game: two bikes, steer, don't hit a wall. Rules: rules.js (pure, same on both screens),
// lockstep and messages: match.js. This file is the show: a WebGL neon arena (Pixi, vendor/pixi) with bloom, bikes
// that glide between grid steps, engine sparks, crash explosions with a camera punch-in and a "derez" fade, plus
// GSAP title cards and a synthwave loop. Input: swipe, arrow keys / WASD, or the two thumb buttons.

import {bake} from '../../bake.js';
import {loadCss} from '../../load-css.js';
import {TronMatch} from './match.js';
import {DOWN, H, LEFT, RIGHT, UP, W, tickMsAt} from './rules.js';
import {celebrate, vibrate} from '../../fx.js';
import {play} from '../../sound.js';
import {synth} from '../../synth.js';
import {calm, countTo, enter, gsap, pop, pulse, quake, resultSound, titleCard} from '../../juice.js';

const PIXI_URL = new URL('../../../vendor/pixi/pixi.min.js', import.meta.url).href;
const FILTERS_URL = new URL('../../../vendor/pixi/pixi-filters.js', import.meta.url).href;

const TEMPLATE = `
<div class="lc">
  <header class="lc-hud">
    <div class="lc-p me"><span class="lc-dot"></span><b class="lc-name lc-name-me"></b><span class="lc-pips lc-pips-me"></span></div>
    <div class="lc-mid"><div class="lc-round"></div><div class="lc-speed"><i></i></div></div>
    <div class="lc-p them"><span class="lc-pips lc-pips-them"></span><b class="lc-name lc-name-them"></b><span class="lc-dot"></span></div>
  </header>
  <div class="lc-stage">
    <div class="lc-pixi"></div>
    <div class="lc-you" hidden>YOU</div>
    <div class="lc-count" aria-live="assertive"></div>
    <div class="lc-msg" aria-live="polite"><div class="lc-msg-big"></div><div class="lc-msg-small"></div></div>
    <div class="lc-flash"></div>
  </div>
  <p class="lc-error" hidden></p>
  <div class="lc-pad">
    <button type="button" class="lc-turn lc-left" aria-label="Turn left"><svg viewBox="0 0 48 48"><path d="M30 10 L14 24 L30 38"/></svg></button>
    <button type="button" class="lc-go"></button>
    <button type="button" class="lc-turn lc-right" aria-label="Turn right"><svg viewBox="0 0 48 48"><path d="M18 10 L34 24 L18 38"/></svg></button>
  </div>
  <p class="lc-hint">Swipe on the arena, or arrow keys / WASD</p>
</div>`;

const KEYS = {ArrowUp: UP, w: UP, W: UP, ArrowRight: RIGHT, d: RIGHT, D: RIGHT, ArrowDown: DOWN, s: DOWN, S: DOWN, ArrowLeft: LEFT, a: LEFT, A: LEFT};
const NEON = [0xff3d7f, 0x22d3ff];          // seat A pink-red, seat B cyan: same hue families as --seat-a / --seat-b
const NEON_CSS = ['#ff3d7f', '#22d3ff'];
const CELL = 20;                              // world units per grid cell
const SIZE = W * CELL;
const ANGLE = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
// Synthwave loop: A minor arpeggio over a walking bass.
const A = 220; const C = 261.6; const E = 329.6; const G = 392; const F = 349.2;
const LOOP = {steps: [A * 2, E * 2, A * 4, E * 2, C * 2, E * 2, A * 4, E * 2, F * 2, C * 2, F * 4, C * 2, G * 2, E * 2, G * 4, E * 2],
  bass: [A / 2, A / 2, A / 2, A / 2, F / 2, F / 2, G / 2, G / 2], bpm: 118, type: 'square', peak: 0.022};

export async function createGame({session, container}) {
  await loadCss(new URL('./tron.css', import.meta.url));
  container.innerHTML = TEMPLATE;
  const unbake = bake(container.querySelector('.lc')); // paint the rich backgrounds once (js/bake.js)
  const $ = (s) => container.querySelector(s);
  const root = $('.lc');
  const stage = $('.lc-stage');
  const host = $('.lc-pixi');

  const PIXI = await import(PIXI_URL);
  const {AdvancedBloomFilter} = await import(FILTERS_URL);
  const {Application, Container, Graphics, Sprite} = PIXI;

  const app = new Application();
  await app.init({width: 400, height: 400, background: 0x05010f, antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true});
  host.append(app.canvas);
  app.canvas.setAttribute('aria-label', 'Arena');

  // --- the world ---------------------------------------------------------------------------
  const world = new Container();       // scaled to fit; the camera moves this
  app.stage.addChild(world);
  const floor = new Graphics();
  const glowLayer = new Container();   // everything that blooms
  const trails = [new Graphics(), new Graphics()];
  const tips = [new Graphics(), new Graphics()];
  const heads = [new Container(), new Container()];
  const sparks = new Container();
  const rings = new Graphics();
  world.addChild(floor, glowLayer);
  glowLayer.addChild(...trails, ...tips, sparks, rings, ...heads);
  glowLayer.filters = [new AdvancedBloomFilter({threshold: 0.18, bloomScale: 1.3, brightness: 1.05, blur: 6, quality: 3, resolution: 1})];

  drawFloor(floor);
  heads.forEach((h, i) => h.addChild(bikeShape(i)));

  const dot = new Graphics().circle(0, 0, 8).fill(0xffffff);
  const dotTex = app.renderer.generateTexture(dot);
  const parts = [];                    // {s: Sprite, vx, vy, life, age, drag}

  function emit(x, y, color, {n = 1, speed = 60, life = 0.5, size = 0.35, spread = Math.PI * 2, angle = 0, drag = 2.5} = {}) {
    for (let k = 0; k < n; k++) {
      const s = new Sprite(dotTex);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.tint = color;
      s.position.set(x, y);
      const sc = size * (0.5 + Math.random());
      s.scale.set(sc);
      const a = angle + (Math.random() - 0.5) * spread;
      const v = speed * (0.35 + Math.random());
      sparks.addChild(s);
      parts.push({s, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life * (0.6 + Math.random() * 0.8), age: 0, drag, sc});
    }
  }

  function stepParts(dt) {
    for (let k = parts.length - 1; k >= 0; k--) {
      const p = parts[k];
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) { p.s.destroy(); parts.splice(k, 1); continue; }
      const f = Math.exp(-p.drag * dt);
      p.vx *= f; p.vy *= f;
      p.s.x += p.vx * dt; p.s.y += p.vy * dt;
      p.s.alpha = 1 - t;
      p.s.scale.set(p.sc * (1 - t * 0.6));
    }
  }

  const waves = [];                    // shockwave rings {x, y, color, age, life, r}
  function shockwave(x, y, color, r = CELL * 7, life = 0.6) { waves.push({x, y, color, age: 0, life, r}); }
  function stepWaves(dt) {
    rings.clear();
    for (let k = waves.length - 1; k >= 0; k--) {
      const w = waves[k];
      w.age += dt;
      const t = w.age / w.life;
      if (t >= 1) { waves.splice(k, 1); continue; }
      const e = 1 - (1 - t) ** 3;
      rings.circle(w.x, w.y, 4 + w.r * e).stroke({width: 6 * (1 - t) + 1, color: w.color, alpha: 1 - t});
    }
  }

  // --- layout ------------------------------------------------------------------------------
  let scale = 1;
  function fit() {
    const size = Math.max(200, Math.round(host.clientWidth));
    if (app.screen.width !== size) app.renderer.resize(size, size);
    scale = size / SIZE;
    if (!camBusy) { world.scale.set(scale); world.position.set(0, 0); world.pivot.set(0, 0); }
  }
  const resizer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  resizer?.observe(host);

  // --- state for drawing -------------------------------------------------------------------
  let last = null;
  let prev = null;
  let destroyed = false;
  let drawnLen = [0, 0];               // path length already in the trail graphics
  let tickSeen = -1;
  let tickAt = 0;
  let headAngle = [0, 0];
  let camBusy = false;
  let shownCount = null;
  let engine = null;
  let stopMusic = null;
  let introDone = false;
  let shownRound = 0;
  const tweens = new Set();
  const keep = (t) => { if (t) tweens.add(t); return t; };

  const cellCenter = (idx) => [((idx % W) + 0.5) * CELL, (Math.floor(idx / W) + 0.5) * CELL];

  function redrawTrail(i, path, derez = 1) {
    const g = trails[i];
    g.clear();
    if (path.length < 2) return;
    const pts = path.map(cellCenter);
    const line = (width, color, alpha) => {
      g.moveTo(pts[0][0], pts[0][1]);
      for (let k = 1; k < pts.length - 1; k++) g.lineTo(pts[k][0], pts[k][1]);
      g.stroke({width, color, alpha: alpha * derez, cap: 'round', join: 'round'});
    };
    line(CELL * 0.95, NEON[i], 0.22);
    line(CELL * 0.5, NEON[i], 0.95);
    line(CELL * 0.14, 0xffffff, 0.9);
  }

  /** The bike's on-screen spot: it glides from its previous cell to its current one over a tick. */
  function headPos(i, now) {
    const s = last.state;
    const path = s.paths[i];
    const [cx, cy] = cellCenter(path[path.length - 1]);
    if (path.length < 2 || last.phase !== 'playing') return [cx, cy, 1];
    const [px, py] = cellCenter(path[path.length - 2]);
    const f = Math.min(1, (now - tickAt) / tickMsAt(s.tick));
    return [px + (cx - px) * f, py + (cy - py) * f, f];
  }

  function frame() {
    if (destroyed) return;
    const now = performance.now();
    const dt = Math.min(0.05, app.ticker.deltaMS / 1000);
    match.update(now);
    if (!last) return;
    const s = last.state;
    if (s.tick !== tickSeen) { tickSeen = s.tick; tickAt = now; onTick(); }
    s.paths.forEach((path, i) => {
      if (path.length !== drawnLen[i]) { drawnLen[i] = path.length; redrawTrail(i, path); }
      const [hx, hy] = headPos(i, now);
      const tip = tips[i];
      tip.clear();
      if (path.length >= 2 && s.bikes[i].alive) {
        const [px, py] = cellCenter(path[path.length - 2]);
        for (const [w, c, a] of [[CELL * 0.95, NEON[i], 0.22], [CELL * 0.5, NEON[i], 0.95], [CELL * 0.14, 0xffffff, 0.9]]) {
          tip.moveTo(px, py).lineTo(hx, hy).stroke({width: w, color: c, alpha: a, cap: 'round'});
        }
      }
      const h = heads[i];
      h.position.set(hx, hy);
      h.rotation = headAngle[i];
      h.visible = s.bikes[i].alive || last.phase === 'waiting' || last.phase === 'countdown';
      if (last.phase === 'playing' && s.bikes[i].alive && Math.random() < 0.7) {
        const back = headAngle[i] + Math.PI;
        emit(hx + Math.cos(back) * CELL * 0.6, hy + Math.sin(back) * CELL * 0.6, NEON[i], {n: 1, speed: 50, life: 0.35, size: 0.28, angle: back, spread: 1.1});
      }
    });
    stepParts(dt);
    stepWaves(dt);
    placeYou();
  }

  function onTick() {
    const s = last.state;
    // Turn the bike sprites towards their new heading, the short way round.
    s.bikes.forEach((b, i) => {
      const target = ANGLE[b.d];
      let cur = headAngle[i];
      let delta = ((target - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      if (Math.abs(delta) > 0.01 && last.phase === 'playing') {
        const [hx, hy] = cellCenter(s.paths[i][s.paths[i].length - 1]);
        emit(hx, hy, NEON[i], {n: 10, speed: 120, life: 0.35, size: 0.3});
        if (i === last.seat) synth.zap(1700);
        const o = {a: cur};
        keep(gsap.to(o, {a: cur + delta, duration: calm() ? 0 : 0.12, ease: 'power2.out', onUpdate: () => { headAngle[i] = o.a; }}));
      } else headAngle[i] = target;
    });
    if (last.phase === 'playing') {
      const k = 105 / tickMsAt(s.tick);
      engine?.speed(k);
      $('.lc-speed i').style.setProperty('--k', String(Math.min(1, (k - 1) / 0.7)));
    }
  }

  function placeYou() {
    const you = $('.lc-you');
    const show = last.phase === 'waiting' || last.phase === 'countdown';
    you.hidden = !show;
    if (!show) return;
    const b = last.state.bikes[last.seat];
    you.style.left = `${((b.x + 0.5) / W) * 100}%`;
    you.style.top = `${((b.y + 0.5) / H) * 100}%`;
  }

  // --- controls -----------------------------------------------------------------------------
  const press = (el, fn) => el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    synth.unlock();
    if (fn()) { pop(el, {scale: 0.88}); el.classList.add('hit'); setTimeout(() => el.classList.remove('hit'), 140); }
  });
  press($('.lc-left'), () => match.turn(-1));
  press($('.lc-right'), () => match.turn(1));
  const onKey = (e) => {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
    if (e.key in KEYS) { if (match.steer(KEYS[e.key])) e.preventDefault(); }
    else if ((e.key === ' ' || e.key === 'Enter') && !$('.lc-go').hidden) { e.preventDefault(); $('.lc-go').click(); }
  };
  window.addEventListener('keydown', onKey);

  let swipe = null;
  const canvas = app.canvas;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => { swipe = {x: e.clientX, y: e.clientY}; synth.unlock(); });
  canvas.addEventListener('pointermove', (e) => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
    match.steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? RIGHT : LEFT) : (dy > 0 ? DOWN : UP));
    swipe = {x: e.clientX, y: e.clientY};
  });
  const endSwipe = () => { swipe = null; };
  canvas.addEventListener('pointerup', endSwipe);
  canvas.addEventListener('pointercancel', endSwipe);

  let goPulse = null;
  $('.lc-go').addEventListener('click', () => {
    synth.unlock();
    if (!stopMusic) stopMusic = synth.startLoop(LOOP);
    if (last.phase === 'over') { match.nextRound(); return; }
    match.ready();
  });

  // --- HUD and messages ---------------------------------------------------------------------
  function pips(el, n, of, seat) {
    if (el.childElementCount !== of) el.replaceChildren(...Array.from({length: of}, () => document.createElement('i')));
    [...el.children].forEach((p, k) => {
      const lit = k < n;
      if (lit && !p.classList.contains('lit')) { p.classList.add('lit'); pop(p, {scale: 2.2}); }
      p.classList.toggle('lit', lit);
      p.style.setProperty('--c', NEON_CSS[seat]);
    });
  }

  function message(big, small = '', cls = '') {
    const msg = $('.lc-msg');
    const b = $('.lc-msg-big');
    if (b.textContent === big && $('.lc-msg-small').textContent === small) return;
    msg.className = `lc-msg ${cls}`;
    b.textContent = big;
    $('.lc-msg-small').textContent = small;
    if (big || small) enter([b, $('.lc-msg-small')], {y: 12, stagger: 0.08});
  }

  function render(s) {
    prev = last;
    last = s;
    const me = s.seat;
    root.style.setProperty('--me', NEON_CSS[me]);
    root.style.setProperty('--them', NEON_CSS[1 - me]);
    $('.lc-name-me').textContent = `${s.names[me]}`;
    $('.lc-name-them').textContent = s.opponentName;
    $('.lc-p.me .lc-dot').dataset.mark = String(me);
    $('.lc-p.them .lc-dot').dataset.mark = String(1 - me);
    pips($('.lc-pips-me'), s.scores[me], s.toWin, me);
    pips($('.lc-pips-them'), s.scores[1 - me], s.toWin, 1 - me);
    $('.lc-round').textContent = `Round ${s.round}`;
    root.dataset.phase = s.phase;
    const err = $('.lc-error');
    err.hidden = !s.error;
    err.textContent = s.error ?? '';

    const go = $('.lc-go');
    const showGo = (s.phase === 'waiting' && !s.readyMine) || s.phase === 'over';
    go.hidden = !showGo;
    go.textContent = s.phase === 'over' ? 'Next round' : 'Ready';
    if (showGo && !goPulse) goPulse = pulse(go, {scale: 1.05});
    if (!showGo && goPulse) { goPulse.kill(); goPulse = null; gsap.set(go, {clearProps: 'scale'}); }

    if (s.round !== shownRound && s.phase === 'waiting') {
      // A fresh round: clear the old light, show the round card.
      shownRound = s.round;
      drawnLen = [0, 0];
      tickSeen = -1;
      trails.forEach((t) => { t.alpha = 1; t.clear(); });
      if (introDone) keep(titleCard(stage, {kicker: 'Light Cycles', title: `Round ${s.round}`, sub: scoreLine(s), theme: 'neon', hold: 0.6}));
    }

    if (s.phase === 'waiting') message(s.readyMine ? 'Waiting' : 'Ready?', s.readyMine ? `for ${s.opponentName}…` : 'Press Ready when you are', 'soft');
    else if (s.phase === 'countdown') message('', '');
    else if (s.phase === 'playing') message(s.stalled ? 'Syncing…' : '', s.stalled ? 'waiting for the connection' : '', 'soft');

    countdown(s);
    if (prev?.phase === 'playing' && (s.phase === 'over' || s.phase === 'finished')) crash(s);
  }

  const scoreLine = (s) => `${s.scores[s.seat]} – ${s.scores[1 - s.seat]} · first to ${s.toWin}`;

  function countdown(s) {
    const el = $('.lc-count');
    if (s.phase === 'countdown') {
      if (shownCount !== s.countdown) {
        shownCount = s.countdown;
        el.textContent = String(s.countdown);
        synth.beep(440, 0.12, 0.1);
        keep(gsap.fromTo(el, {scale: 2.6, opacity: 0, rotate: -8}, {scale: 1, opacity: 1, rotate: 0, duration: 0.45, ease: 'back.out(2.4)'}));
        keep(gsap.to(el, {opacity: 0, scale: 0.7, duration: 0.2, delay: 0.5}));
        last.state.bikes.forEach((b, i) => { const [x, y] = cellCenter(b.y * W + b.x); shockwave(x, y, NEON[i], CELL * 3, 0.5); });
      }
      return;
    }
    if (shownCount !== null && s.phase === 'playing') {
      el.textContent = 'GO!';
      synth.beep(880, 0.3, 0.12);
      synth.whoosh(0.5);
      keep(gsap.fromTo(el, {scale: 0.6, opacity: 1}, {scale: 2.2, opacity: 0, duration: 0.7, ease: 'power2.out'}));
      if (!engine) engine = synth.startEngine();
      vibrate('tap');
    }
    shownCount = null;
  }

  function crash(s) {
    const l = s.last;
    if (!l) return;
    engine?.stop();
    engine = null;
    synth.boom();
    const mine = l.winner === s.seat;
    const draw = l.winner === 'draw';
    vibrate(draw ? 'hit' : mine ? 'win' : 'loss');
    // Flash, shake, explode.
    keep(gsap.fromTo($('.lc-flash'), {opacity: 0.85}, {opacity: 0, duration: 0.45, ease: 'power2.out'}));
    quake(stage, 1.2);
    let focus = null;
    for (const i of l.crashed) {
      const b = l.bikes[i];
      const [x, y] = cellCenter(b.y * W + b.x);
      focus = [x, y];
      emit(x, y, NEON[i], {n: 70, speed: 340, life: 0.9, size: 0.45, drag: 3});
      emit(x, y, 0xffffff, {n: 24, speed: 220, life: 0.5, size: 0.3, drag: 4});
      shockwave(x, y, NEON[i], CELL * 9, 0.7);
      shockwave(x, y, 0xffffff, CELL * 4, 0.4);
      // Derez: the crashed bike's light flickers out.
      const t = trails[i];
      keep(gsap.timeline({delay: 0.5})
        .to(t, {alpha: 0.2, duration: 0.06, repeat: 5, yoyo: true, ease: 'steps(1)'})
        .to(t, {alpha: 0.12, duration: 0.6, ease: 'power2.in'}));
    }
    // Camera: punch in on the crash, hold, ease back out.
    if (focus && !calm()) {
      camBusy = true;
      const z = 1.45;
      const cam = {k: 1};
      keep(gsap.timeline({onComplete: () => { camBusy = false; fit(); }})
        .to(cam, {k: 1, duration: 0})
        .to(cam, {k: z, duration: 0.35, ease: 'power3.out', onUpdate: () => aim(focus, cam.k)})
        .to(cam, {k: 1, duration: 0.6, ease: 'power2.inOut', delay: 0.7, onUpdate: () => aim(focus, cam.k)}));
    }
    // The verdict.
    const big = draw ? 'Double crash' : mine ? 'Round won' : 'Derezzed';
    const loser = draw ? null : 1 - l.winner;
    const small = draw ? 'Nobody scores · replay' : mine ? `${s.opponentName} ${hitWhat(s, loser, s.seat)}` : `You ${hitWhat(s, loser, s.seat)}`;
    setTimeout(() => {
      if (destroyed) return;
      message(big, small, draw ? 'soft' : mine ? 'win' : 'lose');
      if (s.finished) finale(s);
      else if (!draw) play(mine ? 'tr.round_won' : 'tr.round_lost');
    }, 650);
  }

  /** What the crashed bike ran into, from the viewer's side: "hit the wall", "ran into your light", ... */
  function hitWhat(s, i, viewer) {
    const b = s.state.bikes[i];
    const DXS = [0, 1, 0, -1]; const DYS = [-1, 0, 1, 0];
    const x = b.x + DXS[b.d]; const y = b.y + DYS[b.d];
    if (x < 0 || y < 0 || x >= W || y >= H) return 'hit the wall';
    const owner = s.state.grid[y * W + x] - 1;
    if (owner === i) return 'ran into their own light'.replace('their', i === viewer ? 'your' : 'their');
    if (owner === 1 - i) return owner === viewer ? 'ran into your light' : i === viewer ? `ran into ${s.opponentName}'s light` : 'ran into their light';
    return 'collided head-on';
  }

  /** Point the camera at `p` with zoom `k` (1 = whole arena), keeping the arena on screen. */
  function aim(p, k) {
    const size = app.screen.width;
    const z = scale * k;
    world.scale.set(z);
    const half = size / 2 / z;
    const cx = Math.max(half, Math.min(SIZE - half, p[0]));
    const cy = Math.max(half, Math.min(SIZE - half, p[1]));
    world.pivot.set(cx, cy);
    world.position.set(size / 2, size / 2);
  }

  function finale(s) {
    const [a, b] = [s.scores[s.seat], s.scores[1 - s.seat]];
    const won = a > b;
    resultSound(a, b);
    stopMusic?.();
    stopMusic = null;
    synth.arpeggio(won);
    if (won) celebrate();
    keep(titleCard(stage, {kicker: a === b ? 'Match drawn' : won ? 'You win the match' : `${s.opponentName} wins`, title: won ? 'Victory' : a === b ? 'Draw' : 'Game over',
      sub: `${a} – ${b}`, theme: 'neon', hold: 1.6}));
  }

  function drawFloor(g) {
    g.rect(0, 0, SIZE, SIZE).fill(0x070318);
    for (let k = 1; k < W; k++) {
      const major = k % 6 === 0;
      const p = k * CELL;
      g.moveTo(p, 0).lineTo(p, SIZE).moveTo(0, p).lineTo(SIZE, p);
      g.stroke({width: major ? 1.6 : 0.8, color: major ? 0x7a5cff : 0x2a2a6e, alpha: major ? 0.55 : 0.6});
    }
    g.rect(2, 2, SIZE - 4, SIZE - 4).stroke({width: 4, color: 0x7a5cff, alpha: 0.9});
  }

  function bikeShape(i) {
    const g = new Graphics();
    const L = CELL * 1.5;
    const Wd = CELL * 0.72;
    g.roundRect(-L * 0.6, -Wd / 2, L, Wd, Wd / 2).fill(NEON[i]);
    g.roundRect(-L * 0.6, -Wd / 2, L, Wd, Wd / 2).stroke({width: 2, color: 0xffffff, alpha: 0.9});
    g.circle(L * 0.3, 0, Wd * 0.28).fill(0xffffff);           // headlight
    if (i === 0) g.circle(-L * 0.15, 0, Wd * 0.22).stroke({width: 2.5, color: 0x05010f});  // seat A: a ring
    else g.circle(-L * 0.15, 0, Wd * 0.2).fill(0x05010f);                                  // seat B: a dot
    return g;
  }

  const match = new TronMatch({session, onChange: render});
  render(match.snapshot(performance.now()));
  headAngle = last.state.bikes.map((b) => ANGLE[b.d]);
  fit();
  app.ticker.add(frame);
  enter(container.querySelectorAll('.lc-hud > *, .lc-pad > *'), {y: 20, stagger: 0.07});
  keep(titleCard(stage, {kicker: 'Neon arena', title: 'Light Cycles', sub: `First to ${last.toWin} rounds · don't hit the light`, theme: 'neon', hold: 1}).then(() => { introDone = true; }));
  shownRound = last.round;

  return {
    destroy() { unbake();
      destroyed = true;
      engine?.stop();
      stopMusic?.();
      for (const t of tweens) t?.kill?.();
      gsap.killTweensOf(container.querySelectorAll('*'));
      window.removeEventListener('keydown', onKey);
      resizer?.disconnect();
      match.destroy();
      app.destroy(true, {children: true, texture: true});
      container.replaceChildren();
    },
  };
}
