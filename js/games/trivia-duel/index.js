// Trivia Duel as a room game: same questions on both screens, fastest right answer wins the bonus.
// The view owns the clock (12 s per question, results shown for a few seconds); match.js stays pure.
// The look is a TV quiz show: two lit podiums, a marquee question board, lettered answer plates that lock in orange
// and flash green or red on the reveal, and studio sounds. Look: trivia.css.

import {bake} from '../../bake.js';
import {loadCss} from '../../load-css.js';
import {TIME_LIMIT_MS, TriviaMatch} from './match.js';
import {burstAt, floatText, flash, ringAt, screenFlash, shake, vibrate} from '../../fx.js';
import {play} from '../../sound.js';
import {synth} from '../../synth.js';
import {countTo, enter, gsap, SplitText, calm, titleCard} from '../../juice.js';

const REVEAL_MS = 3_000;
const INTRO_MS = 2_000; // how long the opening card covers the first question

const TEMPLATE = `
<div class="tg tv show">
  <div class="tv-podiums">
    <div class="tv-pod me"><i class="tv-lamp"></i><b class="tg-name-me"></b><span class="tg-score tg-score-me">0</span></div>
    <div class="tv-pod them"><i class="tv-lamp"></i><b class="tg-name-them"></b><span class="tg-score tg-score-them">0</span></div>
  </div>
  <div class="tv-board"><i class="tv-bulbs top"></i><i class="tv-bulbs"></i>
    <div class="tv-top"><span class="tv-count"></span><span class="tv-left"></span></div>
    <div class="tv-bar"><i></i></div>
    <h2 class="tv-q"><span></span></h2>
  </div>
  <div class="tv-opts"></div>
  <p class="tv-note" aria-live="polite"></p>
</div>`;

export async function createGame({session, container}) {
  await loadCss(new URL('../board.css', import.meta.url));
  await loadCss(new URL('./trivia.css', import.meta.url));
  container.innerHTML = TEMPLATE;
  const unbake = bake(container.querySelector('.tv'), container.querySelector('.tv-bulbs')); // paint the rich backgrounds once (js/bake.js)
  const $ = (s) => container.querySelector(s);
  const optsEl = $('.tv-opts');
  const bar = $('.tv-bar > i');

  let startedAt = performance.now();
  let shownIndex = -1;
  let revealedIndex = -1; // the question whose result already got its effect
  let streak = 0; // right answers in a row
  let hurried = false; // the "jaldi bol" for this question already played
  let timer = null; // the per-question countdown tick
  let nextTimer = null; // moves on after the result has been shown
  let destroyed = false;
  let openTimer = null;

  const stopTimers = () => { clearInterval(timer); clearTimeout(nextTimer); timer = nextTimer = null; };

  let open = false; // the first question's clock waits until the intro card has gone
  let lastTick = -1;
  const startQuestion = () => {
    startedAt = performance.now();
    hurried = false;
    clearInterval(timer);
    timer = setInterval(() => {
      const left = Math.max(0, TIME_LIMIT_MS - (performance.now() - startedAt));
      const frac = left / TIME_LIMIT_MS;
      bar.style.transform = `scaleX(${frac})`;
      bar.style.background = `hsl(${Math.round(frac * 130)} 80% 46%)`; // green, then amber, then red
      bar.classList.toggle('urgent', left < 4000);
      $('.tv-left').textContent = `${Math.ceil(left / 1000)}s`;
      if (left < 4000 && !hurried) { hurried = true; if (!match.snapshot().answered) play('tv.hurry'); }
      const secs = Math.ceil(left / 1000);
      if (left < 4000 && left > 0 && secs !== lastTick) { lastTick = secs; synth.click(); }
      if (left <= 0) { clearInterval(timer); match.answer(-1, TIME_LIMIT_MS); }
    }, 100);
  };

  const render = (s) => {
    if (destroyed) return;
    const me = s.seat;
    $('.tg-name-me').textContent = `${s.names[me]} (you)`;
    $('.tg-name-them').textContent = s.opponentName;
    countTo($('.tg-score-me'), s.scores.me);
    countTo($('.tg-score-them'), s.scores.them);
    $('.tv-pod.me').classList.toggle('lit', !!s.answered);
    $('.tv-pod.them').classList.toggle('lit', !!s.theirAnswered || s.phase !== 'asking');
    $('.tv-count').textContent = `Question ${s.index + 1} of ${s.total}`;
    const qText = $('.tv-q > span'); // one block inside the centring grid, so split words keep flowing as a sentence
    if (qText.textContent !== s.question) {
      qText.textContent = s.question;
      if (!calm()) {
        const split = new SplitText(qText, {type: 'words'});
        gsap.from(split.words, {y: 14, opacity: 0, duration: 0.35, ease: 'back.out(1.8)', stagger: 0.035, onComplete: () => split.revert()});
      }
      synth.whoosh(0.35);
    }

    if (s.index !== shownIndex) {
      shownIndex = s.index;
      stopTimers();
      optsEl.replaceChildren(...s.options.map((text, i) => {
        const b = document.createElement('button');
        b.className = 'tv-opt';
        b.dataset.opt = i;
        b.addEventListener('click', () => { synth.unlock(); synth.beep(660, 0.1, 0.12); match.answer(i, performance.now() - startedAt); });
        return b;
      }));
      if (!calm()) gsap.fromTo(optsEl.children, {x: (i) => (i % 2 ? 60 : -60), opacity: 0}, {x: 0, opacity: 1, duration: 0.4, ease: 'back.out(1.6)', stagger: 0.07, delay: 0.15, clearProps: 'transform,opacity'});
      if (open) startQuestion();
    }
    const revealed = s.phase !== 'asking';
    [...optsEl.children].forEach((b, i) => {
      b.textContent = '';
      const letter = document.createElement('em');
      letter.textContent = 'ABCD'[i] ?? '';
      const text = document.createElement('span');
      text.textContent = s.options[i];
      b.append(letter, text);
      const mine = s.myChoice === i, theirs = revealed && s.theirChoice === i;
      b.className = `tv-opt${mine ? ' mine' : ''}${theirs ? ' theirs' : ''}${revealed ? (i === s.correct ? ' right' : ' wrong') : ''}`;
      if (theirs) { const tag = document.createElement('span'); tag.className = 'tv-tag'; tag.textContent = s.opponentName; b.append(tag); }
      b.disabled = s.answered || revealed || !open;
    });

    const note = $('.tv-note');
    note.className = 'tv-note';
    if (revealed) {
      clearInterval(timer);
      if (revealedIndex !== s.index) {
        revealedIndex = s.index;
        const mineBtn = optsEl.children[s.myChoice];
        if (s.myChoice === s.correct) {
          streak++;
          burstAt(mineBtn, 'good');
          ringAt(mineBtn.querySelector('em'), '#4ade80', {size: 1.4});
          flash(mineBtn, 'var(--good)');
          if (s.gained.me > 0) floatText(mineBtn, `+${s.gained.me}`, {color: '#4ade80', size: 30});
          if (streak >= 2) { // on a roll: flames rise from the score
            burstAt($('.tg-score-me'), 'fire');
            floatText($('.tv-pod.me'), `🔥 STREAK x${streak}`, {color: '#ffb703', size: 20});
          }
          vibrate('good');
          synth.arpeggio(true);
          if (s.phase !== 'over') play(streak >= 2 ? 'tv.streak' : 'tv.right'); // the last question gets the result sound instead
        } else {
          streak = 0;
          screenFlash('#ff2d2d', 0.4, 500);
          if (mineBtn) { shake(mineBtn, 0.8); flash(mineBtn, 'var(--bad)'); } else shake(optsEl, 0.5); // no pick: out of time
          vibrate('bad');
          synth.beep(140, 0.35, 0.12);
          if (s.phase !== 'over') play(mineBtn ? 'tv.wrong' : 'tv.timeout');
        }
        const rightBtn = optsEl.children[s.correct];
        if (rightBtn && s.myChoice !== s.correct) ringAt(rightBtn.querySelector('em'), '#4ade80', {size: 1.4}); // show where it was
      }
      const g = s.gained;
      note.textContent = `${g.me > 0 ? `+${g.me}` : 'No points'} for you · ${g.them > 0 ? `+${g.them}` : 'none'} for ${s.opponentName}`;
      note.classList.add(g.me > g.them ? 'win' : g.me < g.them ? 'lose' : 'x');
      if (s.phase === 'over') {
        note.textContent = s.scores.me === s.scores.them ? 'It’s a draw'
          : s.scores.me > s.scores.them ? 'You win the duel! 🎉' : `${s.opponentName} wins the duel 😬`;
        note.classList.add(s.scores.me > s.scores.them ? 'win' : s.scores.me < s.scores.them ? 'lose' : 'x');
      } else if (!nextTimer && !s.readyMine) {
        nextTimer = setTimeout(() => { nextTimer = null; match.next(); }, REVEAL_MS);
      }
    } else {
      note.textContent = s.answered ? `Locked in. Waiting for ${s.opponentName}…` : s.theirAnswered ? `${s.opponentName} has answered. Be quick!` : '';
    }
  };

  const match = new TriviaMatch({session, onChange: render});
  render(match.snapshot());
  enter(container.querySelectorAll('.tv-pod'), {y: 30, stagger: 0.1});
  titleCard($('.tv'), {kicker: 'Tonight’s quiz', title: 'Trivia Duel', sub: 'Fastest right answer gets the bonus', theme: 'stage', hold: 0.4});
  // A fixed wait, not the card's own promise: a hidden tab pauses animation and must not hold up the game.
  openTimer = setTimeout(() => { open = true; startQuestion(); render(match.snapshot()); }, INTRO_MS);

  return {
    destroy() { unbake(); destroyed = true; clearTimeout(openTimer); stopTimers(); match.destroy(); container.replaceChildren(); },
  };
}
