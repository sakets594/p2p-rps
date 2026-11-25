// Emoji Charades rules: pure functions, no DOM. See match.js for the messages.
//
// One player (the describer) gets a secret phrase and may only use emoji; the other types guesses.
// A right guess scores by speed (50 to 100), or, with the "fewer emoji" flag on, by how many emoji were used.

import {shuffled} from '../../rng.js';
import {editDistance, normalizeGuess} from '../draw-guess/rules.js';
import {PALETTE, MAX_SHOWN, MAX_USED} from './emoji.js';
import {CATEGORIES, PHRASES} from './phrases.js';

export {guesserPoints, drawerPoints, drawerSeat, MAX_GUESS_LEN} from '../draw-guess/rules.js';
export const ROUNDS = 4;
export const ROUND_MS = 75_000;
export const CHOICES = 3;

export const validPhrase = (t) => typeof t === 'string' && /^[a-z0-9]+( [a-z0-9]+){0,3}$/.test(t) && t.length <= 30;
export const validCat = (c) => typeof c === 'string' && Object.hasOwn(CATEGORIES, c);
export const letterCount = (text) => text.replace(/ /g, '').length;
export const phraseShape = (text) => text.split(' ').map((w) => w.length);
export const validShape = (s) => Array.isArray(s) && s.length >= 1 && s.length <= 4 && s.every((n) => Number.isInteger(n) && n >= 1 && n <= 16);

/** Three phrases, each from a different category. */
export function pickChoices(random = Math.random, n = CHOICES) {
  const cats = shuffled(Object.keys(CATEGORIES), random).slice(0, n);
  return cats.map((cat) => shuffled(PHRASES.filter((p) => p.cat === cat), random)[0]);
}

/** A leading "the" or "a" does not matter ("lion king" and "the lion king" are the same guess). */
function core(text) {
  const n = String(text ?? '').toLowerCase().replace(/^\s*(the|a|an)\s+/, '');
  return normalizeGuess(n);
}

export function isCorrect(guess, phrase) {
  const g = core(guess);
  const w = core(phrase);
  return g.length > 0 && (g === w || g === `${w}s` || `${g}s` === w);
}

export function isClose(guess, phrase) {
  const g = core(guess);
  const w = core(phrase);
  return w.length >= 4 && g.length > 0 && !isCorrect(guess, phrase) && editDistance(g, w) === 1;
}

/** With the flag on: 100 points for three emoji or fewer, 10 less for each extra, never below 20. */
export function emojiPoints(used) {
  return Math.max(20, 100 - 10 * Math.max(0, used - 3));
}

/** A shown sequence is well formed if it is a short list of palette emoji. */
export function validSequence(seq) {
  return Array.isArray(seq) && seq.length <= MAX_SHOWN && seq.every((e) => typeof e === 'string' && PALETTE.has(e));
}
export const validUsed = (used, seq) => Number.isInteger(used) && used >= seq.length && used <= MAX_USED;

export function answersConsistent(phrase, guesses, hints) {
  const letters = phrase.replace(/ /g, '');
  return guesses.every((g) => g.ok === null || g.ok === isCorrect(g.text, phrase))
    && hints.every((ch, i) => ch == null || letters[i] === ch);
}
