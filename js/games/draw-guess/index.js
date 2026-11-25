// Draw & Guess as a room game. One player draws a secret word on a shared canvas, the other types guesses.
// `createGame` is the classic mode; blind.js reuses `mountGame` with mode 'blind' (the drawer cannot see
// their own lines until the round is over). Rules and messages: rules.js, match.js.

import {bake} from '../../bake.js';
import {loadCss} from '../../load-css.js';
import {DrawGuessMatch} from './match.js';
import {CANVAS, MAX_GUESS_LEN, WIDTHS} from './rules.js';
import {burstAt, celebrate, floatText, vibrate} from '../../fx.js';
import {play} from '../../sound.js';
import {synth} from '../../synth.js';
import {arrive, countTo, enter, fitText, gsap, pop, quake, resultSound, stamp, titleCard} from '../../juice.js';

// Stroke colours are indexes on the wire; each side paints them with its own design tokens.
const COLOR_VARS = ['--ink', '--seat-a', '--seat-b', '--good', '--gold-hot', '--paper'];
const COLOR_NAMES = ['Ink', 'Red', 'Blue', 'Green', 'Gold', 'Eraser'];
const SIZE_NAMES = ['Thin', 'Medium', 'Thick'];

const TEMPLATE = `
<div class="dg sketch">
  <div class="dg-hud">
    <div class="dg-tag me"><span class="dg-pencil" aria-hidden="true">✏️</span><b class="dg-name dg-name-me"></b><span class="dg-score dg-score-me">0</span></div>
    <div class="dg-roundbox"><span class="dg-round"></span></div>
    <div class="dg-tag them"><span class="dg-pencil" aria-hidden="true">✏️</span><b class="dg-name dg-name-them"></b><span class="dg-score dg-score-them">0</span></div>
  </div>
  <div class="dg-timer"><div class="dg-bar"><i></i></div><span class="dg-left"></span></div>
  <p class="dg-status" aria-live="polite"></p>
  <p class="dg-error" hidden></p>
  <div class="dg-word" aria-live="polite"></div>
  <div class="dg-choose" hidden></div>
  <div class="dg-thinking" hidden><span>✏️</span><span>💭</span></div>
  <div class="dg-stage">
    <div class="dg-rings" aria-hidden="true"></div>
    <canvas class="dg-canvas" aria-label="Drawing canvas"></canvas>
    <div class="dg-pen" hidden></div>
    <div class="dg-blind" hidden><span>🙈 Blindfold on</span><small>Your lines are invisible to you. Trust your hand.</small></div>
  </div>
  <div class="dg-tools" hidden>
    <div class="dg-colors" role="group" aria-label="Colour"></div>
    <div class="dg-sizes" role="group" aria-label="Brush size"></div>
    <div class="dg-actions">
      <button type="button" class="dg-undo">Undo</button>
      <button type="button" class="dg-clear">Clear</button>
      <button type="button" class="dg-skip">Skip word</button>
    </div>
  </div>
  <form class="dg-guess" hidden>
    <input class="dg-input" type="text" maxlength="${MAX_GUESS_LEN}" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Your guess" aria-label="Your guess">
    <button class="primary" type="submit">Guess</button>
  </form>
  <ul class="dg-feed" aria-label="Guesses"></ul>
  <button class="dg-next" hidden>Next round</button>
</div>`;

export function createGame(args) { return mountGame({...args, mode: 'classic'}); }

export async function mountGame({session, container, mode}) {
  await loadCss(new URL('../board.css', import.meta.url));
  await loadCss(new URL('./draw-guess.css', import.meta.url));
  container.innerHTML = TEMPLATE;
  const unbake = bake(container.querySelector('.dg')); // paint the rich backgrounds once (js/bake.js)
  const $ = (s) => container.querySelector(s);
  const canvas = $('.dg-canvas');
  const ctx = canvas.getContext('2d');
  const pen = $('.dg-pen');
  let destroyed = false;
  let color = 0;
  let width = 1;
  let last = null;          // the latest snapshot
  let paintedRev = -1;      // the canvasRev the pixels belong to
  let paintedHidden = null;
  let drawn = [];           // how many numbers of each stroke are already on the canvas
  let colors = [];          // resolved CSS colours, refreshed on every full repaint
  let shownRound = 0;
  let prev = null;          // the snapshot before `last`, to spot what just happened

  const readColors = () => {
    const style = getComputedStyle(container);
    colors = COLOR_VARS.map((v) => style.getPropertyValue(v).trim() || '#000');
  };

  // --- painting -----------------------------------------------------------------------------
  const scale = () => canvas.width / CANVAS;

  function paintStroke(stroke, from) {
    const p = stroke.p;
    if (!p.length) return;
    const s = scale();
    ctx.strokeStyle = ctx.fillStyle = colors[stroke.c] ?? '#000';
    ctx.lineWidth = WIDTHS[stroke.w] * s;
    ctx.lineCap = ctx.lineJoin = 'round';
    if (p.length === 2) {
      ctx.beginPath();
      ctx.arc(p[0] * s, p[1] * s, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const start = Math.max(0, from - 2); // begin one point back so the new piece joins the old
    ctx.beginPath();
    ctx.moveTo(p[start] * s, p[start + 1] * s);
    for (let i = start + 2; i < p.length; i += 2) ctx.lineTo(p[i] * s, p[i + 1] * s);
    ctx.stroke();
  }

  function repaint(snap, hidden) {
    readColors();
    ctx.fillStyle = colors[5];
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Ruled sketchbook paper: faint blue lines and a red margin.
    const sc = scale();
    ctx.lineWidth = Math.max(1, 2 * sc);
    ctx.strokeStyle = 'rgba(80, 140, 230, .22)';
    ctx.beginPath();
    for (let y = 70; y < CANVAS; y += 70) { ctx.moveTo(0, y * sc); ctx.lineTo(canvas.width, y * sc); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(235, 80, 90, .3)';
    ctx.beginPath(); ctx.moveTo(90 * sc, 0); ctx.lineTo(90 * sc, canvas.height); ctx.stroke();
    drawn = [];
    if (!hidden) snap.strokes.forEach((st, i) => { paintStroke(st, 0); drawn[i] = st.p.length; });
    paintedRev = snap.canvasRev;
    paintedHidden = hidden;
  }

  const isHidden = (s) => s.mode === 'blind' && s.iDraw && s.phase === 'drawing';

  function paint(snap) {
    const hidden = isHidden(snap);
    if (snap.canvasRev !== paintedRev || hidden !== paintedHidden) { repaint(snap, hidden); return; }
    if (hidden) return;
    snap.strokes.forEach((st, i) => {
      if ((drawn[i] ?? 0) < st.p.length) { paintStroke(st, drawn[i] ?? 0); drawn[i] = st.p.length; }
    });
  }

  function fit() {
    const size = Math.max(200, Math.round(canvas.clientWidth * (window.devicePixelRatio || 1)));
    if (canvas.width !== size) { canvas.width = canvas.height = size; if (last) { paintedRev = -1; paint(last); } }
  }
  const resizer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  resizer?.observe(canvas);

  // --- drawing with the pointer (drawer) ----------------------------------------------------
  const toCanvas = (e) => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * CANVAS, ((e.clientY - r.top) / r.height) * CANVAS];
  };
  const movePen = (e) => {
    const r = $('.dg-stage').getBoundingClientRect();
    pen.style.left = `${e.clientX - r.left}px`;
    pen.style.top = `${e.clientY - r.top}px`;
    pen.style.width = pen.style.height = `${(WIDTHS[width] / CANVAS) * r.width}px`;
    pen.hidden = false;
  };
  let down = false;
  canvas.addEventListener('pointerdown', (e) => {
    if (!last || !last.iDraw || last.phase !== 'drawing') return;
    e.preventDefault();
    try { canvas.setPointerCapture?.(e.pointerId); } catch { /* the pointer already ended: still draw this stroke */ }
    down = true;
    const [x, y] = toCanvas(e);
    match.beginStroke(color, width, x, y);
    if (last.mode === 'blind') movePen(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!down) return;
    e.preventDefault();
    const coalesced = e.getCoalescedEvents?.() ?? [];
    for (const ev of coalesced.length ? coalesced : [e]) {
      const [x, y] = toCanvas(ev);
      match.extendStroke(x, y);
    }
    if (last.mode === 'blind') movePen(e);
    paint(last);
  });
  const lift = () => { if (!down) return; down = false; pen.hidden = true; match.endStroke(); };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);

  // --- tools --------------------------------------------------------------------------------
  const colorsEl = $('.dg-colors');
  COLOR_VARS.forEach((v, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dg-color';
    b.style.setProperty('--swatch', `var(${v})`);
    b.setAttribute('aria-label', COLOR_NAMES[i]);
    b.textContent = i === 5 ? '🧽' : '';
    b.addEventListener('click', () => { color = i; syncTools(); });
    colorsEl.append(b);
  });
  const sizesEl = $('.dg-sizes');
  WIDTHS.forEach((w, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dg-size';
    b.setAttribute('aria-label', SIZE_NAMES[i]);
    b.innerHTML = `<i style="width:${6 + i * 5}px;height:${6 + i * 5}px"></i>`;
    b.addEventListener('click', () => { width = i; syncTools(); });
    sizesEl.append(b);
  });
  function syncTools() {
    [...colorsEl.children].forEach((b, i) => b.classList.toggle('on', i === color));
    [...sizesEl.children].forEach((b, i) => b.classList.toggle('on', i === width));
  }
  syncTools();
  $('.dg-undo').addEventListener('click', () => match.undo());
  $('.dg-clear').addEventListener('click', () => match.clear());
  $('.dg-skip').addEventListener('click', () => match.skip());
  $('.dg-next').addEventListener('click', () => match.next());

  const input = $('.dg-input');
  $('.dg-guess').addEventListener('submit', (e) => {
    e.preventDefault();
    if (match.guess(input.value)) input.value = '';
    input.focus();
  });

  // --- the rest of the screen ---------------------------------------------------------------
  function renderWord(s) {
    const el = $('.dg-word');
    el.replaceChildren();
    if (s.phase === 'choosing') return;
    const showFull = s.word && (s.iDraw || s.phase === 'roundover');
    if (showFull && s.iDraw && s.phase === 'drawing') {
      el.className = 'dg-word mine';
      el.textContent = `Draw: ${s.word}`;
      return;
    }
    el.className = 'dg-word';
    const letters = showFull ? s.word.replace(/ /g, '') : null;
    let k = 0;
    s.shape.forEach((len, wi) => {
      const group = document.createElement('span');
      group.className = 'dg-group';
      for (let i = 0; i < len; i++, k++) {
        const slot = document.createElement('span');
        const ch = letters ? letters[k] : s.hints[k];
        slot.className = `dg-letter${ch && !letters ? ' hint' : ''}`;
        slot.textContent = ch ?? '';
        group.append(slot);
      }
      el.append(group);
      if (wi < s.shape.length - 1) el.append(' ');
    });
  }

  let feedKey = '';
  function renderFeed(s) {
    const feed = $('.dg-feed');
    const list = [...s.guesses].reverse().slice(0, 5);
    const key = `${s.round}|${list.map((g) => `${g.text}:${g.ok}:${g.close}`).join(',')}`;
    if (key === feedKey) return;
    const before = feedKey.split('|')[0] === String(s.round) ? s.guesses.length - list.length : -1;
    const oldCount = feed.childElementCount;
    feedKey = key;
    feed.replaceChildren();
    list.forEach((g, i) => {
      const li = document.createElement('li');
      const who = s.iDraw ? s.opponentName : 'You';
      li.className = g.ok === true ? 'ok' : g.ok === false ? (g.close ? 'close' : 'no') : 'wait';
      li.innerHTML = '<b></b><span></span><em></em>';
      li.querySelector('b').textContent = who;
      li.querySelector('span').textContent = g.text;
      li.querySelector('em').textContent = g.ok === true ? '✓' : g.ok === false ? (g.close ? 'so close!' : '✗') : '…';
      feed.append(li);
      if (i === 0 && (s.guesses.length > oldCount || before < 0)) {
        enter(li, {y: 14, scale: 0.8});
        if (g.ok === false && !g.close) gsap.fromTo(li, {x: -8}, {x: 0, duration: 0.4, ease: 'elastic.out(1.2, .3)', delay: 0.05});
      }
    });
  }

  function statusText(s) {
    const me = s.seat;
    if (s.phase === 'choosing') return s.iDraw ? 'Pick a word to draw' : `${s.opponentName} is picking a word…`;
    if (s.phase === 'drawing') {
      if (s.iDraw) return s.mode === 'blind' ? 'Draw it blind! 🙈' : 'Draw it!';
      return 'What is it?';
    }
    const base = s.reason === 'solved'
      ? (s.iDraw ? `${s.opponentName} got it! 🎉` : `You got it! 🎉 +${s.points}`)
      : s.reason === 'skip' ? 'Word skipped' : 'Time’s up ⏰';
    if (!s.finished) return base;
    const [a, b] = [s.scores[me], s.scores[1 - me]];
    return `${base} ${a === b ? 'Match drawn.' : a > b ? 'You win the match! 🎉' : 'Match lost.'}`;
  }

  function render(s) {
    prev = last;
    last = s;
    if (s.round !== shownRound) { shownRound = s.round; input.value = ''; }
    const me = s.seat;

    $('.dg-tag.me').dataset.seat = String(me);
    $('.dg-tag.them').dataset.seat = String(1 - me);
    $('.dg-name-me').textContent = s.names[me];
    $('.dg-name-them').textContent = s.opponentName;
    countTo($('.dg-score-me'), s.scores[me]);
    countTo($('.dg-score-them'), s.scores[1 - me]);
    $('.dg-tag.me').classList.toggle('active', s.iDraw);
    $('.dg-tag.them').classList.toggle('active', !s.iDraw);

    $('.dg-round').textContent = `Round ${s.round}/${s.rounds}${s.mode === 'blind' ? ' · blind' : ''}`;
    const status = $('.dg-status');
    status.className = 'dg-status';
    status.textContent = statusText(s);
    if (s.phase === 'roundover') status.classList.add(s.reason === 'solved' ? 'win' : 'lose');
    const err = $('.dg-error');
    err.hidden = !s.error;
    err.textContent = s.error ?? '';

    renderWord(s);
    const choose = $('.dg-choose');
    choose.hidden = !(s.phase === 'choosing' && s.iDraw);
    if (!choose.hidden && choose.dataset.round !== String(s.round)) {
      choose.dataset.round = String(s.round);
      choose.replaceChildren();
      s.choices.forEach((word, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'dg-card';
        b.innerHTML = '<small></small><span></span>';
        b.querySelector('small').textContent = ['Easy pick', 'Try this', 'Or this'][i] ?? '';
        b.querySelector('span').textContent = word;
        b.addEventListener('click', () => {
          synth.whoosh(0.25);
          gsap.to(b, {y: -30, scale: 1.12, rotate: 0, duration: 0.25, ease: 'power2.out'});
          gsap.to([...choose.children].filter((c) => c !== b), {opacity: 0, y: 30, duration: 0.2});
          setTimeout(() => { if (!destroyed) match.chooseWord(word); }, 230);
        });
        choose.append(b);
      });
      fitText(choose.querySelectorAll('.dg-card span'));
      arrive(choose.children, {y: 120, rotate: (i) => (i - 1) * 18, opacity: 0, duration: 0.55, ease: 'back.out(1.5)', stagger: 0.1, delay: 0.25});
      [0, 1, 2].forEach((i) => setTimeout(() => synth.blip(500 + i * 120), 250 + i * 100));
    }
    $('.dg-thinking').hidden = !(s.phase === 'choosing' && !s.iDraw);

    $('.dg-stage').hidden = s.phase === 'choosing';
    $('.dg-blind').hidden = !isHidden(s);
    $('.dg-tools').hidden = !(s.iDraw && s.phase === 'drawing');
    $('.dg-guess').hidden = !(!s.iDraw && s.phase === 'drawing');
    $('.dg-undo').disabled = $('.dg-clear').disabled = !s.strokes.length;
    renderFeed(s);
    $('.dg-next').hidden = !(s.phase === 'roundover' && !s.finished && !s.readyMine);
    if (s.phase === 'roundover' && !s.finished && s.readyMine) status.textContent += ' Waiting for your friend…';
    if (!destroyed) fit();
    paint(s);
    effects(s);
    tick();
  }

  let stampEl = null;
  let introDone = false;
  function effects(s) {
    // A new round: clear the old stamp and show the round card.
    if (!prev || prev.round !== s.round) {
      stampEl?.remove(); stampEl = null;
      if (s.phase === 'choosing' && introDone) {
        titleCard(container.querySelector('.dg'), {kicker: `Round ${s.round} of ${s.rounds}`, title: s.iDraw ? 'You draw!' : `${s.opponentName} draws`,
          sub: s.iDraw ? (s.mode === 'blind' ? 'Blindfold on. Pick a word.' : 'Pick a word') : 'Get guessing', theme: 'marker', hold: 0.7});
        synth.whoosh();
      }
      return;
    }
    const wasOpen = prev.phase !== 'roundover';
    if (s.phase === 'drawing' && prev.phase === 'choosing') {
      enter(container.querySelectorAll('.dg-word .dg-letter, .dg-word.mine'), {y: -16, stagger: 0.04});
      enter($('.dg-stage'), {y: 30, scale: 0.96});
    }
    if (s.phase === 'roundover' && wasOpen) {
      // Flip the letters of the answer in, one by one.
      arrive(container.querySelectorAll('.dg-word .dg-letter'), {rotateX: -90, opacity: 0, duration: 0.4, ease: 'back.out(2)', stagger: 0.06});
      const stageEl = $('.dg-stage');
      if (s.reason === 'solved') {
        stampEl = stamp(stageEl, 'Correct!', {rotate: -10});
        burstAt(canvas, 'good');
        floatText(canvas, `+${s.iDraw ? Math.round(s.points / 2) : s.points}`, {color: '#ffd23f', size: 30});
        vibrate('good');
        synth.arpeggio(true);
        if (!s.finished) play(s.iDraw ? 'dg.friend_right' : 'dg.right_mine');
      } else {
        stampEl = stamp(stageEl, s.reason === 'skip' ? 'Skipped' : 'Time’s up!', {cls: 'bad', rotate: 8});
        vibrate('bad');
        synth.arpeggio(false);
        if (!s.finished) play('dg.time_up');
      }
      if (s.finished) setTimeout(() => finale(s), 1500);
    } else if (!s.iDraw && s.guesses.length === prev.guesses.length && s.guesses.some((g, i) => g.close && !prev.guesses[i]?.close)) {
      floatText($('.dg-input'), 'so close!', {color: '#ffd23f', size: 20});
      synth.blip(880);
    } else if (s.guesses.length > prev.guesses.length) {
      synth.blip(600);
    } else if (!s.iDraw && s.guesses.some((g, i) => g.ok === false && !g.close && prev.guesses[i]?.ok == null)) {
      synth.beep(170, 0.14, 0.08);
      quake($('.dg-guess'), 0.4);
    }
    if (s.hints.filter(Boolean).length > prev.hints.filter(Boolean).length) {
      const k = s.hints.findIndex((h, i) => h && !prev.hints[i]);
      pop(container.querySelectorAll('.dg-word .dg-letter')[k], {scale: 1.8});
      synth.ping(1500);
    }
  }

  function finale(s) {
    if (destroyed) return;
    const [a, b] = [s.scores[s.seat], s.scores[1 - s.seat]];
    const won = a > b;
    resultSound(a, b);
    if (won) celebrate();
    titleCard(container.querySelector('.dg'), {kicker: a === b ? 'Too close to call' : won ? 'Best artist in the room' : `${s.opponentName} takes the gallery`,
      title: a === b ? 'Draw!' : won ? 'You win!' : 'Nice try!', sub: `${a} – ${b}`, theme: 'marker', hold: 1.8});
  }

  // The countdown: the drawer's clock is the real one; this is each side's own view of it.
  const bar = $('.dg-bar > i');
  function tick() {
    if (!last) return;
    const live = last.phase === 'drawing' && last.deadline;
    const left = live ? Math.max(0, last.deadline - Date.now()) : 0;
    $('.dg-left').textContent = live ? `${Math.ceil(left / 1000)}s` : '';
    bar.style.transform = `scaleX(${live ? left / last.durationMs : 0})`;
    $('.dg-timer').classList.toggle('low', live && left < 10_000);
    $('.dg-timer').hidden = !live;
    const secs = Math.ceil(left / 1000);
    if (live && left < 10_000 && secs !== lastSec) { lastSec = secs; synth.click(); pop($('.dg-left'), {scale: 1.4}); }
  }
  let lastSec = -1;
  const timer = setInterval(tick, 250);

  // A little pencil scratch while drawing.
  canvas.addEventListener('pointerdown', () => { synth.unlock(); if (last?.iDraw && last.phase === 'drawing') synth.whoosh(0.12); });

  const match = new DrawGuessMatch({session, mode, onChange: render});
  render(match.snapshot());
  fitText(container.querySelectorAll('.dg-name'));
  enter(container.querySelectorAll('.dg-hud > *'), {y: -14, stagger: 0.08});
  titleCard(container.querySelector('.dg'), {kicker: mode === 'blind' ? 'No peeking' : 'Sketch it, guess it', title: mode === 'blind' ? 'Blind Draw' : 'Draw & Guess',
    sub: `${last.rounds} rounds · take turns drawing`, theme: 'marker', hold: 1}).then(() => { introDone = true; });

  return {
    destroy() { unbake();
      destroyed = true;
      clearInterval(timer);
      resizer?.disconnect();
      match.destroy();
      container.replaceChildren();
    },
  };
}
