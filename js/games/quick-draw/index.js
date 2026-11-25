// Quick Draw as a room game: a western standoff. Wait for DRAW, tap faster than your friend, and never tap early.
// Rules and fairness: rules.js. Round flow and messages: match.js. The scene: scene.js and quick-draw.css.
// This file directs it like a film: letterbox bars close in, the camera cuts between the two cowboys' eyes and gun
// hands while a heartbeat speeds up, DRAW! snaps back to the wide shot, and the winning shot plays in slow motion
// with a tracer, a flying hat and dust. Sound is synthesized (js/synth.js); motion is GSAP (js/juice.js).

import {loadCss} from '../../load-css.js';
import {QuickDrawMatch} from './match.js';
import {COWBOY, sceneSVG, shot, viewBox} from './scene.js';
import {timeOfDay} from './rules.js';
import {celebrate, vibrate} from '../../fx.js';
import {play} from '../../sound.js';
import {synth} from '../../synth.js';
import {calm, enter, gsap, pop, pulse, quake, resultSound, titleCard} from '../../juice.js';

const TEMPLATE = `
<div class="qd">
  <div class="qd-hud">
    <div class="qd-poster me"><div class="qd-wanted">WANTED</div><div class="qd-name qd-name-me"></div><div class="qd-chambers qd-ch-me"></div></div>
    <div class="qd-mid"><span class="qd-vs">VS</span><span class="qd-round"></span></div>
    <div class="qd-poster them"><div class="qd-wanted">WANTED</div><div class="qd-name qd-name-them"></div><div class="qd-chambers qd-ch-them"></div></div>
  </div>
  <p class="qd-status" aria-live="polite"></p>
  <div class="qd-stage" data-time="0">
    ${sceneSVG()}
    <div class="qd-vignette"></div><div class="qd-grain"></div>
    <div class="qd-bar top"></div><div class="qd-bar bottom"></div>
    <div class="qd-banner" hidden></div>
    <div class="qd-white"></div>
    <svg class="qd-hole" viewBox="-50 -50 100 100" aria-hidden="true"><path d="M0 0 L-38 -20 M0 0 L30 -34 M0 0 L42 10 M0 0 L8 44 M0 0 L-30 30 M-20 -10 L-26 4 M16 -18 L28 -12"/><circle r="9"/></svg>
  </div>
  <p class="qd-times"></p>
  <button class="qd-fire" type="button" aria-label="Fire" disabled>FIRE!</button>
  <button class="qd-go" hidden></button>
</div>`;

const POSES = ['s-idle', 's-ready', 's-draw', 's-fire', 's-hit', 's-misfire', 's-win'];
const fmt = (r) => (!r ? '…' : r.early ? 'false start' : r.ms === null ? 'no shot' : `${r.ms} ms`);
// A lonely whistled tune (E minor), half speed, for the standoff.
const E4 = 329.6; const G4 = 392; const A4 = 440; const B4 = 493.9; const D5 = 587.3; const E5 = 659.3;
const TUNE = {steps: [E5, 0, 0, 0, B4, 0, 0, 0, E5, 0, D5, 0, B4, 0, 0, 0, A4, 0, 0, 0, G4, 0, A4, 0, E4, 0, 0, 0, 0, 0, 0, 0],
  bass: [E4 / 4, 0, 0, 0, E4 / 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bpm: 96, type: 'triangle', peak: 0.03};

export async function createGame({session, container}) {
  await loadCss(new URL('../board.css', import.meta.url));
  await loadCss(new URL('./quick-draw.css', import.meta.url));
  container.innerHTML = TEMPLATE;
  const $ = (s) => container.querySelector(s);
  const stage = $('.qd-stage');
  const svg = $('.qd-svg');
  const banner = $('.qd-banner');
  const cows = {left: $('.qd-cow.qd-left'), right: $('.qd-cow.qd-right')};
  let last = null;
  let prev = null;
  let raf = 0;
  let destroyed = false;
  let stopWind = null;
  let stopTune = null;
  let resolvedRound = 0;
  let director = null;       // the standoff camera timeline
  let heart = 0;             // heartbeat timer
  let goPulse = null;
  const fired = new Set();   // fake-outs already shown: "round:index"
  const timers = new Set();
  const tweens = new Set();
  const keep = (t) => { if (t) tweens.add(t); return t; };

  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!destroyed) fn(); }, ms); timers.add(id); };
  const pose = (side, name) => { cows[side].classList.remove(...POSES); cows[side].classList.add(name); };
  const startWind = () => { if (!stopWind) stopWind = synth.startWind(); };

  // --- camera ------------------------------------------------------------------------------
  let cam = shot('wide');
  svg.setAttribute('viewBox', viewBox(cam));
  /** Move the camera to a shot; duration 0 is a hard cut. */
  function camera(to, duration = 0.6, ease = 'power2.inOut') {
    const from = {x: cam[0], y: cam[1], w: cam[2]};
    if (calm() || duration === 0) { cam = to; svg.setAttribute('viewBox', viewBox(cam)); return null; }
    return keep(gsap.to(from, {x: to[0], y: to[1], w: to[2], duration, ease, onUpdate: () => { cam = [from.x, from.y, from.w]; svg.setAttribute('viewBox', viewBox(cam)); }}));
  }
  function letterbox(on) {
    keep(gsap.to(container.querySelectorAll('.qd-bar'), {scaleY: on ? 1 : 0, duration: on ? 0.8 : 0.3, ease: on ? 'power3.inOut' : 'power2.out'}));
    stage.classList.toggle('tense', on);
  }

  /** The standoff montage: push in, then cut between eyes and hands, round and round until DRAW. */
  function startDirector() {
    stopDirector();
    if (calm()) return;
    const squint = (on) => { cows.left.classList.toggle('squint', on); cows.right.classList.toggle('squint', on); };
    director = keep(gsap.timeline({repeat: -1, repeatDelay: 0}));
    director
      .add(() => camera(shot('push'), 1.4, 'sine.inOut'))
      .add(() => { camera(shot('eyes', 'left'), 0); squint(true); synth.click(); }, 1.5)
      .add(() => camera(shot('eyes', 'left').map((v, k) => (k === 2 ? v * 0.9 : v + (k === 0 ? 3 : 1.5))), 0.8, 'none'), 1.5)
      .add(() => { camera(shot('eyes', 'right'), 0); }, 2.4)
      .add(() => camera(shot('eyes', 'right').map((v, k) => (k === 2 ? v * 0.9 : v + (k === 0 ? 3 : 1.5))), 0.8, 'none'), 2.4)
      .add(() => { camera(shot('hand', 'left'), 0); squint(false); }, 3.3)
      .add(() => { camera(shot('hand', 'right'), 0); }, 3.9)
      .add(() => camera(shot('push'), 0), 4.5)
      .add(() => {}, 5.2);
  }
  function stopDirector() {
    director?.kill();
    director = null;
    cows.left.classList.remove('squint');
    cows.right.classList.remove('squint');
  }
  function startHeart() {
    stopHeart();
    const t0 = performance.now();
    const beat = () => {
      if (destroyed || last?.phase !== 'standoff') return;
      synth.thud();
      vibrate('tap');
      const gap = Math.max(380, 900 - (performance.now() - t0) * 0.09);
      heart = setTimeout(beat, gap);
    };
    heart = setTimeout(beat, 500);
  }
  function stopHeart() { clearTimeout(heart); heart = 0; }

  // --- controls ----------------------------------------------------------------------------
  const fire = () => { synth.unlock(); match.tap(performance.now()); };
  $('.qd-fire').addEventListener('pointerdown', (e) => { e.preventDefault(); fire(); });
  stage.addEventListener('pointerdown', (e) => { e.preventDefault(); fire(); });
  const onKey = (e) => {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.repeat) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!$('.qd-go').hidden) $('.qd-go').click(); else fire();
    }
  };
  window.addEventListener('keydown', onKey);
  $('.qd-go').addEventListener('click', () => {
    synth.unlock();
    startWind();
    if (last.phase === 'result') match.nextRound(); else match.ready();
  });

  // --- the show ----------------------------------------------------------------------------
  function frame(now) {
    if (destroyed) return;
    match.update(now);
    if (last?.phase === 'standoff') fakeouts(now);
    raf = requestAnimationFrame(frame);
  }

  function fakeouts(now) {
    last.fakeouts.forEach((f, i) => {
      const key = `${last.round}:${i}`;
      if (fired.has(key) || now - last.startAt < f.at) return;
      fired.add(key);
      if (f.kind === 'crow') {
        const crow = $('.qd-crow');
        crow.classList.remove('fly'); void crow.getBoundingClientRect(); crow.classList.add('fly');
        synth.ping(420);
      } else if (f.kind === 'gust') {
        const gust = $('.qd-gust');
        gust.classList.remove('go'); void gust.getBoundingClientRect(); gust.classList.add('go');
        synth.whoosh(0.8);
      } else {
        // The other cowboy's hand twitches: the camera jumps to it. A bluff.
        const cow = cows.right;
        cow.classList.add('twitch');
        camera(shot('hand', 'right'), 0);
        synth.click();
        later(() => cow.classList.remove('twitch'), 450);
      }
    });
  }

  function statusText(s) {
    const me = s.seat;
    const opp = s.opponentName;
    if (s.phase === 'waiting') return s.readyMine ? `Waiting for ${opp}…` : (s.round === 1 ? 'Step up to the line' : 'Another duel?');
    if (s.phase === 'standoff') return 'Hand on the holster…';
    if (s.phase === 'draw') return 'NOW!';
    if (s.phase === 'shot') return s.mine?.early ? 'Too soon, partner! 😬' : `Shot fired… waiting for ${opp}`;
    const l = s.last;
    let base;
    if (l.winner === 'draw') base = l.results.every((r) => r.early) ? 'Both jumped the gun! Replay.' : 'Nobody fired in time. Replay.';
    else if (l.results[l.winner === 0 ? 1 : 0].early) base = l.winner === me ? `${opp} jumped the gun!` : 'You jumped the gun!';
    else base = l.winner === me ? 'Fastest gun in the West!' : `${opp} was faster`;
    if (!s.finished) return base;
    const [a, b] = [s.scores[me], s.scores[1 - me]];
    return `${base} ${a === b ? 'Match drawn.' : a > b ? 'You win the match!' : 'Match lost.'}`;
  }

  function chambers(el, n, of) {
    if (el.childElementCount !== of) el.replaceChildren(...Array.from({length: of}, () => document.createElement('i')));
    [...el.children].forEach((c, k) => {
      if (k < n && !c.classList.contains('lit')) { c.classList.add('lit'); pop(c, {scale: 2}); }
      c.classList.toggle('lit', k < n);
    });
  }

  function render(s) {
    prev = last;
    last = s;
    const me = s.seat;
    $('.qd-poster.me').dataset.seat = cows.left.dataset.seat = String(me);
    $('.qd-poster.them').dataset.seat = cows.right.dataset.seat = String(1 - me);
    $('.qd-name-me').textContent = s.names[me];
    $('.qd-name-them').textContent = s.opponentName;
    chambers($('.qd-ch-me'), s.scores[me], s.toWin);
    chambers($('.qd-ch-them'), s.scores[1 - me], s.toWin);
    $('.qd-round').textContent = `Duel ${s.round}`;
    stage.dataset.time = String(timeOfDay(s.round));
    const status = $('.qd-status');
    status.className = 'qd-status';
    status.textContent = statusText(s);
    if (s.last && (s.phase === 'result' || s.phase === 'finished') && s.last.winner !== 'draw') status.classList.add(s.last.winner === me ? 'win' : 'lose');

    const go = $('.qd-go');
    const showGo = (s.phase === 'waiting' && !s.readyMine) || s.phase === 'result';
    go.hidden = !showGo;
    go.textContent = s.phase === 'result' ? 'Next duel' : 'Step up';
    if (showGo && !goPulse) goPulse = pulse(go, {scale: 1.04});
    if (!showGo && goPulse) { goPulse.kill(); goPulse = null; gsap.set(go, {clearProps: 'scale'}); }
    $('.qd-fire').disabled = !(s.phase === 'standoff' || s.phase === 'draw');
    $('.qd-fire').hidden = s.phase === 'result' || s.phase === 'finished';

    if (s.phase === 'waiting') {
      pose('left', 's-idle'); pose('right', 's-idle'); setBanner(null); $('.qd-times').textContent = '';
      if (prev && prev.phase !== 'waiting') reset();
    } else if (s.phase === 'standoff') { pose('left', 's-ready'); pose('right', 's-ready'); }
    else if (s.phase === 'shot') {
      if (s.mine?.early) { pose('left', 's-misfire'); setBanner('Too soon!', 'steady'); } else { pose('left', 's-draw'); }
    }
    if ((s.phase === 'result' || s.phase === 'finished') && s.last && s.last.round !== resolvedRound) { resolvedRound = s.last.round; resolve(s); }
    transitions(s);
  }

  function setBanner(text, cls = '') {
    banner.hidden = !text;
    banner.textContent = text ?? '';
    banner.className = `qd-banner ${cls}`;
  }

  /** Back to the wide shot with nothing on screen, ready for the next duel. */
  function reset() {
    stopDirector(); stopHeart(); stopTune?.(); stopTune = null;
    camera(shot('wide'), 0.8);
    letterbox(false);
    container.querySelectorAll('.qd-hat').forEach((h) => gsap.set(h, {clearProps: 'all'}));
    $('.qd-dust').replaceChildren();
  }

  /** Sounds, cuts and flashes for the moment the phase changes. */
  function transitions(s) {
    if (s.phase === 'standoff' && prev?.phase !== 'standoff') {
      fired.clear();
      synth.click(); later(() => synth.click(), 180);
      letterbox(true);
      setBanner('Steady…', 'steady');
      keep(gsap.fromTo(banner, {opacity: 0, y: 10}, {opacity: 1, y: 0, duration: 0.5}));
      later(() => { if (last.phase === 'standoff') keep(gsap.to(banner, {opacity: 0, duration: 0.5})); }, 1300);
      if (!stopTune) stopTune = synth.startLoop(TUNE);
      startDirector();
      startHeart();
    }
    if (s.phase === 'draw' && prev?.phase !== 'draw') {
      stopDirector(); stopHeart(); stopTune?.(); stopTune = null;
      camera(shot('wide'), 0);
      synth.whistle();
      vibrate('tap');
      gsap.set(banner, {opacity: 1});
      setBanner('DRAW!', 'draw');
      keep(gsap.fromTo(banner, {scale: 2.6, rotate: -8}, {scale: 1, rotate: -3, duration: 0.3, ease: 'back.out(3)'}));
      keep(gsap.fromTo($('.qd-white'), {opacity: 0.9}, {opacity: 0, duration: 0.3}));
      quake(stage, 0.5);
    }
    if (s.phase === 'shot' && prev?.phase !== 'shot' && s.mine?.early) {
      stopDirector(); stopHeart();
      camera(shot('medium', 'left'), 0.25, 'power3.out');
      synth.click(); later(() => synth.click(), 140); vibrate('bad');
      gsap.set(banner, {opacity: 1});
      keep(gsap.fromTo(banner, {x: -10}, {x: 0, duration: 0.4, ease: 'elastic.out(1.2, .3)'}));
    }
  }

  /** Play out the result: the faster cowboy fires, time slows, the other one falls and loses his hat. */
  function resolve(s) {
    stopDirector(); stopHeart(); stopTune?.(); stopTune = null;
    const l = s.last;
    const me = s.seat;
    const mine = l.results[me];
    const theirs = l.results[1 - me];
    $('.qd-times').innerHTML = `You <b>${fmt(mine)}</b> · ${escapeHtml(s.opponentName)} <b>${fmt(theirs)}</b>`;
    enter($('.qd-times'), {y: 8});
    setBanner(null);
    letterbox(false);
    if (l.winner === 'draw') {
      pose('left', 's-idle'); pose('right', 's-idle');
      camera(shot('wide'), 0.5);
      if (s.finished) later(() => finale(s), 900); // the last duel can end level
      return;
    }
    const winSide = l.winner === me ? 'left' : 'right';
    const loseSide = winSide === 'left' ? 'right' : 'left';
    const iWon = l.winner === me;
    camera(shot('wide'), 0);
    pose(winSide, 's-fire');
    synth.gunshot();
    quake(stage, 1);
    tracer(winSide, loseSide);
    keep(gsap.fromTo($('.qd-white'), {opacity: 0.7}, {opacity: 0, duration: 0.25}));
    // Slow motion: the camera eases in on the one who is hit while he falls.
    if (!calm()) {
      later(() => camera(shot('down', loseSide), 1.1, 'power2.out'), 160);
      later(() => camera(shot('wide'), 0.8, 'power2.inOut'), 1700);
    }
    later(() => {
      pose(loseSide, 's-hit');
      synth.thud();
      hatFlies(loseSide);
      dust(loseSide);
      vibrate(iWon ? 'win' : 'loss');
      if (!iWon) bulletHole();
    }, 140);
    later(() => pose(winSide, 's-win'), 1100);
    later(() => {
      if (s.finished) finale(s);
      else play(iWon ? 'qd.round_won' : 'qd.round_lost');
    }, 1400);
  }

  function tracer(from, to) {
    const t = $('.qd-tracer');
    const dir = from === 'left' ? 1 : -1;
    const x1 = COWBOY[from].x + dir * 62; const y1 = COWBOY[from].y - 70;
    const x2 = COWBOY[to].x - dir * 4; const y2 = COWBOY[to].y - 56;
    t.setAttribute('d', `M${x1} ${y1} L${x2} ${y2}`);
    const len = Math.hypot(x2 - x1, y2 - y1);
    keep(gsap.fromTo(t, {opacity: 1, strokeDasharray: `${len * 0.35} ${len}`, strokeDashoffset: len * 0.35}, {strokeDashoffset: -len, duration: 0.18, ease: 'none',
      onComplete: () => gsap.set(t, {opacity: 0})}));
  }

  function hatFlies(side) {
    const hat = cows[side].querySelector('.qd-hat');
    if (calm()) { gsap.set(hat, {opacity: 0}); return; }
    keep(gsap.timeline()
      .to(hat, {y: -46, duration: 0.45, ease: 'power2.out'}, 0)
      .to(hat, {x: -38, rotation: -320, duration: 1.1, ease: 'none'}, 0)
      .to(hat, {y: 62, duration: 0.65, ease: 'bounce.out'}, 0.45));
  }

  function dust(side) {
    const g = $('.qd-dust');
    const {x, y} = COWBOY[side];
    const ns = 'http://www.w3.org/2000/svg';
    for (let k = 0; k < 14; k++) {
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', String(x + (side === 'left' ? -20 : 20)));
      c.setAttribute('cy', String(y - 2));
      c.setAttribute('r', String(3 + Math.random() * 4));
      g.append(c);
      keep(gsap.to(c, {attr: {cx: x + (Math.random() - 0.5) * 90, cy: y - 4 - Math.random() * 26, r: 7 + Math.random() * 7}, opacity: 0,
        duration: 0.9 + Math.random() * 0.6, ease: 'power2.out', delay: 0.5 + Math.random() * 0.2, onComplete: () => c.remove()}));
    }
  }

  function bulletHole() {
    const hole = $('.qd-hole');
    hole.style.left = `${20 + Math.random() * 40}%`;
    hole.style.top = `${10 + Math.random() * 30}%`;
    keep(gsap.timeline()
      .fromTo(hole, {opacity: 1, scale: 1.4, rotate: Math.random() * 90}, {scale: 1, duration: 0.12, ease: 'power4.out'})
      .to(hole, {opacity: 0, duration: 0.6, delay: 1.4}));
  }

  function finale(s) {
    const [a, b] = [s.scores[s.seat], s.scores[1 - s.seat]];
    const won = a > b;
    resultSound(a, b);
    synth.arpeggio(won);
    if (won) celebrate();
    keep(titleCard(stage, {kicker: won ? 'The town is yours' : a === b ? 'Nobody blinked' : `${s.opponentName} rides off`, title: won ? 'Sheriff!' : a === b ? 'Stand-off' : 'Outdrawn',
      sub: `${a} – ${b}`, theme: 'western', hold: 1.8}));
  }

  stage.style.setProperty('--qd-noise', `url(${noiseTile()})`);
  const match = new QuickDrawMatch({session, onChange: render});
  render(match.snapshot());
  raf = requestAnimationFrame(frame);
  enter(container.querySelectorAll('.qd-poster, .qd-mid'), {y: -16, stagger: 0.1});
  keep(titleCard(stage, {kicker: 'High noon', title: 'Quick Draw', sub: `First to ${last.toWin} · wait for DRAW!`, theme: 'western', hold: 1}));

  return {
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      for (const id of timers) clearTimeout(id);
      timers.clear();
      stopDirector(); stopHeart();
      for (const t of tweens) t?.kill?.();
      gsap.killTweensOf(container.querySelectorAll('*'));
      stopWind?.();
      stopTune?.();
      window.removeEventListener('keydown', onKey);
      match.destroy();
      container.replaceChildren();
    },
  };
}

/** A 128px tile of film grain, made once per page. */
let noiseUrl = null;
function noiseTile() {
  if (noiseUrl) return noiseUrl;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const img = g.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  noiseUrl = c.toDataURL('image/png');
  return noiseUrl;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}
