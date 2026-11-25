// Emoji Charades as a room game. One player describes a secret phrase with emoji only, the other types guesses.
// Rules and messages: rules.js, match.js. The look is a little theatre: marquee name boards, phrase tickets, a
// curtained stage under a spotlight where each emoji drops in like an actor, applause when it is guessed.
// The word blanks, guess form and feed reuse Draw & Guess's base `dg-` pieces (draw-guess.css), themed here.

import {bake} from '../../bake.js';
import {loadCss} from '../../load-css.js';
import {EmojiCharadesMatch} from './match.js';
import {CATEGORIES} from './phrases.js';
import {MAX_SHOWN, TABS} from './emoji.js';
import {MAX_GUESS_LEN} from './rules.js';
import {burstAt, celebrate, floatText, vibrate} from '../../fx.js';
import {play} from '../../sound.js';
import {synth} from '../../synth.js';
import {arrive, calm, countTo, enter, fitText, gsap, pop, quake, resultSound, stamp, titleCard} from '../../juice.js';

const TEMPLATE = `
<div class="dg ec theatre">
  <div class="ec-hud">
    <div class="ec-marquee me"><b class="ec-name ec-name-me"></b><span class="ec-score ec-score-me">0</span><i class="ec-mic">🎤</i></div>
    <div class="ec-roundbox"><span class="dg-round"></span></div>
    <div class="ec-marquee them"><b class="ec-name ec-name-them"></b><span class="ec-score ec-score-them">0</span><i class="ec-mic">🎤</i></div>
  </div>
  <div class="dg-timer"><div class="dg-bar"><i></i></div><span class="dg-left"></span></div>
  <p class="dg-status" aria-live="polite"></p>
  <p class="dg-error" hidden></p>
  <p class="ec-rule"></p>
  <label class="ec-flag" hidden><input type="checkbox" class="ec-flag-box"> Fewer emoji = more points</label>
  <div class="dg-choose ec-choose" hidden></div>
  <div class="ec-waiting" hidden><span>🎭</span><small></small></div>
  <div class="ec-clue" hidden><span class="ec-cat"></span><div class="dg-word"></div></div>
  <div class="ec-stage" hidden>
    <div class="ec-spot"></div>
    <div class="ec-seq" aria-live="polite" aria-label="Emoji clue"></div>
    <div class="ec-floor"></div>
    <div class="ec-curtain left"></div><div class="ec-curtain right"></div>
    <div class="ec-valance"></div>
  </div>
  <div class="ec-used"></div>
  <div class="ec-pad" hidden>
    <div class="ec-tabs" role="tablist"></div>
    <div class="ec-grid"></div>
    <div class="dg-actions">
      <button type="button" class="ec-back">⌫ Undo</button>
      <button type="button" class="ec-clear">Clear</button>
      <button type="button" class="dg-skip">Skip phrase</button>
    </div>
  </div>
  <form class="dg-guess" hidden>
    <input class="dg-input" type="text" maxlength="${MAX_GUESS_LEN}" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Your guess" aria-label="Your guess">
    <button type="submit">Guess</button>
  </form>
  <ul class="dg-feed" aria-label="Guesses"></ul>
  <button class="dg-next" hidden>Next round</button>
</div>`;

export async function createGame({session, container}) {
  await loadCss(new URL('../draw-guess/draw-guess.css', import.meta.url));
  await loadCss(new URL('./emoji-charades.css', import.meta.url));
  container.innerHTML = TEMPLATE;
  const unbake = bake(container.querySelector('.ec'), container.querySelector('.ec-curtain.left'), container.querySelector('.ec-curtain.right')); // paint the rich backgrounds once (js/bake.js)
  const $ = (s) => container.querySelector(s);
  const root = $('.ec');
  let destroyed = false;
  let last = null;
  let prev = null;
  let tab = 0;
  let shownRound = 0;
  let shownSeq = [];
  let introDone = false;
  let stampEl = null;
  let lastSec = -1;
  let feedKey = '';
  let flyFrom = null;        // the key just tapped, so the new emoji can fly from it to the stage

  // --- palette ----------------------------------------------------------------------------
  const tabsEl = $('.ec-tabs');
  const grid = $('.ec-grid');
  TABS.forEach((t, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ec-tab';
    b.textContent = t.icon;
    b.setAttribute('aria-label', t.name);
    b.addEventListener('click', () => { tab = i; drawGrid(); synth.blip(420); });
    tabsEl.append(b);
  });
  function drawGrid() {
    [...tabsEl.children].forEach((b, i) => b.classList.toggle('on', i === tab));
    grid.replaceChildren();
    for (const e of TABS[tab].set) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ec-key';
      b.textContent = e;
      b.addEventListener('click', () => { synth.unlock(); flyFrom = b; pop(b, {scale: 0.8}); match.addEmoji(e); });
      grid.append(b);
    }
    if (introDone) enter(grid.children, {y: 8, scale: 0.6, stagger: 0.012, duration: 0.3});
  }
  drawGrid();

  $('.ec-back').addEventListener('click', () => { synth.zap(500); match.removeLast(); });
  $('.ec-clear').addEventListener('click', () => { synth.whoosh(0.3); match.clearEmoji(); });
  $('.dg-skip').addEventListener('click', () => match.skip());
  $('.dg-next').addEventListener('click', () => { synth.unlock(); match.next(); });
  $('.ec-flag-box').addEventListener('change', (e) => match.setScoring(e.target.checked));
  const input = $('.dg-input');
  $('.dg-guess').addEventListener('submit', (e) => {
    e.preventDefault();
    synth.unlock();
    if (match.guess(input.value)) input.value = '';
    input.focus();
  });

  // --- the screen -------------------------------------------------------------------------
  function renderWord(s) {
    const el = $('.dg-word');
    el.replaceChildren();
    el.className = 'dg-word';
    if (s.phase === 'choosing') return;
    const full = s.phrase && (s.iDescribe || s.phase === 'roundover');
    if (full && s.iDescribe && s.phase === 'playing') {
      el.className = 'dg-word mine';
      el.textContent = s.phrase;
      return;
    }
    const letters = full ? s.phrase.replace(/ /g, '') : null;
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

  function renderFeed(s) {
    const feed = $('.dg-feed');
    const list = [...s.guesses].reverse().slice(0, 5);
    const key = `${s.round}|${list.map((g) => `${g.text}:${g.ok}:${g.close}`).join(',')}`;
    if (key === feedKey) return;
    const grew = feedKey.split('|')[0] !== String(s.round) || s.guesses.length > feed.childElementCount;
    feedKey = key;
    feed.replaceChildren();
    list.forEach((g, i) => {
      const li = document.createElement('li');
      li.className = g.ok === true ? 'ok' : g.ok === false ? (g.close ? 'close' : 'no') : 'wait';
      li.innerHTML = '<b></b><span></span><em></em>';
      li.querySelector('b').textContent = s.iDescribe ? s.opponentName : 'You';
      li.querySelector('span').textContent = g.text;
      li.querySelector('em').textContent = g.ok === true ? '✓' : g.ok === false ? (g.close ? 'so close!' : '✗') : '…';
      feed.append(li);
      if (i === 0 && grew) enter(li, {y: 14, scale: 0.8});
    });
  }

  function statusText(s) {
    const me = s.seat;
    if (s.phase === 'choosing') return s.iDescribe ? 'Pick your act' : `${s.opponentName} is picking an act…`;
    if (s.phase === 'playing') return s.iDescribe ? 'Act it out with emoji only!' : 'What is it?';
    const base = s.reason === 'solved'
      ? (s.iDescribe ? `${s.opponentName} got it!` : `You got it! +${s.points}`)
      : s.reason === 'skip' ? 'Act skipped' : 'Time’s up!';
    if (!s.finished) return base;
    const [a, b] = [s.scores[me], s.scores[1 - me]];
    return `${base} ${a === b ? 'Match drawn.' : a > b ? 'You win the match!' : 'Match lost.'}`;
  }

  function render(s) {
    prev = last;
    last = s;
    if (s.round !== shownRound) { shownRound = s.round; input.value = ''; shownSeq = []; feedKey = ''; }
    const me = s.seat;
    $('.ec-marquee.me').dataset.seat = String(me);
    $('.ec-marquee.them').dataset.seat = String(1 - me);
    $('.ec-name-me').textContent = s.names[me];
    $('.ec-name-them').textContent = s.opponentName;
    countTo($('.ec-score-me'), s.scores[me]);
    countTo($('.ec-score-them'), s.scores[1 - me]);
    $('.ec-marquee.me').classList.toggle('active', s.iDescribe);
    $('.ec-marquee.them').classList.toggle('active', !s.iDescribe);
    $('.dg-round').textContent = `Act ${s.round}/${s.rounds}`;
    $('.ec-rule').textContent = s.scoreByEmoji ? '✨ Fewer emoji = more points' : '⏱️ Faster guess = more points';

    const status = $('.dg-status');
    status.className = 'dg-status';
    status.textContent = statusText(s);
    if (s.phase === 'roundover') status.classList.add(s.reason === 'solved' ? 'win' : 'lose');
    const err = $('.dg-error');
    err.hidden = !s.error;
    err.textContent = s.error ?? '';

    const flag = $('.ec-flag');
    flag.hidden = !s.canSetFlag;
    $('.ec-flag-box').checked = s.scoreByEmoji;

    const choose = $('.dg-choose');
    choose.hidden = !(s.phase === 'choosing' && s.iDescribe);
    if (!choose.hidden && choose.dataset.round !== String(s.round)) {
      choose.dataset.round = String(s.round);
      choose.replaceChildren();
      for (const c of s.choices) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ec-ticket';
        b.innerHTML = '<span class="ec-choice-icon"></span><span class="ec-choice-body"><small></small><span class="ec-choice-text"></span></span><span class="ec-stub">ADMIT ONE</span>';
        b.querySelector('.ec-choice-icon').textContent = CATEGORIES[c.cat].icon;
        b.querySelector('small').textContent = CATEGORIES[c.cat].label;
        b.querySelector('.ec-choice-text').textContent = c.text;
        b.addEventListener('click', () => {
          synth.whoosh(0.25);
          gsap.to(b, {x: 40, opacity: 0, duration: 0.25, ease: 'power2.in'});
          gsap.to([...choose.children].filter((x) => x !== b), {opacity: 0.3, duration: 0.2});
          setTimeout(() => { if (!destroyed) match.chooseWord(c.text); }, 220);
        });
        choose.append(b);
      }
      arrive(choose.children, {x: -60, rotate: -6, opacity: 0, duration: 0.5, ease: 'back.out(1.6)', stagger: 0.1, delay: 0.2});
    }
    $('.ec-waiting').hidden = !(s.phase === 'choosing' && !s.iDescribe);
    $('.ec-waiting small').textContent = `${s.opponentName} is backstage, picking an act…`;

    const live = s.phase !== 'choosing';
    $('.ec-clue').hidden = !live;
    $('.ec-cat').textContent = s.cat ? `${CATEGORIES[s.cat].icon} ${CATEGORIES[s.cat].label}` : '';
    renderWord(s);
    $('.ec-stage').hidden = !live;
    renderSeq(s);
    $('.ec-used').textContent = live ? `${s.used} emoji used${s.seq.length < s.used ? ` · ${s.seq.length} on stage` : ''} · up to ${MAX_SHOWN} on stage` : '';

    $('.ec-pad').hidden = !(s.iDescribe && s.phase === 'playing');
    $('.ec-back').disabled = $('.ec-clear').disabled = !s.seq.length;
    $('.dg-guess').hidden = !(!s.iDescribe && s.phase === 'playing');
    renderFeed(s);
    $('.dg-next').hidden = !(s.phase === 'roundover' && !s.finished && !s.readyMine);
    if (s.phase === 'roundover' && !s.finished && s.readyMine) status.textContent += ' Waiting for your friend…';
    effects(s);
    tick();
  }

  /** Emoji on stage: new ones drop in from above (or fly from the key you tapped), removed ones bow out. */
  function renderSeq(s) {
    const seqEl = $('.ec-seq');
    const grows = shownSeq.length <= s.seq.length && shownSeq.every((e, i) => s.seq[i] === e);
    const shrinks = shownSeq.length > s.seq.length && s.seq.every((e, i) => shownSeq[i] === e);
    let quiet = false;
    if (shrinks) {
      // Taken back: the last actors bow out.
      [...seqEl.querySelectorAll('.ec-e')].slice(s.seq.length).forEach((el) => {
        el.classList.remove('ec-e');
        if (calm()) { el.remove(); return; }
        gsap.to(el, {y: 40, scale: 0.3, opacity: 0, rotate: 30, duration: 0.3, ease: 'power2.in', onComplete: () => el.remove()});
      });
      shownSeq = [...s.seq];
    } else if (!grows) { seqEl.replaceChildren(); shownSeq = []; quiet = true; }
    seqEl.querySelector('.ec-empty')?.remove();
    for (let i = shownSeq.length; i < s.seq.length; i++) {
      const span = document.createElement('span');
      span.className = 'ec-e';
      span.textContent = s.seq[i];
      seqEl.append(span);
      if (quiet || calm()) continue;
      synth.blip(520 + (i % 6) * 70);
      if (flyFrom && s.iDescribe) {
        const a = flyFrom.getBoundingClientRect();
        const b = span.getBoundingClientRect();
        gsap.fromTo(span, {x: a.left - b.left, y: a.top - b.top, scale: 0.6, rotate: -30}, {x: 0, y: 0, scale: 1, rotate: 0, duration: 0.5, ease: 'back.out(1.4)'});
      } else {
        gsap.fromTo(span, {y: -140, scale: 0.4, rotate: gsap.utils.random(-40, 40)}, {y: 0, scale: 1, rotate: 0, duration: 0.7, ease: 'bounce.out'});
      }
    }
    flyFrom = null;
    shownSeq = [...s.seq];
    if (!s.seq.length) {
      const hint = document.createElement('span');
      hint.className = 'ec-empty';
      hint.textContent = s.iDescribe ? 'Tap emoji below to send actors on stage' : 'The stage is empty… for now';
      seqEl.append(hint);
    }
    // A gentle idle bob, out of step, so the actors look alive.
    if (!calm()) [...seqEl.querySelectorAll('.ec-e')].forEach((e, i) => { e.style.animationDelay = `${(i % 5) * -0.3}s`; });
  }

  function curtains(open) {
    const l = $('.ec-curtain.left'); const r = $('.ec-curtain.right');
    if (calm()) { gsap.set([l, r], {scaleX: open ? 0.14 : 1}); return; }
    gsap.to([l, r], {scaleX: open ? 0.14 : 1, duration: open ? 0.9 : 0.6, ease: open ? 'power3.inOut' : 'power2.in', stagger: 0});
  }

  function effects(s) {
    if (!prev || prev.round !== s.round) {
      stampEl?.remove(); stampEl = null;
      gsap.set([$('.ec-curtain.left'), $('.ec-curtain.right')], {scaleX: 1});
      if (s.phase === 'choosing' && introDone) {
        titleCard(root, {kicker: `Act ${s.round} of ${s.rounds}`, title: s.iDescribe ? 'You perform!' : `${s.opponentName} performs`,
          sub: s.iDescribe ? 'Pick your act' : 'Watch the stage', theme: 'stage', hold: 0.7});
        synth.whoosh();
      }
      return;
    }
    if (s.phase === 'playing' && prev.phase === 'choosing') {
      curtains(true);
      synth.applause(0.8);
      enter(container.querySelectorAll('.ec-cat, .dg-word .dg-letter, .dg-word.mine'), {y: -16, stagger: 0.03});
    }
    if (s.phase === 'roundover' && prev.phase !== 'roundover') {
      arrive(container.querySelectorAll('.dg-word .dg-letter'), {rotateX: -90, opacity: 0, duration: 0.4, ease: 'back.out(2)', stagger: 0.05});
      const stage = $('.ec-stage');
      if (s.reason === 'solved') {
        stampEl = stamp(stage, 'Bravo!', {cls: 'gold', rotate: -8});
        burstAt(stage, 'good');
        floatText(stage, `+${s.iDescribe ? Math.round(s.points / 2) : s.points}`, {color: '#ffd23f', size: 30});
        vibrate('good');
        synth.applause(2);
        synth.arpeggio(true);
        if (!s.finished) play(s.iDescribe ? 'dg.friend_right' : 'dg.right_mine');
      } else {
        stampEl = stamp(stage, s.reason === 'skip' ? 'Skipped' : 'Curtain!', {cls: 'bad', rotate: 7});
        vibrate('bad');
        synth.arpeggio(false);
        if (!s.finished) play('dg.time_up');
      }
      setTimeout(() => { if (!destroyed && last.phase === 'roundover') curtains(false); }, 1600);
      if (s.finished) setTimeout(() => finale(s), 1800);
    } else if (!s.iDescribe && s.guesses.some((g, i) => g.close && !prev.guesses[i]?.close)) {
      floatText($('.dg-input'), 'so close!', {color: '#ffd23f', size: 20});
      synth.blip(880);
    } else if (!s.iDescribe && s.guesses.some((g, i) => g.ok === false && !g.close && prev.guesses[i]?.ok == null)) {
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
    synth.applause(2.4);
    titleCard(root, {kicker: a === b ? 'A tie on opening night' : won ? 'Standing ovation' : `${s.opponentName} steals the show`,
      title: a === b ? 'Encore!' : won ? 'Bravo!' : 'Curtain call', sub: `${a} – ${b}`, theme: 'stage', hold: 1.8});
  }

  const bar = $('.dg-bar > i');
  function tick() {
    if (!last) return;
    const live = last.phase === 'playing' && last.deadline;
    const left = live ? Math.max(0, last.deadline - Date.now()) : 0;
    $('.dg-timer').hidden = !live;
    $('.dg-left').textContent = live ? `${Math.ceil(left / 1000)}s` : '';
    bar.style.transform = `scaleX(${live ? left / last.durationMs : 0})`;
    $('.dg-timer').classList.toggle('low', live && left < 10_000);
    const secs = Math.ceil(left / 1000);
    if (live && left < 10_000 && secs !== lastSec) { lastSec = secs; synth.click(); pop($('.dg-left'), {scale: 1.4}); }
  }
  const timer = setInterval(tick, 250);

  const match = new EmojiCharadesMatch({session, onChange: render});
  render(match.snapshot());
  fitText(container.querySelectorAll('.ec-name'));
  enter(container.querySelectorAll('.ec-hud > *'), {y: -14, stagger: 0.08});
  titleCard(root, {kicker: 'Tonight only', title: 'Emoji Charades', sub: `${last.rounds} acts · no words, just emoji`, theme: 'stage', hold: 1})
    .then(() => { introDone = true; });

  return {
    destroy() { unbake();
      destroyed = true;
      clearInterval(timer);
      gsap.killTweensOf(container.querySelectorAll('*'));
      match.destroy();
      container.replaceChildren();
    },
  };
}
