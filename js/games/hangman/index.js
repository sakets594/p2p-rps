// Hangman as a room game: two rounds, roles swap. The setter types a word (kept secret by a hash
// commitment), the guesser calls letters. See match.js.

import {loadCss} from '../../load-css.js';
import {HangmanMatch} from './match.js';
import {MAX_LEN, MIN_LEN, cleanWord, validWord} from './rules.js';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

const TEMPLATE = `
<div class="hm">
  <div class="hm-top"><span class="muted small hm-round"></span><span class="muted small hm-score"></span></div>
  <p class="hm-status" aria-live="polite"></p>
  <p class="hm-error" hidden></p>
  <svg class="hm-gallows" viewBox="0 0 150 150" aria-hidden="true">
    <path d="M15 140h90M35 140V15h70v20"/>
    <circle class="part" cx="105" cy="52" r="16"/>
    <path class="part" d="M105 68v42"/>
    <path class="part" d="M105 80l-20 18"/>
    <path class="part" d="M105 80l20 18"/>
    <path class="part" d="M105 110l-18 26"/>
    <path class="part" d="M105 110l18 26"/>
  </svg>
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
  const parts = [...container.querySelectorAll('.part')];
  const keys = LETTERS.map((l) => {
    const b = document.createElement('button');
    b.textContent = l;
    b.dataset.key = l;
    b.addEventListener('click', () => match.guess(l));
    $('.hm-keys').append(b);
    return b;
  });
  const input = $('.hm-input');
  $('.hm-pick').addEventListener('submit', (e) => {
    e.preventDefault();
    const word = cleanWord(input.value);
    if (!validWord(word)) { input.setCustomValidity(`${MIN_LEN} to ${MAX_LEN} letters`); input.reportValidity(); return; }
    input.setCustomValidity('');
    match.chooseWord(word);
  });
  $('.hm-next').addEventListener('click', () => match.next());

  let shownRound = 0;
  const render = (s) => {
    if (s.round !== shownRound) { shownRound = s.round; input.value = ''; }
    const me = s.seat;
    $('.hm-round').textContent = `Round ${s.round} of ${s.rounds} · ${s.iAmSetter ? 'you pick the word' : `${s.opponentName} picks the word`}`;
    $('.hm-score').textContent = `${s.scores[me]} – ${s.scores[1 - me]}`;
    parts.forEach((p, i) => p.classList.toggle('on', i < s.wrongCount));

    const status = $('.hm-status');
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
    wordEl.replaceChildren();
    for (let i = 0; i < (s.length ?? 0); i++) {
      const el = document.createElement('span');
      const known = s.revealed[i];
      const full = s.word?.[i];
      el.className = `hm-letter${known ? '' : full ? ' unknown' : ''}`;
      el.textContent = known ?? full ?? '';
      wordEl.append(el);
    }

    $('.hm-pick').hidden = !(s.phase === 'choosing' && s.iAmSetter);
    $('.hm-keys').hidden = s.iAmSetter || s.phase === 'choosing';
    const wrong = new Set(s.wrong);
    for (const b of keys) {
      const l = b.dataset.key;
      b.disabled = s.phase !== 'guessing' || s.guessed.includes(l) || !!s.pending;
      b.className = s.guessed.includes(l) ? (wrong.has(l) ? 'wrong' : 'right') : '';
    }
    $('.hm-next').hidden = !(over && !s.finished && !s.readyMine);
    if (over && !s.finished && s.readyMine) status.textContent += ' Waiting for your friend…';
  };

  const match = new HangmanMatch({session, onChange: render});
  render(match.snapshot());

  return {destroy() { match.destroy(); container.replaceChildren(); }};
}
