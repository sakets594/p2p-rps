// The header every turn-based game shows: both players with their score, whose turn it is, and a
// status line. `mountTurnHeader` returns the elements to fill in; `renderTurnHeader` updates them.

export const HEADER = `
<div class="tg-head">
  <div class="tg-p me"><b class="tg-name-me"></b><span class="tg-score tg-score-me">0</span></div>
  <div class="tg-p them"><b class="tg-name-them"></b><span class="tg-score tg-score-them">0</span></div>
</div>
<p class="tg-status" aria-live="polite"></p>
<p class="tg-error" hidden></p>`;

/**
 * @param root     the game's element
 * @param snap     a TurnMatch snapshot
 * @param scores   [seat 0 score, seat 1 score] or null to hide them
 * @param verbs    {turn: 'Your move'} etc. overrides
 */
export function renderTurnHeader(root, snap, scores = null, words = {}) {
  const q = (s) => root.querySelector(s);
  const me = snap.seat;
  q('.tg-name-me').textContent = `${snap.names[me]} (you)`;
  q('.tg-name-them').textContent = snap.opponentName;
  q('.tg-score-me').textContent = scores ? scores[me] : '';
  q('.tg-score-them').textContent = scores ? scores[1 - me] : '';
  q('.tg-p.me').classList.toggle('active', snap.myTurn);
  q('.tg-p.them').classList.toggle('active', snap.turn === 1 - me);
  const status = q('.tg-status');
  status.className = 'tg-status';
  if (snap.over) {
    if (snap.over.winner === null) status.textContent = words.draw ?? 'It’s a draw';
    else if (snap.won) { status.textContent = words.won ?? 'You win! 🎉'; status.classList.add('win'); }
    else { status.textContent = words.lost ?? `${snap.opponentName} wins 😬`; status.classList.add('lose'); }
  } else {
    status.textContent = snap.myTurn ? (words.myTurn ?? 'Your move') : (words.theirTurn ?? `${snap.opponentName}’s move…`);
  }
  const err = q('.tg-error');
  err.hidden = !snap.error;
  err.textContent = snap.error ?? '';
}

/** 'p-mine' / 'p-theirs' / '' for a seat value stored in the state. */
export const ownerClass = (seat, snap) => (seat === null || seat === undefined ? '' : seat === snap.seat ? 'p-mine' : 'p-theirs');
