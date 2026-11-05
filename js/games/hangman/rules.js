// Hangman rules: pure functions. The setter picks the word; the guesser calls letters one at a time and
// the setter answers with the positions (see match.js). Everything here is public information, so both
// sides can work out for themselves whether a round is over.

export const MAX_WRONG = 6;
export const MIN_LEN = 3;
export const MAX_LEN = 12;

export const cleanWord = (text) => String(text ?? '').toLowerCase().replace(/[^a-z]/g, '');
export const validWord = (w) => typeof w === 'string' && /^[a-z]+$/.test(w) && w.length >= MIN_LEN && w.length <= MAX_LEN;
export const validLetter = (l) => typeof l === 'string' && /^[a-z]$/.test(l);

/** Positions of `letter` in `word`. */
export const positionsOf = (word, letter) => [...word].flatMap((ch, i) => (ch === letter ? [i] : []));

/**
 * The public state of a round from the length and the guesses so far.
 * @param guesses [{letter, positions}] in order
 * @returns {revealed: (letter|null)[], wrong: letters not in the word, wrongCount, solved, hanged, done}
 */
export function roundState(length, guesses) {
  const revealed = Array(length).fill(null);
  const wrong = [];
  for (const {letter, positions} of guesses) {
    if (positions.length === 0) wrong.push(letter);
    for (const p of positions) revealed[p] = letter;
  }
  const solved = revealed.every((x) => x !== null);
  const hanged = wrong.length >= MAX_WRONG;
  return {revealed, wrong, wrongCount: wrong.length, solved, hanged, done: solved || hanged};
}

/** True if `guesses` (letters with positions) is consistent with `word`. */
export function consistent(word, guesses) {
  return guesses.every((g) => JSON.stringify(positionsOf(word, g.letter)) === JSON.stringify(g.positions));
}
