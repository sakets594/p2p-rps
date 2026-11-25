// Cup Pong view: a 2D canvas with a perspective projection, the HUD, the intro and
// first-turn spinner, rack swaps and the swipe input. It only displays what the match
// (match.js) decides: every throw, mine or the other player's, arrives as a match event and
// is replayed here with the same deterministic physics, one event at a time.
//
//   const view = mountCupPongView({container, match});
//   view.onEvent(ev)      feed match events
//   view.start(snapshot)  once, after mounting, with the match's current state
//   view.destroy()

import {layoutCups} from './physics.js';
import {PARAMS as P, RULES} from './match.js';
import {shapeThrow, ASSIST_DEFAULTS} from './aim-assist.js';
import {play} from '../../sound.js';
import {matchEndScenario, throwScenario} from '../../sound-events.js';
import {synth} from '../../synth.js';

// Swipe input: power comes from the swipe LENGTH (screen heights), which must finish within timeMs.
const S = {minLen: 0.08, maxLen: 0.42, timeMs: 500, angleRange: 50, angleStep: 1.25, grab: 2.6};
// The forgiveness helper (aim-assist.js), tuned for the reference proportions.
const A = {...ASSIST_DEFAULTS, xMargin: 0.06, zOvershoot: 0.25, captureRadius: 0.45, magnetRadius: 0.1, magnet: 0.35, formationPull: 0.6, lateralPull: 0.5, magnetMax: 0.8};
// Camera: 51 deg tilt, 40 deg vertical field of view, about 1.66 m up and 0.75 m behind the ball.
const CAM = {y: 1.66, z: -0.75, pitch: 0.89, fov: 40, hz: 0.5};
const COLORS = {
  mine: {a: '#6fb1f5', b: '#4a8fe0', c: '#2d5fa6', d: '#1b3d70', rim: '#e3f0ff', in1: '#0d1d36', in2: '#243f6a'},
  theirs: {a: '#f0716a', b: '#d9433c', c: '#b02c27', d: '#7e1c19', rim: '#ffe3df', in1: '#2b0907', in2: '#6a1b17'},
};

const ease = {
  out: (k) => 1 - Math.pow(1 - k, 3),
  back: (k) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); },
  sineOut: (k) => Math.sin(k * Math.PI / 2),
  inOut: (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2),
};
const initial = (name) => (Array.from(name || '?')[0] || '?').toUpperCase();
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export function mountCupPongView({container, match}) {
  const seat = match.seat;
  const [youName, rivalName] = [match.names[seat], match.names[1 - seat]];
  let destroyed = false;
  let raf = 0;

  const root = document.createElement('div');
  root.className = 'cp-root';
  root.innerHTML = `
    <canvas class="cp-canvas"></canvas>
    <div class="cp-hud">
      <div class="cp-pcard" data-card="you"><div class="cp-av" style="background:var(--cp-you)">${esc(initial(youName))}</div><div class="cp-nm">${esc(youName)}</div><div class="cp-sc" data-sc="you">0</div></div>
      <div class="cp-round"><div class="cp-round-txt">ROUND 1/${RULES.rounds}</div><div class="cp-dots"><i></i><i></i></div></div>
      <div class="cp-pcard" data-card="rival"><div class="cp-av" style="background:var(--cp-rival)">${esc(initial(rivalName))}</div><div class="cp-nm">${esc(rivalName)}</div><div class="cp-sc" data-sc="rival">0</div></div>
    </div>
    <div class="cp-msg"></div>
    <div class="cp-start">STARTING NOW...</div>
    <div class="cp-ov cp-intro">
      <div class="cp-intro-cards">
        <div class="cp-big"><div class="cp-av" style="background:var(--cp-you)">${esc(initial(youName))}</div><div class="cp-nm">${esc(youName)}</div></div>
        <div class="cp-big"><div class="cp-av" style="background:var(--cp-rival)">${esc(initial(rivalName))}</div><div class="cp-nm">${esc(rivalName)}</div></div>
      </div>
      <div class="cp-pillbig" data-intro-pill>RIVAL FOUND!</div>
    </div>
    <div class="cp-ov cp-spin hidden">
      <div class="cp-who" data-who="you">${esc(youName)}</div>
      <div class="cp-dial"><div class="cp-needle"></div></div>
      <div class="cp-who" data-who="rival">${esc(rivalName)}</div>
    </div>
    <div class="cp-ov cp-end hidden"><h2></h2><p></p></div>
    <div class="cp-ov cp-notice hidden"></div>`;
  container.append(root);
  const $ = (sel) => root.querySelector(sel);
  const canvas = $('.cp-canvas'), ctx = canvas.getContext('2d');

  // ---- state shown on screen (follows match events, one at a time) ------------------------------------
  const newRack = () => layoutCups(RULES.cups, P).map((c) => ({...c, alive: true, sc: 1, lift: 0}));
  const vs = {
    turn: null, round: 1, ballsUsed: 0, scores: [0, 0], racks: [newRack(), newRack()],
    canThrow: false, ballVisible: false, ballScale: 1, thrown: false, flight: null, fx: [], started: false, over: false,
  };
  const toast = {text: '', until: 0};
  const say = (t) => { toast.text = t; toast.until = performance.now() + 1200; };
  const target = () => vs.racks[1 - vs.turn];
  const colorsFor = (rackSeat) => (rackSeat === seat ? COLORS.mine : COLORS.theirs);

  // ---- helpers ------------------------------------------------------------------------------------------
  const wait = (ms) => new Promise((res) => setTimeout(() => { if (!destroyed) res(); }, ms));
  function tween(ms, fn) {
    return new Promise((res) => {
      const t0 = performance.now();
      const step = (now) => {
        if (destroyed) return;
        const k = Math.max(0, Math.min(1, (now - t0) / ms)); // a frame stamped before t0 must not go negative
        fn(k);
        if (k >= 1) res(); else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }
  const delayed = (ms, p) => wait(ms).then(p);
  let chain = Promise.resolve(), pending = 0;
  const enqueue = (fn) => {
    pending++;
    chain = chain.then(() => (destroyed ? null : fn())).catch((e) => console.error(e)).finally(() => { pending--; });
    return chain;
  };

  // ---- canvas + projection ---------------------------------------------------------------------------
  let W = 0, H = 0, dpr = 1;
  let bg = null; // the room behind the table, painted once per size (a bar at night: wall, neon sign, string lights)
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr));
    bg = paintRoom();
  }
  const BULBS = 11;
  const bulbAt = (i) => { const t = i / (BULBS - 1); return [W * (0.04 + 0.92 * t), H * 0.035 + Math.sin(t * Math.PI) * H * 0.07]; };
  function paintRoom() {
    if (!W || !H || typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const wall = g.createLinearGradient(0, 0, 0, H * 0.6); wall.addColorStop(0, '#1b0f2e'); wall.addColorStop(1, '#3a1f2c');
    g.fillStyle = wall; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,.04)'; g.lineWidth = 2;
    for (let x = 0; x < W; x += 26) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H * 0.6); g.stroke(); }
    // A neon sign on the back wall (blurred once here, never per frame).
    g.save(); g.font = `400 ${Math.round(W * 0.07)}px Bungee, system-ui, sans-serif`; g.textAlign = 'center';
    g.shadowColor = '#ff3d9a'; g.shadowBlur = 18; g.fillStyle = '#ffd1ec'; g.fillText('CUP PONG', W / 2, H * 0.17);
    g.shadowBlur = 6; g.fillText('CUP PONG', W / 2, H * 0.17); g.restore();
    // The string the lights hang on.
    g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1.5; g.beginPath();
    for (let i = 0; i < BULBS; i++) { const [x, y] = bulbAt(i); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke();
    // The floor glow under the table.
    const floor = g.createRadialGradient(W / 2, H * 0.95, 0, W / 2, H * 0.95, W * 0.8); floor.addColorStop(0, 'rgba(255,190,120,.25)'); floor.addColorStop(1, 'rgba(255,190,120,0)');
    g.fillStyle = floor; g.fillRect(0, 0, W, H);
    return c;
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  ro?.observe(canvas);
  resize();
  document.fonts?.load('400 20px Bungee').then(() => { if (!destroyed) bg = paintRoom(); }, () => {}); // the sign's font may arrive after the first paint
  function project(x, y, z) {
    const sp = Math.sin(CAM.pitch), cp = Math.cos(CAM.pitch);
    const Y = y - CAM.y, Z = z - CAM.z;
    const zc = Math.max(0.05, -Y * sp + Z * cp), yc = Y * cp + Z * sp;
    const F = (H * 0.5) / Math.tan((CAM.fov * Math.PI / 180) / 2);
    return [W / 2 + F * x / zc, H * CAM.hz - F * yc / zc, F / zc];
  }
  const ryOf = (x, y, z, r) => Math.abs(project(x, y, z + r)[1] - project(x, y, z)[1]) || 1;
  const grabRadius = (s) => Math.max(P.ballR * s * S.grab, 40);

  // ---- HUD / messages ----------------------------------------------------------------------------------
  function updateHud() {
    $('[data-sc="you"]').textContent = vs.scores[seat];
    $('[data-sc="rival"]').textContent = vs.scores[1 - seat];
    $('.cp-round-txt').textContent = `ROUND ${Math.min(vs.round, RULES.rounds)}/${RULES.rounds}`;
    [...$('.cp-dots').children].forEach((d, i) => d.classList.toggle('used', i < vs.ballsUsed));
    $('[data-card="you"]').classList.toggle('active', vs.started && !vs.over && vs.turn === seat);
    $('[data-card="rival"]').classList.toggle('active', vs.started && !vs.over && vs.turn === 1 - seat);
  }
  function bump(isMe) { const el = $(isMe ? '[data-sc="you"]' : '[data-sc="rival"]'); el.classList.add('bump'); setTimeout(() => el.classList.remove('bump'), 250); }
  async function msg(text, ms = 1100) {
    const m = $('.cp-msg'); m.classList.remove('show'); void m.offsetWidth; m.textContent = text; m.classList.add('show');
    await wait(ms);
  }
  const show = (sel, on) => $(sel).classList.toggle('hidden', !on);
  function notice(text) { $('.cp-notice').textContent = text || ''; show('.cp-notice', !!text); }

  // ---- rack animations ----------------------------------------------------------------------------------
  async function rackOut(rack) {
    await Promise.all(rack.filter((c) => c.alive).map((c, i) => delayed(i * 35, () => tween(320, (k) => { c.sc = 1 - ease.inOut(k); c.lift = 0.1 * ease.inOut(k); }))));
  }
  async function rackIn(rack) {
    const live = rack.filter((c) => c.alive).sort((a, b) => b.z - a.z); // back row first
    live.forEach((c) => { c.sc = 0; c.lift = 0.14; });
    await Promise.all(live.map((c, i) => delayed(i * 45, () => tween(380, (k) => { c.sc = Math.min(1, ease.out(k) * 1.1); c.lift = 0.14 * (1 - ease.back(k)); }))));
    live.forEach((c) => { c.sc = 1; c.lift = 0; });
  }
  async function liftOutCup(c) {
    await tween(500, (k) => { c.lift = 0.16 * ease.out(k); c.sc = 1 - ease.inOut(k); });
    c.alive = false; c.lift = 0; c.sc = 1;
  }
  const poof = (x, y, z) => vs.fx.push({kind: 'poof', x, y, z, t0: performance.now()});
  const splash = (x, y, z) => {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2; const v = 0.3 + Math.random() * 0.6;
      vs.fx.push({kind: 'drop', x, y, z, vx: Math.cos(a) * v * 0.5, vy: 1 + Math.random() * 1.4, vz: Math.sin(a) * v * 0.5, t0: performance.now()});
    }
  };
  function confetti() { for (let i = 0; i < 60; i++) vs.fx.push({kind: 'conf', t0: performance.now(), vx: (Math.random() - 0.5) * 700, vy: -(200 + Math.random() * 500), x: W / 2, y: H * 0.35, hue: Math.random() * 360}); }

  // ---- drawing --------------------------------------------------------------------------------------------
  function drawCup(c, col) {
    const lift = c.lift, s0 = Math.max(0.001, c.sc);
    const [bx, by, s] = project(c.x, lift, c.z), [tx, ty] = project(c.x, lift + P.cupH * s0, c.z);
    const rt = P.cupRimR * s * s0, rb = rt * 0.68;
    const ryT = ryOf(c.x, lift + P.cupH * s0, c.z, P.cupRimR * s0), ryB = ryOf(c.x, lift, c.z, P.cupRimR * s0) * 0.68;
    if (lift < 0.01) { const sh = ctx.createRadialGradient(bx, by, 0, bx, by, rt * 1.5); sh.addColorStop(0, 'rgba(0,0,0,.33)'); sh.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = sh; ctx.beginPath(); ctx.ellipse(bx, by, rt * 1.5, ryB * 1.6, 0, 0, 7); ctx.fill(); }
    const g = ctx.createLinearGradient(tx - rt, 0, tx + rt, 0);
    g.addColorStop(0, col.a); g.addColorStop(0.35, col.b); g.addColorStop(0.75, col.c); g.addColorStop(1, col.d);
    ctx.beginPath(); ctx.moveTo(tx - rt, ty); ctx.lineTo(bx - rb, by); ctx.ellipse(bx, by, rb, ryB, 0, Math.PI, 0, true); ctx.lineTo(tx + rt, ty); ctx.ellipse(tx, ty, rt, ryT, 0, 0, Math.PI, true); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    const inner = ctx.createLinearGradient(0, ty - ryT, 0, ty + ryT); inner.addColorStop(0, col.in1); inner.addColorStop(1, col.in2);
    ctx.beginPath(); ctx.ellipse(tx, ty, rt, ryT, 0, 0, 7); ctx.fillStyle = inner; ctx.fill();
    ctx.lineWidth = Math.max(1.5, rt * 0.12); ctx.strokeStyle = col.rim; ctx.stroke();
  }
  function drawBall(pos, scale = 1) {
    const [sx, sy, s] = project(pos[0], pos[1], pos[2]), [shx, shy] = project(pos[0], 0, pos[2]);
    const r = Math.max(P.ballR * s * scale, 2.5), lift = Math.min(1, Math.max(0, (pos[1] - P.ballR) / 0.3));
    ctx.fillStyle = `rgba(0,0,0,${0.32 - 0.18 * lift})`; ctx.beginPath(); ctx.ellipse(shx, shy, r * (1 + 0.5 * lift), r * 0.4 * (1 + 0.5 * lift), 0, 0, 7); ctx.fill();
    const g = ctx.createRadialGradient(sx - r * 0.35, sy - r * 0.4, r * 0.1, sx, sy, r); g.addColorStop(0, '#ffffff'); g.addColorStop(0.6, '#eef0f3'); g.addColorStop(1, '#a9b1ba');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fill();
  }
  let swipe = null;
  function drawScene(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.clearRect(0, 0, W, H);
    if (bg) ctx.drawImage(bg, 0, 0, W, H); else { ctx.fillStyle = '#1b0f2e'; ctx.fillRect(0, 0, W, H); }
    // String lights: each bulb glows and gently flickers (plain circles, no blur).
    for (let i = 0; i < BULBS; i++) {
      const [x, y] = bulbAt(i);
      const a = 0.55 + 0.45 * Math.sin(now / 420 + i * 1.9);
      ctx.fillStyle = `rgba(255,200,90,${0.18 * a})`; ctx.beginPath(); ctx.arc(x, y + 6, 11, 0, 7); ctx.fill();
      ctx.fillStyle = i % 3 === 0 ? '#ff8fb8' : i % 3 === 1 ? '#ffd65a' : '#8fe3ff'; ctx.beginPath(); ctx.arc(x, y + 6, 4, 0, 7); ctx.fill();
    }
    const hw = P.tableHalfW, z0 = P.tableZ0, z1 = P.tableZ1;
    const tbl = [[-hw, 0, z0], [hw, 0, z0], [hw, 0, z1], [-hw, 0, z1]].map((q) => project(...q));
    // The table's front edge, so it reads as a solid slab of wood.
    const edge = [[-hw, 0, z0], [hw, 0, z0], [hw, -0.05, z0], [-hw, -0.05, z0]].map((q) => project(...q));
    ctx.beginPath(); edge.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fillStyle = '#4a2612'; ctx.fill();
    const tg = ctx.createLinearGradient(0, tbl[3][1], 0, tbl[0][1]); tg.addColorStop(0, '#6b3a1c'); tg.addColorStop(0.55, '#a5652f'); tg.addColorStop(1, '#c98a4a');
    ctx.beginPath(); tbl.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fillStyle = tg; ctx.fill();
    ctx.strokeStyle = 'rgba(60,25,8,.35)'; ctx.lineWidth = 1.2; // planks
    for (let k = 1; k < 6; k++) { const x = -hw + (2 * hw * k) / 6; const [ax, ay] = project(x, 0, z0); const [bx, by] = project(x, 0, z1); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); }
    const [m0x, m0y] = project(0, 0, z0); const [m1x, m1y] = project(0, 0, z1); // painted centre line
    ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 3; ctx.setLineDash([10, 10]); ctx.beginPath(); ctx.moveTo(m0x, m0y); ctx.lineTo(m1x, m1y); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); tbl.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.strokeStyle = '#fff3d6'; ctx.lineWidth = 4; ctx.stroke();
    if (vs.turn !== null && vs.started) {
      const col = colorsFor(1 - vs.turn);
      target().filter((c) => c.alive).sort((a, b) => b.z - a.z).forEach((c) => drawCup(c, col));
    }
    if (vs.flight) {
      // A fading trail behind the ball in flight.
      vs.flight.trail.forEach((q, i, all) => {
        const [tx, ty, ts] = project(...q);
        ctx.fillStyle = `rgba(255,240,200,${0.35 * (i + 1) / all.length})`;
        ctx.beginPath(); ctx.arc(tx, ty, Math.max(1.5, P.ballR * ts * (0.4 + 0.6 * (i + 1) / all.length)), 0, 7); ctx.fill();
      });
      drawBall(vs.flight.pos);
    }
    else if (vs.ballVisible && !vs.over) {
      const pos = [0, P.releaseH, 0]; drawBall(pos, vs.ballScale);
      if (vs.canThrow) {
        const [sx, sy, s] = project(...pos), gr = grabRadius(s);
        ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.arc(sx, sy, gr, 0, 7); ctx.stroke(); ctx.setLineDash([]);
        if (!vs.thrown && !swipe) { // a finger sliding up from the ball until the first throw
          const k = (now / 1400) % 1, e = ease.inOut(k), fy = sy - e * H * 0.22;
          ctx.fillStyle = `rgba(255,255,255,${0.65 * (1 - Math.abs(k - 0.5) * 1.4)})`; ctx.beginPath(); ctx.arc(sx, fy, 16, 0, 7); ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.setLineDash([3, 8]); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, fy); ctx.stroke(); ctx.setLineDash([]);
        }
        if (swipe) { // the power ring grows with the swipe
          const t = Math.min(1, Math.max(0, (swipe.len - S.minLen) / (S.maxLen - S.minLen)));
          ctx.strokeStyle = `hsl(${120 - 120 * t},85%,55%)`; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(sx, sy, gr * 0.5 + t * gr * 0.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.03, t)); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,224,80,.9)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(swipe.x0, swipe.y0); ctx.lineTo(swipe.x, swipe.y); ctx.stroke();
        }
      }
    }
    const life = (f) => (f.kind === 'poof' ? 500 : f.kind === 'drop' ? 700 : 1800);
    vs.fx = vs.fx.filter((f) => now - f.t0 < life(f));
    for (const f of vs.fx) {
      const k = (now - f.t0) / life(f);
      if (f.kind === 'drop') { // a drop of beer-pong water flying out of the cup
        const t = (now - f.t0) / 1000;
        const [dx, dy, ds] = project(f.x + f.vx * t, Math.max(0, f.y + f.vy * t - 4.9 * t * t), f.z + f.vz * t);
        ctx.fillStyle = `rgba(170,225,255,${1 - k})`; ctx.beginPath(); ctx.arc(dx, dy, Math.max(1.5, 0.006 * ds), 0, 7); ctx.fill();
        continue;
      }
      if (f.kind === 'poof') { const [px, py, ps] = project(f.x, f.y, f.z); ctx.strokeStyle = `rgba(255,255,255,${1 - k})`; ctx.lineWidth = 4 * (1 - k) + 1; ctx.beginPath(); ctx.arc(px, py, P.ballR * ps * (1 + 4 * ease.out(k)), 0, 7); ctx.stroke(); }
      else { const t = (now - f.t0) / 1000; ctx.fillStyle = `hsla(${f.hue},85%,60%,${1 - k})`; ctx.fillRect(f.x + f.vx * t, f.y + f.vy * t + 900 * t * t, 7, 5); }
    }
    if (toast.text && now < toast.until) { ctx.fillStyle = '#fff'; ctx.font = 'bold 14px system-ui'; ctx.textAlign = 'center'; ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 4; ctx.fillText(toast.text, W / 2, H * 0.8); ctx.shadowBlur = 0; }
  }
  function frame(now) { if (destroyed) return; drawScene(now); raf = requestAnimationFrame(frame); }
  raf = requestAnimationFrame(frame);

  // ---- swipe input (length-based, with a time limit) ----------------------------------------------------------
  const onDown = (e) => {
    if (!vs.canThrow) return;
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const [bx, by, s] = project(0, P.releaseH, 0);
    if (Math.hypot(x - bx, y - by) > grabRadius(s)) { say('start the swipe on the ball'); return; }
    canvas.setPointerCapture(e.pointerId);
    swipe = {x0: x, y0: y, x, y, t0: e.timeStamp, len: 0, dead: false};
  };
  const onMove = (e) => {
    if (!swipe || swipe.dead) return;
    const r = canvas.getBoundingClientRect(); swipe.x = e.clientX - r.left; swipe.y = e.clientY - r.top;
    swipe.len = Math.hypot(swipe.x - swipe.x0, swipe.y - swipe.y0) / H;
    if (e.timeStamp - swipe.t0 > S.timeMs) { swipe.dead = true; say('too slow - swipe quicker'); return; }
    if (swipe.y > swipe.y0) return; // no backward swipes
    if (swipe.len >= S.maxLen) { const s = swipe; swipe = null; fire(s); } // reaching full length fires at once
  };
  const onUp = (e) => {
    if (!swipe) return;
    const s = swipe; swipe = null;
    if (s.dead) return;
    const r = canvas.getBoundingClientRect();
    s.x = e.clientX - r.left; s.y = e.clientY - r.top;
    s.len = Math.hypot(s.x - s.x0, s.y - s.y0) / H;
    if (e.timeStamp - s.t0 > S.timeMs) { say('too slow - swipe quicker'); return; }
    if (s.y >= s.y0) { say('swipe upward'); return; }
    if (s.len < S.minLen) { say('swipe longer'); return; }
    fire(s);
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', () => { swipe = null; });

  function fire(s) {
    if (!vs.canThrow) return;
    const dx = s.x - s.x0, dy = s.y - s.y0;
    let ang = Math.atan2(dx, -dy) * 57.29578;
    ang = Math.max(-S.angleRange, Math.min(S.angleRange, ang));
    ang = Math.round(ang / S.angleStep) * S.angleStep; // aim snaps into small steps
    const raw = {angleQ: Math.round(ang / S.angleRange * 127), powerQ: Math.round(255 * Math.min(1, Math.max(0, (s.len - S.minLen) / (S.maxLen - S.minLen))))};
    const sh = shapeThrow(raw, target(), P, A);
    vs.canThrow = false; vs.thrown = true;
    if (!match.throw(sh.angleQ, sh.powerQ)) { vs.canThrow = match.canThrow(); } // refused (not my turn after all)
  }

  // ---- what happens on screen ----------------------------------------------------------------------------------
  const readyToThrow = () => { vs.canThrow = !destroyed && !vs.over && pending <= 1 && match.canThrow(); };

  function showBall() {
    vs.ballVisible = true; vs.ballScale = 0;
    tween(250, (k) => { vs.ballScale = ease.back(k); });
  }
  async function beginTurn() {
    const rack = target();
    rack.forEach((c) => { c.sc = 0; c.lift = 0.14; });
    updateHud();
    await rackIn(rack);
    await msg(vs.turn === seat ? 'YOUR SHOT!' : "RIVAL'S SHOT", 900);
    showBall();
  }
  async function nextBall() {
    showBall(); updateHud();
    if (vs.turn === seat) await msg('YOUR SHOT!', 900);
  }

  async function handleThrow(ev) {
    vs.turn = ev.seat; vs.ballsUsed = ev.ballNo; vs.canThrow = false; vs.ballVisible = false; updateHud();
    const rack = vs.racks[1 - ev.seat];
    await playFlight(ev.sim);
    const f = ev.sim.frames, n = f.length - 3;
    play(throwScenario(ev, ev.seat === seat));
    if (ev.hit) {
      const c = rack[ev.cup];
      poof(c.x, P.cupH, c.z);
      splash(c.x, P.cupH, c.z);
      synth.splash();
      vs.scores = ev.after.scores; bump(ev.seat === seat); updateHud();
      await wait(400); await liftOutCup(c); await wait(500);
    } else {
      poof(f[n], Math.max(f[n + 1], P.ballR), f[n + 2]); // a miss ends with a pop
      await wait(450);
    }
    if (ev.after.phase === 'over') return endSequence(ev.after.over);
    if (ev.extra) {
      vs.ballsUsed = 0; updateHud();
      await msg('EXTRA TURN!', 1100); await nextBall();
    } else if (ev.switched) {
      await msg('TURN SWITCH', 900);
      await rackOut(rack);
      if (ev.roundAdvanced) vs.round = ev.after.round;
      vs.turn = ev.after.turn; vs.ballsUsed = 0;
      await beginTurn();
    } else {
      await wait(250); await nextBall();
    }
    readyToThrow();
  }

  function playFlight(sim) {
    const f = sim.frames, n = f.length / 3;
    // Frames where the ball touches the table and bounces back up: a click plays as it passes each one.
    const bounces = [];
    for (let i = 1; i < n - 1; i++) { const y = f[i * 3 + 1]; if (y < P.ballR * 1.6 && y <= f[(i - 1) * 3 + 1] && y < f[(i + 1) * 3 + 1]) bounces.push(i); }
    let nextBounce = 0;
    vs.flight = {pos: [0, P.releaseH, 0], trail: []};
    synth.whoosh(0.3);
    return tween(Math.max(300, (n - 1) / 60 * 1000), (k) => {
      const x = k * (n - 1), i = Math.min(n - 1, Math.floor(x)), j = Math.min(n - 1, i + 1), t = x - i;
      vs.flight.pos = [0, 1, 2].map((q) => f[i * 3 + q] + (f[j * 3 + q] - f[i * 3 + q]) * t);
      vs.flight.trail.push(vs.flight.pos); if (vs.flight.trail.length > 9) vs.flight.trail.shift();
      while (nextBounce < bounces.length && x >= bounces[nextBounce]) { nextBounce++; synth.blip(380); }
    }).then(() => { vs.flight = null; });
  }

  async function endSequence(over) {
    vs.over = true; vs.canThrow = false; vs.ballVisible = false; updateHud();
    play(matchEndScenario(over, seat));
    const w = over.winner;
    if (over.reason === 'cups') { confetti(); await msg('ALL CUPS!', 1400); }
    const title = w === null ? 'DRAW' : w === seat ? 'YOU WIN!' : `${rivalName} WINS`;
    $('.cp-end h2').textContent = title;
    $('.cp-end p').textContent = `${vs.scores[seat]} - ${vs.scores[1 - seat]} cups  (${over.reason === 'cups' ? 'cleared every cup' : RULES.rounds + ' rounds'})`;
    if (w === seat) confetti();
    await wait(300); show('.cp-end', true);
  }

  // ---- intro + first-turn spinner ---------------------------------------------------------------------------------
  const introMinDone = new Promise((res) => setTimeout(res, 2000));
  async function startSequence(snap) {
    await introMinDone;
    if (destroyed) return;
    show('.cp-intro', false); await wait(300);
    $('.cp-start').style.opacity = 1; await wait(900); $('.cp-start').style.opacity = 0;
    // the first-turn spinner: the needle lands on the player the coin flip chose
    const mineFirst = snap.first === seat;
    show('.cp-spin', true);
    const total = 3 * 360 + (mineFirst ? 0 : 180);
    await tween(2500, (k) => { $('.cp-needle').style.transform = `rotate(${total * ease.sineOut(k)}deg)`; });
    $(mineFirst ? '[data-who="you"]' : '[data-who="rival"]').classList.add('win');
    await wait(900); show('.cp-spin', false); await wait(400);
    vs.turn = snap.first; vs.started = true;
    await beginTurn();
    readyToThrow();
  }

  function setIntroText(t) { $('[data-intro-pill]').textContent = t; }
  function handleSnapshotPhase(snap) {
    if (snap.phase === 'incompatible' || snap.phase === 'desync') { vs.canThrow = false; notice(snap.error); setIntroText('...'); play('game.error'); return; }
    if (snap.phase === 'play' && !vs.started && !startedSeq) { startedSeq = true; setIntroText('STARTING...'); enqueue(() => startSequence(snap)); }
    else if (snap.phase === 'handshake' || snap.phase === 'flip') setIntroText('WAITING FOR YOUR FRIEND...');
  }
  let startedSeq = false;
  setTimeout(() => { if (!destroyed && !startedSeq && !vs.started) setIntroText('WAITING FOR YOUR FRIEND...'); }, 2100);

  return {
    onEvent(ev) {
      if (destroyed) return;
      if (ev.type === 'phase') handleSnapshotPhase(ev.snap);
      else if (ev.type === 'away') {
        notice(ev.away ? 'Your friend lost connection. Waiting for them to come back...' : '');
        if (!ev.away) enqueue(async () => readyToThrow());
      } else if (ev.type === 'throw') enqueue(() => handleThrow(ev));
    },
    start(snap) { handleSnapshotPhase(snap); },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      root.remove();
    },
  };
}
