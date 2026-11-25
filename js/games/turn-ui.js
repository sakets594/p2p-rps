// The header every turn-based game shows: both players with their score, whose turn it is, and a
// status line. `mountTurnHeader` returns the elements to fill in; `renderTurnHeader` updates them.

import {play} from '../sound.js';
import {synth} from '../synth.js';
import {countTo, enter, pop, titleCard} from '../juice.js';

const SLOW_MS = 25_000; // my turn and no move for this long: my phone says "jaldi bol"
const nudges = new WeakMap(); // game root -> {moves, timer}

function watchSlow(root, snap) {
  const state = nudges.get(root) ?? {moves: -1, timer: null};
  nudges.set(root, state);
  if (snap.myTurn && !snap.over) {
    if (state.moves === snap.moves) return; // same turn as last render: keep the clock running
    clearTimeout(state.timer);
    state.moves = snap.moves;
    state.timer = setTimeout(() => { if (root.isConnected) play('board.slow_move'); }, SLOW_MS);
  } else {
    clearTimeout(state.timer);
    state.moves = -1;
  }
}

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
  q('.tg-p.me').dataset.slot = String(me); // 0 = seat A, 1 = seat B: the chip's color never changes between screens
  q('.tg-p.them').dataset.slot = String(1 - me);
  q('.tg-name-me').textContent = `${snap.names[me]} (you)`;
  q('.tg-name-them').textContent = snap.opponentName;
  const setScore = (el, v) => {
    if (v === '' || v === null || v === undefined) { el.textContent = ''; delete el.dataset.n; return; }
    countTo(el, v, {duration: 0.5});
  };
  setScore(q('.tg-score-me'), scores ? scores[me] : '');
  setScore(q('.tg-score-them'), scores ? scores[1 - me] : '');
  const wasMine = q('.tg-p.me').classList.contains('active');
  q('.tg-p.me').classList.toggle('active', snap.myTurn);
  q('.tg-p.them').classList.toggle('active', snap.turn === 1 - me);
  // Your turn again: the chip pops and a soft two-note cue plays (not on the very first render).
  if (snap.myTurn && !wasMine && !snap.over && snap.moves > 0) { pop(q('.tg-p.me'), {scale: 1.12}); synth.blip(740); }
  const status = q('.tg-status');
  const before = status.textContent;
  status.className = 'tg-status';
  if (snap.over) {
    if (snap.over.winner === null) status.textContent = words.draw ?? 'It’s a draw';
    else if (snap.won) { status.textContent = words.won ?? 'You win! 🎉'; status.classList.add('win'); }
    else { status.textContent = words.lost ?? `${snap.opponentName} wins 😬`; status.classList.add('lose'); }
  } else {
    status.textContent = snap.myTurn ? (words.myTurn ?? 'Your move') : (words.theirTurn ?? `${snap.opponentName}’s move…`);
  }
  if (status.textContent !== before) enter(status, {y: 10, scale: 0.9, duration: 0.35});
  watchSlow(root, snap);
  const err = q('.tg-error');
  err.hidden = !snap.error;
  err.textContent = snap.error ?? '';
}

/**
 * Dress a turn game: a theme class on the root (each game styles its own: chalk, toy, graph, felt...), the header
 * chips sliding in, and an opening title card over the board. `theme` also picks the card's look.
 */
export function introduce(root, {theme, title, kicker = '', sub = '', card = 'marker'}) {
  root.classList.add('themed', theme);
  enter(root.querySelectorAll('.tg-head > *'), {y: -14, stagger: 0.08});
  return titleCard(root, {kicker, title, sub, theme: card, hold: 0.8});
}

/** 'p-mine' / 'p-theirs' / '' for a seat value stored in the state. */
export const ownerClass = (seat, snap) => (seat === null || seat === undefined ? '' : seat === snap.seat ? 'p-mine' : 'p-theirs');
