// Hangman match. Two rounds; in each, one player is the setter (picks a word) and the other the guesser.
// Roles swap in round 2 so it is fair. The word stays secret but cannot be changed afterwards:
//   word     {round, hash, length}     setter locks the word in (hash of the word plus a secret nonce)
//   guess    {round, n, letter}        guesser calls a letter
//   answer   {round, n, letter, positions}   setter answers honestly from the word
//   reveal   {round, word, nonce}      when the round ends the setter shows the word
//   next     {round}                   each player says they have seen the result (both needed)
// The guesser checks the revealed word against the hash and every answer, so a setter who lied
// (said "no E" when there was one) is caught: `verified: false`.
// A round is won by the guesser if the word is completed, by the setter if 6 letters were wrong.

import {randomNonce, sha256Hex} from '../../crypto.js';
import {firstSeat} from '../../rng.js';
import {MAX_WRONG, cleanWord, consistent, positionsOf, roundState, validLetter, validWord} from './rules.js';

export const ROUNDS = 2;
const HEX64 = /^[0-9a-f]{64}$/;

export class HangmanMatch {
  #session;
  #onChange;
  #seat;
  #epoch = 0;
  #round = 1;
  #word = null; // the real word, only on the setter's side until the reveal
  #nonce = null;
  #hash = null;
  #length = null;
  #guesses = [];
  #pending = null; // letter I called, waiting for the answer
  #revealed = null; // {word, nonce} once shown
  #verified = null;
  #readyMine = false;
  #readyTheirs = false;
  #scores = [0, 0];
  #roundDone = false;
  #finished = false;
  #error = null;
  #early = []; // messages for a later round that arrived early

  constructor({session, onChange = () => {}}) {
    this.#session = session;
    this.#onChange = onChange;
    this.#seat = session.players.findIndex((p) => p.id === session.selfId);
    session.onMessage = (msg) => this.#onMessage(msg);
  }

  get seat() { return this.#seat; }

  #setterSeat(round = this.#round) { return (firstSeat(this.#session.sid) + round - 1) % 2; }

  snapshot() {
    const setter = this.#setterSeat();
    const rs = this.#length ? roundState(this.#length, this.#guesses) : null;
    const done = rs?.done ?? false;
    const reveal = this.#revealed?.word ?? (setter === this.#seat ? this.#word : null);
    return {
      round: this.#round,
      rounds: ROUNDS,
      seat: this.#seat,
      setter,
      iAmSetter: setter === this.#seat,
      phase: !this.#length ? 'choosing' : done ? 'roundover' : 'guessing',
      length: this.#length,
      revealed: rs ? rs.revealed : [],
      wrong: rs ? rs.wrong : [],
      wrongCount: rs ? rs.wrongCount : 0,
      maxWrong: MAX_WRONG,
      guessed: this.#guesses.map((g) => g.letter),
      pending: this.#pending,
      word: reveal, // the full word: the setter always knows it, the guesser once it is shown
      solved: rs?.solved ?? false,
      hanged: rs?.hanged ?? false,
      roundWinner: done ? (rs.solved ? 1 - setter : setter) : null,
      scores: [...this.#scores],
      verified: this.#verified,
      finished: this.#finished,
      readyMine: this.#readyMine,
      error: this.#error,
      names: this.#session.players.map((p) => p.name),
      opponentName: this.#session.players[1 - this.#seat]?.name ?? 'Friend',
      session: this.#session.sid,
    };
  }

  /** Setter: lock in a word. Returns false if it is not allowed. */
  async chooseWord(text) {
    const word = cleanWord(text);
    if (this.#length || this.#setterSeat() !== this.#seat || !validWord(word)) return false;
    const epoch = this.#epoch;
    const nonce = randomNonce();
    const hash = await sha256Hex(`${word}|${nonce}`);
    if (epoch !== this.#epoch || this.#length) return false;
    this.#word = word; this.#nonce = nonce; this.#hash = hash; this.#length = word.length;
    this.#session.send({t: 'word', round: this.#round, hash, length: word.length});
    this.#emit();
    return true;
  }

  /** Guesser: call a letter. */
  guess(letter) {
    const l = String(letter).toLowerCase();
    if (!this.#length || this.#setterSeat() === this.#seat || this.#pending || !validLetter(l)) return false;
    if (roundState(this.#length, this.#guesses).done || this.#guesses.some((g) => g.letter === l)) return false;
    this.#pending = l;
    this.#session.send({t: 'guess', round: this.#round, n: this.#guesses.length + 1, letter: l});
    this.#emit();
    return true;
  }

  /** After a round: say I am ready for the next one (or, after the last, nothing more to do). */
  next() {
    if (!this.#roundDone || this.#readyMine || this.#round >= ROUNDS) return;
    this.#readyMine = true;
    this.#session.send({t: 'next', round: this.#round});
    this.#advance();
    this.#emit();
  }

  #onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (Number.isInteger(msg.round) && msg.round > this.#round) {
      if (this.#early.length < 20) this.#early.push(msg);
      return;
    }
    if (msg.round !== this.#round) return;
    const setter = this.#setterSeat();
    if (msg.t === 'word') {
      if (setter === this.#seat || this.#length || !HEX64.test(msg.hash) || !Number.isInteger(msg.length) || msg.length < 3 || msg.length > 12) return;
      this.#hash = msg.hash; this.#length = msg.length;
    } else if (msg.t === 'guess') {
      if (setter !== this.#seat || !this.#word || !validLetter(msg.letter) || msg.n !== this.#guesses.length + 1) return;
      if (roundState(this.#length, this.#guesses).done || this.#guesses.some((g) => g.letter === msg.letter)) return;
      const positions = positionsOf(this.#word, msg.letter);
      this.#guesses.push({letter: msg.letter, positions});
      this.#session.send({t: 'answer', round: this.#round, n: msg.n, letter: msg.letter, positions});
      this.#maybeEndRound();
    } else if (msg.t === 'answer') {
      if (setter === this.#seat || this.#pending !== msg.letter || !Array.isArray(msg.positions)) return;
      const ok = msg.positions.every((p, i) => Number.isInteger(p) && p >= 0 && p < this.#length && (i === 0 || p > msg.positions[i - 1]));
      if (!ok) return;
      this.#pending = null;
      this.#guesses.push({letter: msg.letter, positions: msg.positions});
      this.#maybeEndRound();
    } else if (msg.t === 'reveal') {
      if (setter === this.#seat || this.#revealed || typeof msg.word !== 'string' || typeof msg.nonce !== 'string') return;
      this.#revealed = {word: msg.word, nonce: msg.nonce};
      this.#verifyReveal();
    } else if (msg.t === 'next') {
      this.#readyTheirs = true;
      this.#advance();
    }
    this.#emit();
  }

  #maybeEndRound() {
    const rs = roundState(this.#length, this.#guesses);
    if (!rs.done || this.#roundDone) return;
    this.#roundDone = true;
    const setter = this.#setterSeat();
    this.#scores[rs.solved ? 1 - setter : setter]++;
    if (setter === this.#seat) this.#session.send({t: 'reveal', round: this.#round, word: this.#word, nonce: this.#nonce});
    if (this.#round >= ROUNDS) this.#finishMatch();
  }

  async #verifyReveal() {
    const {word, nonce} = this.#revealed;
    const epoch = this.#epoch;
    const hash = validWord(word) ? await sha256Hex(`${word}|${nonce}`) : null;
    if (epoch !== this.#epoch) return;
    const ok = hash === this.#hash && word.length === this.#length && consistent(word, this.#guesses);
    this.#verified = ok;
    if (!ok) this.#error = `${this.#session.players[1 - this.#seat].name}’s answers did not match their word. They may have cheated.`;
    this.#emit();
  }

  #finishMatch() {
    if (this.#finished) return;
    this.#finished = true;
    const [a, b] = this.#scores;
    this.#session.finished(a === b ? {} : {winnerId: this.#session.players[a > b ? 0 : 1].id});
  }

  #advance() {
    if (!this.#roundDone || !this.#readyMine || !this.#readyTheirs || this.#round >= ROUNDS) return;
    this.#round++;
    this.#word = this.#nonce = this.#hash = this.#length = this.#pending = this.#revealed = this.#verified = null;
    this.#guesses = [];
    this.#readyMine = this.#readyTheirs = this.#roundDone = false;
    const early = this.#early.splice(0);
    for (const m of early) this.#onMessage(m);
  }

  #emit() { this.#onChange(this.snapshot()); }

  destroy() {
    this.#epoch++;
    this.#session.onMessage = null;
  }
}
