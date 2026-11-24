// Memory Match as a room game: TurnMatch with the rules in rules.js. A pair scores and keeps the turn;
// after a miss both cards stay visible for a moment (everyone gets a look) before they flip back.

import {loadCss} from '../../load-css.js';
import {TurnMatch} from '../turn-match.js';
import {HEADER, renderTurnHeader} from '../turn-ui.js';
import {memoryRules} from './rules.js';
import {burstAt, floatText, playerColors, ringAt, shake, vibrate} from '../../fx.js';

const PEEK_MS = 1300;

export async function createGame({session, container}) {
  await loadCss(new URL('../board.css', import.meta.url));
  container.innerHTML = `<div class="tg">${HEADER}<div class="mm-board"></div></div>`;
  const boardEl = container.querySelector('.mm-board');
  const cards = [];
  for (let i = 0; i < memoryRules.create({seed: '', first: 0}).cards.length; i++) {
    const b = document.createElement('button');
    b.className = 'mm-card';
    b.dataset.card = i;
    b.setAttribute('aria-label', `Card ${i + 1}`);
    b.addEventListener('click', () => { if (!peeking()) match.play(i); });
    boardEl.append(b);
    cards.push(b);
  }

  let peekUntil = 0;
  let peekedAt = -1;
  let timer = null;
  let seenUp = null; // per card: was it face up (or matched) when last drawn
  let seenMatched = null;
  let streak = {seat: -1, n: 0}; // matches in a row by the same player
  const peeking = () => Date.now() < peekUntil;

  const render = (snap) => {
    const s = snap.state;
    if (s.peek.length && snap.moves !== peekedAt) {
      peekedAt = snap.moves;
      peekUntil = Date.now() + PEEK_MS;
      clearTimeout(timer);
      timer = setTimeout(() => render(match.snapshot()), PEEK_MS + 20);
    }
    const showPeek = s.peek.length > 0 && peeking();
    renderTurnHeader(container, snap, s.scores, {myTurn: 'Your turn: flip two cards'});
    const closed = [];
    cards.forEach((b, i) => {
      const matched = s.matched[i];
      const up = matched !== null || s.up.includes(i) || (showPeek && s.peek.includes(i));
      b.textContent = up ? s.cards[i] : '';
      const flipped = seenUp && up && !seenUp[i];
      const justMatched = seenMatched && matched !== null && seenMatched[i] === null;
      b.className = `mm-card${up ? ' up' : ''}${matched === null ? '' : matched === snap.seat ? ' mine' : ' theirs'}${flipped ? ' flip' : ''}${justMatched ? ' match' : ''}`;
      if (justMatched) { burstAt(b, 'sparkle'); ringAt(b, '#ffe27a'); closed.push({b, seat: matched}); }
      else if (showPeek && s.peek.includes(i) && flipped) shake(b, 0.5);
      b.disabled = !snap.myTurn || matched !== null || s.up.includes(i) || !!snap.over || showPeek;
    });
    if (closed.length) {
      const seat = closed[0].seat;
      streak = streak.seat === seat ? {seat, n: streak.n + 1} : {seat, n: 1};
      const color = playerColors()[seat === snap.seat ? 0 : 1];
      const mid = closed[0].b;
      floatText(mid, streak.n > 1 ? `COMBO x${streak.n}!` : 'MATCH!', {color: '#ffe27a', size: 18 + Math.min(streak.n, 4) * 4});
      for (const {b} of closed) burstAt(b, 'good', [color, '#ffffff', '#ffe27a']);
      if (seat === snap.seat) vibrate('good');
    } else if (s.peek.length && !showPeek) streak = {seat: -1, n: 0}; // a miss ends the streak
    seenUp = cards.map((b) => b.classList.contains('up'));
    seenMatched = [...s.matched];
  };
  const match = new TurnMatch({session, rules: memoryRules, onChange: render});
  render(match.snapshot());

  return {destroy() { clearTimeout(timer); match.destroy(); container.replaceChildren(); }};
}
