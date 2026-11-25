// Hangman as a room game: two rounds, roles swap. The setter types a word (kept secret by a hash
// commitment), the guesser calls letters. See match.js.
// The picture is a balloon ride over the sea instead of a gallows: every wrong letter pops one of six balloons and
// the basket sinks; when the last one goes it splashes down. Found words send it soaring. Look: hangman.css.

import {loadCss} from '../../load-css.js';
import {HangmanMatch} from './match.js';
import {MAX_LEN, MAX_WRONG, MIN_LEN, cleanWord, validWord} from './rules.js';
import {play} from '../../sound.js';
import {burstAt, celebrate, vibrate} from '../../fx.js';
import {synth} from '../../synth.js';
import {calm, countTo, enter, gsap, pop, quake, stamp, titleCard} from '../../juice.js';

const BALLOONS = ['#ff4d6d', '#ffd23f', '#3a86ff', '#2ec27e', '#b06cff', '#ff8a3d'];
const AT = [[-34, -6], [0, -14], [34, -6], [-20, 18], [20, 18], [0, 30]]; // around the bunch centre
const SCENE = `
<svg class="hm-scene" viewBox="0 0 300 210" aria-hidden="true">
  <defs><linearGradient id="hm-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7cc8ff"/><stop offset="1" stop-color="#d9f1ff"/></linearGradient></defs>
  <rect width="300" height="210" fill="url(#hm-sky)"/>
  <g class="hm-clouds"><g class="hm-cloud" transform="translate(40 40)"><ellipse rx="24" ry="8"/><ellipse cx="12" cy="-6" rx="14" ry="8"/></g><g class="hm-cloud" transform="translate(240 70)"><ellipse rx="20" ry="7"/><ellipse cx="-10" cy="-5" rx="12" ry="7"/></g></g>
  <g class="hm-ride">
    <g class="hm-strings">${AT.map(([x, y]) => `<path d="M150 118 L${150 + x} ${58 + y + 15}"/>`).join('')}</g>
    <g class="hm-bunch">${AT.map(([x, y], i) => `<g class="hm-balloon" data-i="${i}" transform="translate(${150 + x} ${58 + y})"><ellipse rx="15" ry="18" fill="${BALLOONS[i]}"/><ellipse class="hm-shine" cx="-5" cy="-7" rx="4" ry="6"/><path class="hm-knot" d="M-3 18 l3 4 l3 -4z" fill="${BALLOONS[i]}"/></g>`).join('')}</g>
    <g class="hm-basket" transform="translate(150 128)">
      <text class="hm-face" x="0" y="-6" text-anchor="middle">🙂</text>
      <path d="M-18 -2 h36 l-4 20 h-28 z"/><path class="hm-weave" d="M-16 5 h32 M-15 11 h30"/>
    </g>
  </g>
  <g class="hm-fin" transform="translate(300 188)"><path d="M0 0 l10 -18 l8 18 z"/></g>
  <path class="hm-sea" d="M-20 184 q15 -6 30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 V210 H-20 Z"/>
  <path class="hm-sea2" d="M-20 192 q15 -5 30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 V210 H-20 Z"/>
</svg>`;

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

const TEMPLATE = `
<div class="hm">
  <div class="hm-top"><span class="hm-round"></span><span class="hm-score"><b class="hm-score-me">0</b> – <b class="hm-score-them">0</b></span></div>
  <p class="hm-status" aria-live="polite"></p>
  <p class="hm-error" hidden></p>
  <div class="hm-stage">${SCENE}<span class="hm-left"></span></div>
  <div class="hm-word" aria-live="polite"></div>
  <form class="hm-pick" hidden>
    <input class="hm-input" type="text" maxlength="30" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Secret word (letters only)" aria-label="Secret word">
    <button class="primary" type="submit">Lock in</button>
  </form>
  <div class="hm-keys"></div>
  <button class="primary hm-next" hidden>Next round</button>
</div>`;

export async function createGame({session, container}) {
  await loadCss(new URL('./hangman.css', import.meta.url));
  container.innerHTML = TEMPLATE;
  const $ = (s) => container.querySelector(s);
  const root = $('.hm');
  const balloons = [...container.querySelectorAll('.hm-balloon')];
  const strings = [...container.querySelectorAll('.hm-strings path')];
  const keys = LETTERS.map((l) => {
    const b = document.createElement('button');
    b.textContent = l;
    b.dataset.key = l;
    b.addEventListener('click', () => { synth.unlock(); pop(b, {scale: 0.85}); match.guess(l); });
    $('.hm-keys').append(b);
    return b;
  });
  const input = $('.hm-input');
  $('.hm-pick').addEventListener('submit', (e) => {
    e.preventDefault();
    const word = cleanWord(input.value);
    if (!validWord(word)) { input.setCustomValidity(`${MIN_LEN} to ${MAX_LEN} letters`); input.reportValidity(); return; }
    input.setCustomValidity('');
    synth.unlock();
    match.chooseWord(word);
  });
  $('.hm-next').addEventListener('click', () => match.next());

  let shownRound = 0;
  let seenGuess = null; // {round, count} as last drawn, to spot the letter just guessed
  let seenPhase = null;
  let popped = 0;      // balloons already popped on screen
  let introDone = false;
  const ride = container.querySelector('.hm-ride');
  /** Balloons left = MAX_WRONG - wrong; the ride sinks a little with each one gone. */
  function balloonsTo(wrong, animate) {
    balloons.forEach((b, i) => {
      const gone = i >= MAX_WRONG - wrong;
      strings[i].style.visibility = gone ? 'hidden' : '';
      if (gone && !b.classList.contains('gone')) {
        b.classList.add('gone');
        if (animate && !calm()) {
          gsap.timeline().to(b, {scale: 1.35, transformOrigin: '50% 50%', duration: 0.08}).to(b, {scale: 0, opacity: 0, duration: 0.12});
          burstAt(b, 'pop', [BALLOONS[i], '#ffffff']);
          synth.beep(1200, 0.05, 0.12); synth.whoosh(0.2);
        } else gsap.set(b, {scale: 0, opacity: 0, transformOrigin: '50% 50%'});
      } else if (!gone && b.classList.contains('gone')) {
        b.classList.remove('gone');
        gsap.fromTo(b, {scale: 0, opacity: 1, transformOrigin: '50% 100%'}, {scale: 1, duration: calm() ? 0 : 0.5, ease: 'elastic.out(1, .5)', delay: i * 0.05});
      }
    });
    const left = MAX_WRONG - wrong;
    gsap.to(ride, {y: wrong * 9, duration: calm() ? 0 : 0.8, ease: 'elastic.out(1, .6)'});
    container.querySelector('.hm-face').textContent = left >= 5 ? '🙂' : left >= 3 ? '😬' : left >= 1 ? '😰' : '😱';
    $('.hm-left').textContent = `🎈 × ${left}`;
    popped = wrong;
  }
  const render = (s) => {
    if (s.round !== shownRound) {
      const fresh = shownRound !== 0;
      shownRound = s.round; input.value = '';
      gsap.set(ride, {x: 0, rotation: 0});
      gsap.set(container.querySelector('.hm-fin'), {x: 300});
      container.querySelectorAll('.hm-stage .jc-stamp').forEach((e) => e.remove());
      balloonsTo(0, false);
      if (fresh && introDone) titleCard(root, {kicker: `Round ${s.round} of ${s.rounds}`, title: s.iAmSetter ? 'You set the word' : 'You guess', sub: s.iAmSetter ? 'Pick something tricky' : `${s.opponentName} is picking`, theme: 'marker', hold: 0.6});
    }
    const me = s.seat;
    $('.hm-round').textContent = `Round ${s.round}/${s.rounds} · ${s.iAmSetter ? 'you set the word' : `${s.opponentName} sets it`}`;
    countTo($('.hm-score-me'), s.scores[me]);
    countTo($('.hm-score-them'), s.scores[1 - me]);
    if (s.wrongCount !== popped) balloonsTo(s.wrongCount, s.wrongCount > popped);

    const status = $('.hm-status');
    const before = status.textContent;
    status.className = 'hm-status';
    const over = s.phase === 'roundover';
    if (s.phase === 'choosing') status.textContent = s.iAmSetter ? 'Pick a secret word for your friend' : `${s.opponentName} is picking a word…`;
    else if (!over) status.textContent = s.iAmSetter ? `${s.opponentName} is guessing…` : s.pending ? '…' : 'Guess a letter';
    else {
      const won = s.roundWinner === me;
      status.textContent = s.hanged
        ? (s.iAmSetter ? `${s.opponentName} ran out of guesses. You win the round!` : 'Out of guesses 😬')
        : (s.iAmSetter ? `${s.opponentName} found your word.` : 'You found it! 🎉');
      status.classList.add(won ? 'win' : 'lose');
      if (s.finished) {
        const [a, b] = [s.scores[me], s.scores[1 - me]];
        status.textContent += a === b ? ' Match drawn.' : a > b ? ' You win the match! 🎉' : ' Match lost.';
      }
    }
    const err = $('.hm-error');
    err.hidden = !s.error;
    err.textContent = s.error ?? '';

    // The word: letters found so far; the setter sees the whole word, unfound letters dimmed. After the round everyone sees it.
    const wordEl = $('.hm-word');
    const tiles = [...wordEl.children];
    if (tiles.length !== (s.length ?? 0)) {
      wordEl.replaceChildren(...Array.from({length: s.length ?? 0}, () => document.createElement('span')));
      enter(wordEl.children, {y: -20, stagger: 0.04});
    }
    [...wordEl.children].forEach((el, i) => {
      const known = s.revealed[i];
      const full = s.word?.[i];
      const text = known ?? full ?? '';
      const cls = `hm-letter${known ? ' found' : full ? ' unknown' : ''}`;
      const flip = known && !el.classList.contains('found');
      el.className = cls;
      el.textContent = text;
      if (flip && !calm()) gsap.fromTo(el, {rotateX: -90}, {rotateX: 0, duration: 0.45, ease: 'back.out(2)', delay: (i % 6) * 0.05});
    });

    $('.hm-pick').hidden = !(s.phase === 'choosing' && s.iAmSetter);
    $('.hm-keys').hidden = s.iAmSetter || s.phase === 'choosing';
    const wrong = new Set(s.wrong);
    for (const b of keys) {
      const l = b.dataset.key;
      b.disabled = s.phase !== 'guessing' || s.guessed.includes(l) || !!s.pending;
      b.className = s.guessed.includes(l) ? (wrong.has(l) ? 'wrong' : 'right') : '';
    }
    const roundJustEnded = seenPhase !== null && seenPhase !== 'roundover' && over;
    if (seenGuess && seenGuess.round === s.round && s.guessed.length > seenGuess.count && !over) {
      const right = !wrong.has(s.guessed[s.guessed.length - 1]);
      if (right) synth.arpeggio(true); else { quake($('.hm-stage'), 0.5); vibrate('bad'); }
      play(s.iAmSetter ? (right ? 'hm.friend_right' : 'hm.friend_wrong') : (right ? 'hm.right_mine' : 'hm.wrong_mine'));
    }
    if (status.textContent !== before) enter(status, {y: 8, duration: 0.3});
    if (roundJustEnded) ending(s);
    if (roundJustEnded && !s.finished) play(s.roundWinner === me ? 'hm.round_won' : 'hm.round_lost'); // the last round gets the result sound instead
    seenGuess = {round: s.round, count: s.guessed.length};
    seenPhase = s.phase;
    $('.hm-next').hidden = !(over && !s.finished && !s.readyMine);
    if (over && !s.finished && s.readyMine) status.textContent += ' Waiting for your friend…';
  };

  /** The end of a round: a splash-down when the guesser ran out, a happy lift-off when the word was found. */
  function ending(s) {
    const stage = $('.hm-stage');
    if (s.hanged) {
      if (!calm()) gsap.to(ride, {y: 120, rotation: 12, duration: 0.9, ease: 'power3.in', onComplete: () => { synth.splash(); burstAt(container.querySelector('.hm-sea'), 'splash'); quake(stage, 0.8); }});
      gsap.fromTo(container.querySelector('.hm-fin'), {x: 300}, {x: 150, duration: 2.2, ease: 'power1.out', delay: 0.6});
      stamp(stage, 'Splash!', {cls: 'bad', rotate: 8});
    } else {
      if (!calm()) gsap.to(ride, {y: -40, duration: 1.4, ease: 'power2.out'});
      synth.arpeggio(true);
      if (!s.iAmSetter && !s.finished) celebrate(); // the match result has its own fireworks
      stamp(stage, 'Saved!', {rotate: -8});
    }
  }

  const match = new HangmanMatch({session, onChange: render});
  render(match.snapshot());
  enter(container.querySelectorAll('.hm-top > *'), {y: -12, stagger: 0.08});
  titleCard(root, {kicker: 'Don’t let them drop', title: 'Hangman', sub: '6 balloons · guess the word', theme: 'marker', hold: 0.8}).then(() => { introDone = true; });

  return {destroy() { gsap.killTweensOf(container.querySelectorAll('*')); match.destroy(); container.replaceChildren(); }};
}
