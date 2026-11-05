// Memory Match rules for TurnMatch. PAIRS pairs are shuffled from the session id, so both browsers lay
// the cards out the same way without sending the layout. A move is a card index; two flips make a turn.
// A match scores and keeps the turn; a miss shows both cards (`peek`) and passes the turn.
// state: {cards: symbol per position, matched: seat | null per card, up: indexes face up this turn,
//         peek: the two cards of the last miss (view hides them after a moment), turn, scores}

import {seededRandom, shuffled} from '../../rng.js';

export const SYMBOLS = ['🐶', '🐱', '🦊', '🐼', '🐸', '🦁', '🐙', '🦄', '🍕', '🚀'];
export const PAIRS = SYMBOLS.length;

export const memoryRules = {
  create({seed, first}) {
    const cards = shuffled(SYMBOLS.flatMap((s) => [s, s]), seededRandom(`${seed}:memory`));
    return {cards, matched: Array(cards.length).fill(null), up: [], peek: [], turn: first, scores: [0, 0]};
  },
  turn: (s) => s.turn,
  legal: (s, seat, i) => Number.isInteger(i) && i >= 0 && i < s.cards.length && s.matched[i] === null && !s.up.includes(i),
  apply(s, seat, i) {
    const n = {cards: s.cards, matched: [...s.matched], up: [...s.up, i], peek: [], turn: s.turn, scores: [...s.scores]};
    if (n.up.length < 2) return n;
    const [a, b] = n.up;
    n.up = [];
    if (s.cards[a] === s.cards[b]) {
      n.matched[a] = n.matched[b] = seat;
      n.scores[seat]++;
    } else {
      n.peek = [a, b];
      n.turn = 1 - seat;
    }
    return n;
  },
  outcome(s) {
    if (s.scores[0] + s.scores[1] < PAIRS) return null;
    return {winner: s.scores[0] === s.scores[1] ? null : s.scores[0] > s.scores[1] ? 0 : 1};
  },
};
