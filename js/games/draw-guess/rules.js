// Draw & Guess rules: pure functions, no DOM. See match.js for the messages.
//
// The drawer picks a secret word (locked in by hash, like Hangman) and draws it; the guesser types guesses
// and the drawer's side answers each one honestly. A right guess scores more the sooner it comes: the guesser
// gets 50 to 100 points, the drawer half of that. After 4 rounds (each player draws twice) the higher score wins.

import {shuffled} from '../../rng.js';
import {WORDS} from './words.js';

export const ROUNDS = 4;
export const ROUND_MS = 60_000;
export const CHOICES = 3;
export const MAX_GUESS_LEN = 40;

/** The canvas is a 1000 x 1000 space whatever the screen size; strokes are stored in it. */
export const CANVAS = 1000;
export const COLOR_COUNT = 6;          // ink, red, blue, green, gold, and paper (the eraser): the view names them
export const WIDTHS = [6, 14, 30];     // thin, medium, thick, in canvas units
export const MAX_STROKES = 400;
export const MAX_STROKE_POINTS = 3000; // points in one stroke

export const letterCount = (word) => word.replace(/ /g, '').length;
/** [3, 5] for "ice cream"-like words: the lengths of each word, shown to the guesser as blanks. */
export const wordShape = (word) => word.split(' ').map((w) => w.length);
export const validWord = (w) => typeof w === 'string' && /^[a-z]+( [a-z]+)?$/.test(w) && w.length <= 24;
export const validShape = (s) => Array.isArray(s) && s.length >= 1 && s.length <= 2 && s.every((n) => Number.isInteger(n) && n >= 1 && n <= 16);

/** Three different words to choose from. `random` is injected so tests can fix it. */
export function pickChoices(random = Math.random, n = CHOICES) {
  return shuffled(WORDS, random).slice(0, n);
}

/** A guess boiled down to its letters and digits, so "Ice-Cream!" matches "ice cream". */
export function normalizeGuess(text) {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Right if it equals the word, or the word with an `s` added or taken off (cat / cats). */
export function isCorrect(guess, word) {
  const g = normalizeGuess(guess);
  const w = normalizeGuess(word);
  return g.length > 0 && (g === w || g === `${w}s` || `${g}s` === w);
}

export function editDistance(a, b) {
  const dp = Array.from({length: a.length + 1}, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/** One letter away from the word (and not right): the guesser hears "so close". */
export function isClose(guess, word) {
  const g = normalizeGuess(guess);
  const w = normalizeGuess(word);
  return w.length >= 4 && g.length > 0 && !isCorrect(guess, word) && editDistance(g, w) === 1;
}

/** Points for a right guess with `remainingMs` left: 50 at the buzzer, up to 100 at the start. */
export function guesserPoints(remainingMs, totalMs = ROUND_MS) {
  const left = Math.max(0, Math.min(totalMs, remainingMs));
  return 50 + Math.round((50 * left) / totalMs);
}
export const drawerPoints = (guesserPts) => Math.round(guesserPts / 2);

/** The drawer's seat in `round` (1-based): they alternate, and who starts comes from the session id. */
export const drawerSeat = (firstSeat, round) => (firstSeat + round - 1) % 2;

/** Is this a well-formed stroke chunk? `p` is x,y,x,y... integers in the canvas space. */
export function validChunk(msg) {
  return Number.isInteger(msg.i) && msg.i >= 0 && msg.i < MAX_STROKES
    && Number.isInteger(msg.c) && msg.c >= 0 && msg.c < COLOR_COUNT
    && Number.isInteger(msg.w) && msg.w >= 0 && msg.w < WIDTHS.length
    && Array.isArray(msg.p) && msg.p.length >= 2 && msg.p.length <= 400 && msg.p.length % 2 === 0
    && msg.p.every((n) => Number.isInteger(n) && n >= 0 && n <= CANVAS);
}

/** Every right/wrong answer the drawer gave, plus the hints, must agree with the word that gets revealed. */
export function answersConsistent(word, guesses, hints) {
  const letters = word.replace(/ /g, '');
  return guesses.every((g) => g.ok === null || g.ok === isCorrect(g.text, word))
    && hints.every((ch, i) => ch == null || letters[i] === ch);
}
