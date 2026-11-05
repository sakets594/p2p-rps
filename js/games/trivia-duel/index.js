// Trivia Duel as a room game: same questions on both screens, fastest right answer wins the bonus.
// The view owns the clock (12 s per question, results shown for a few seconds); match.js stays pure.

import {loadCss} from '../../load-css.js';
import {TIME_LIMIT_MS, TriviaMatch} from './match.js';

const REVEAL_MS = 3_000;

const TEMPLATE = `
<div class="tg tv">
  <div class="tg-head">
    <div class="tg-p me"><b class="tg-name-me"></b><span class="tg-score tg-score-me">0</span></div>
    <div class="tg-p them"><b class="tg-name-them"></b><span class="tg-score tg-score-them">0</span></div>
  </div>
  <div class="tv-top"><span class="muted small tv-count"></span><span class="muted small tv-left"></span></div>
  <div class="tv-bar"><i></i></div>
  <h2 class="tv-q"></h2>
  <div class="tv-opts"></div>
  <p class="tv-note" aria-live="polite"></p>
</div>`;

export async function createGame({session, container}) {
  await loadCss(new URL('../board.css', import.meta.url));
  await loadCss(new URL('./trivia.css', import.meta.url));
  container.innerHTML = TEMPLATE;
  const $ = (s) => container.querySelector(s);
  const optsEl = $('.tv-opts');
  const bar = $('.tv-bar > i');

  let startedAt = performance.now();
  let shownIndex = -1;
  let timer = null; // the per-question countdown tick
  let nextTimer = null; // moves on after the result has been shown
  let destroyed = false;

  const stopTimers = () => { clearInterval(timer); clearTimeout(nextTimer); timer = nextTimer = null; };

  const startQuestion = () => {
    startedAt = performance.now();
    clearInterval(timer);
    timer = setInterval(() => {
      const left = Math.max(0, TIME_LIMIT_MS - (performance.now() - startedAt));
      bar.style.transform = `scaleX(${left / TIME_LIMIT_MS})`;
      $('.tv-left').textContent = `${Math.ceil(left / 1000)}s`;
      if (left <= 0) { clearInterval(timer); match.answer(-1, TIME_LIMIT_MS); }
    }, 100);
  };

  const render = (s) => {
    if (destroyed) return;
    const me = s.seat;
    $('.tg-name-me').textContent = `${s.names[me]} (you)`;
    $('.tg-name-them').textContent = s.opponentName;
    $('.tg-score-me').textContent = s.scores.me;
    $('.tg-score-them').textContent = s.scores.them;
    $('.tv-count').textContent = `Question ${s.index + 1} of ${s.total}`;
    $('.tv-q').textContent = s.question;

    if (s.index !== shownIndex) {
      shownIndex = s.index;
      stopTimers();
      optsEl.replaceChildren(...s.options.map((text, i) => {
        const b = document.createElement('button');
        b.className = 'tv-opt';
        b.dataset.opt = i;
        b.addEventListener('click', () => match.answer(i, performance.now() - startedAt));
        return b;
      }));
      startQuestion();
    }
    const revealed = s.phase !== 'asking';
    [...optsEl.children].forEach((b, i) => {
      b.textContent = s.options[i];
      const mine = s.myChoice === i, theirs = revealed && s.theirChoice === i;
      b.className = `tv-opt${mine ? ' mine' : ''}${theirs ? ' theirs' : ''}${revealed ? (i === s.correct ? ' right' : ' wrong') : ''}`;
      if (theirs) { const tag = document.createElement('span'); tag.className = 'tv-tag'; tag.textContent = s.opponentName; b.append(tag); }
      b.disabled = s.answered || revealed;
    });

    const note = $('.tv-note');
    note.className = 'tv-note';
    if (revealed) {
      clearInterval(timer);
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

  return {
    destroy() { destroyed = true; stopTimers(); match.destroy(); container.replaceChildren(); },
  };
}
