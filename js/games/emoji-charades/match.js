// Emoji Charades match. Four rounds; in each, one player describes a secret phrase using only emoji and the
// other guesses it. Roles alternate. Messages (all carry `round`):
//   word    {hash, shape, cat, ms, bye}   describer locks the phrase in (hash of phrase + secret nonce) and starts the clock;
//                                         `cat` is the clue ("Movie"), `bye` the scoring flag (only read in round 1)
//   emoji   {seq, used}                   what is on screen now, and how many emoji have been used in total (taken-back ones count)
//   hint    {i, ch}                       a letter is revealed (at half time and three quarters)
//   guess   {n, text}                     guesser tries a phrase
//   answer  {n, ok, close, pts}           describer's side answers honestly; a right answer carries the guesser's points
//   end     {reason, word, nonce}         round over (solved, time or skip): the phrase is revealed and checked against the hash
//   next    {}                            each player says they have seen the result (both needed)
// Scoring flag `scoreByEmoji` (default on): points come from how few emoji were used (rules.js emojiPoints). Off: from how
// fast the guess came (50 to 100). The describer always gets half of the guesser's points.

import {randomNonce, sha256Hex} from '../../crypto.js';
import {firstSeat} from '../../rng.js';
import {MAX_SHOWN, MAX_USED, PALETTE} from './emoji.js';
import {
  MAX_GUESS_LEN, ROUNDS, ROUND_MS, answersConsistent, drawerPoints, drawerSeat, emojiPoints, guesserPoints, isClose, isCorrect,
  letterCount, phraseShape, pickChoices, validCat, validPhrase, validSequence, validShape, validUsed,
} from './rules.js';

export {ROUNDS, ROUND_MS};
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_GUESSES = 200;

const realClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};

export class EmojiCharadesMatch {
  #session;
  #onChange;
  #seat;
  #random;
  #clock;
  #roundMs;
  #epoch = 0;
  #round = 1;
  #byEmoji = true;       // the scoring flag
  #choices = null;       // phrases offered to the describer (their side only)
  #phrase = null;        // the real phrase, only on the describer's side until the reveal
  #cat = null;
  #nonce = null;
  #hash = null;
  #shape = null;
  #ms = ROUND_MS;
  #deadline = null;
  #timers = [];
  #seq = [];             // emoji on screen
  #used = 0;             // emoji added this round, taken-back ones included
  #hints = [];
  #guesses = [];
  #solved = false;
  #points = 0;
  #reveal = null;
  #verified = null;
  #roundDone = false;
  #reason = null;
  #readyMine = false;
  #readyTheirs = false;
  #scores = [0, 0];
  #finished = false;
  #error = null;
  #early = [];

  constructor({session, onChange = () => {}, scoreByEmoji = true, random = Math.random, clock = realClock, roundMs = ROUND_MS}) {
    this.#session = session;
    this.#onChange = onChange;
    this.#byEmoji = scoreByEmoji;
    this.#random = random;
    this.#clock = clock;
    this.#roundMs = roundMs;
    this.#seat = session.players.findIndex((p) => p.id === session.selfId);
    session.onMessage = (msg) => this.#onMessage(msg);
    this.#startRound();
  }

  get seat() { return this.#seat; }

  #describer(round = this.#round) { return drawerSeat(firstSeat(this.#session.sid, 'emoji'), round); }
  #iDescribe() { return this.#describer() === this.#seat; }

  #startRound() {
    this.#choices = this.#iDescribe() ? pickChoices(this.#random) : null;
    this.#phrase = this.#cat = this.#nonce = this.#hash = this.#shape = this.#deadline = this.#reveal = this.#verified = this.#reason = null;
    this.#seq = [];
    this.#used = 0;
    this.#hints = [];
    this.#guesses = [];
    this.#solved = false;
    this.#points = 0;
    this.#roundDone = false;
    this.#readyMine = this.#readyTheirs = false;
    this.#clearTimers();
  }

  #clearTimers() {
    for (const id of this.#timers) this.#clock.clearTimeout(id);
    this.#timers = [];
  }

  snapshot() {
    const describer = this.#describer();
    const iDescribe = describer === this.#seat;
    return {
      round: this.#round,
      rounds: ROUNDS,
      seat: this.#seat,
      describer,
      iDescribe,
      scoreByEmoji: this.#byEmoji,
      flagLocked: this.#round > 1 || !!this.#shape,   // the flag can only be changed by the first describer before they pick
      canSetFlag: this.#round === 1 && iDescribe && !this.#shape,
      phase: !this.#shape ? 'choosing' : this.#roundDone ? 'roundover' : 'playing',
      choices: iDescribe && !this.#shape ? this.#choices : null,
      shape: this.#shape,
      cat: this.#cat,
      hints: this.#hints,
      phrase: this.#reveal?.word ?? (iDescribe ? this.#phrase : null),
      seq: this.#seq,
      used: this.#used,
      guesses: this.#guesses,
      deadline: this.#deadline,
      durationMs: this.#ms,
      solved: this.#solved,
      points: this.#points,
      reason: this.#reason,
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

  // --- describer ------------------------------------------------------------------------------

  /** First describer, before picking: turn "fewer emoji = more points" on or off. */
  setScoring(on) {
    if (this.#round !== 1 || !this.#iDescribe() || this.#shape) return false;
    this.#byEmoji = !!on;
    this.#emit();
    return true;
  }

  /** Describer: lock in one of the offered phrases and start the clock. */
  async chooseWord(text) {
    const choice = this.#choices?.find((c) => c.text === text);
    if (this.#shape || !this.#iDescribe() || !choice || !validPhrase(text)) return false;
    const epoch = this.#epoch;
    const round = this.#round;
    const nonce = randomNonce();
    const hash = await sha256Hex(`${text}|${nonce}`);
    if (epoch !== this.#epoch || round !== this.#round || this.#shape) return false;
    this.#phrase = text; this.#cat = choice.cat; this.#nonce = nonce; this.#hash = hash; this.#shape = phraseShape(text); this.#ms = this.#roundMs;
    this.#hints = new Array(letterCount(text)).fill(null);
    this.#deadline = this.#clock.now() + this.#ms;
    this.#session.send({t: 'word', round, hash, shape: this.#shape, cat: this.#cat, ms: this.#ms, bye: this.#byEmoji});
    this.#timers.push(this.#clock.setTimeout(() => this.#endRound('time'), this.#ms));
    this.#timers.push(this.#clock.setTimeout(() => this.#giveHint(), this.#ms * 0.5));
    this.#timers.push(this.#clock.setTimeout(() => this.#giveHint(), this.#ms * 0.75));
    this.#emit();
    return true;
  }

  #describing() { return this.#iDescribe() && !!this.#shape && !this.#roundDone; }

  #sendSeq() { this.#session.send({t: 'emoji', round: this.#round, seq: this.#seq, used: this.#used}); }

  /** Describer: add an emoji from the palette. */
  addEmoji(e) {
    if (!this.#describing() || !PALETTE.has(e) || this.#seq.length >= MAX_SHOWN || this.#used >= MAX_USED) return false;
    this.#seq = [...this.#seq, e];
    this.#used++;
    this.#sendSeq();
    this.#emit();
    return true;
  }

  /** Describer: take back the last emoji (it still counts as used). */
  removeLast() {
    if (!this.#describing() || !this.#seq.length) return false;
    this.#seq = this.#seq.slice(0, -1);
    this.#sendSeq();
    this.#emit();
    return true;
  }

  clearEmoji() {
    if (!this.#describing() || !this.#seq.length) return false;
    this.#seq = [];
    this.#sendSeq();
    this.#emit();
    return true;
  }

  /** Describer: give up on this phrase (nobody scores). */
  skip() {
    if (!this.#describing()) return false;
    this.#endRound('skip');
    return true;
  }

  #giveHint() {
    if (!this.#describing()) return;
    const hidden = this.#hints.flatMap((h, i) => (h === null ? [i] : []));
    if (hidden.length <= 2) return;
    const i = hidden[Math.floor(this.#random() * hidden.length)];
    const ch = this.#phrase.replace(/ /g, '')[i];
    this.#hints[i] = ch;
    this.#session.send({t: 'hint', round: this.#round, i, ch});
    this.#emit();
  }

  #endRound(reason) {
    if (this.#roundDone || !this.#shape || !this.#iDescribe()) return;
    this.#clearTimers();
    this.#roundDone = true;
    this.#reason = reason;
    this.#reveal = {word: this.#phrase};
    this.#session.send({t: 'end', round: this.#round, reason, word: this.#phrase, nonce: this.#nonce});
    if (this.#round >= ROUNDS) this.#finishMatch();
    this.#emit();
  }

  // --- guesser --------------------------------------------------------------------------------

  guess(text) {
    const t = String(text ?? '').trim().slice(0, MAX_GUESS_LEN);
    if (!t || this.#iDescribe() || !this.#shape || this.#roundDone || this.#guesses.length >= MAX_GUESSES) return false;
    const n = this.#guesses.length + 1;
    this.#guesses.push({n, text: t, ok: null, close: false});
    this.#session.send({t: 'guess', round: this.#round, n, text: t});
    this.#emit();
    return true;
  }

  // --- both -----------------------------------------------------------------------------------

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
      if (this.#early.length < 40) this.#early.push(msg);
      return;
    }
    if (msg.round !== this.#round) return;
    if (this.#iDescribe()) {
      if (msg.t === 'guess') this.#onGuess(msg);
      else if (msg.t === 'next') { this.#readyTheirs = true; this.#advance(); }
    } else if (msg.t === 'word') {
      if (this.#shape || !HEX64.test(msg.hash) || !validShape(msg.shape) || !validCat(msg.cat) || !Number.isInteger(msg.ms) || msg.ms < 2_000 || msg.ms > 300_000) return;
      if (this.#round === 1 && typeof msg.bye === 'boolean') this.#byEmoji = msg.bye;
      this.#hash = msg.hash; this.#shape = msg.shape; this.#cat = msg.cat; this.#ms = msg.ms;
      this.#hints = new Array(msg.shape.reduce((a, b) => a + b, 0)).fill(null);
      this.#deadline = this.#clock.now() + msg.ms;
    } else if (!this.#shape || this.#roundDone && msg.t !== 'next') {
      return;
    } else if (msg.t === 'emoji') {
      if (validSequence(msg.seq) && validUsed(msg.used, msg.seq) && msg.used >= this.#used) { this.#seq = msg.seq; this.#used = msg.used; }
    } else if (msg.t === 'hint') {
      if (Number.isInteger(msg.i) && msg.i >= 0 && msg.i < this.#hints.length && typeof msg.ch === 'string' && /^[a-z0-9]$/.test(msg.ch)) this.#hints[msg.i] = msg.ch;
    } else if (msg.t === 'answer') {
      this.#onAnswer(msg);
    } else if (msg.t === 'end') {
      this.#onEnd(msg);
    } else if (msg.t === 'next') {
      this.#readyTheirs = true;
      this.#advance();
    }
    this.#emit();
  }

  #onGuess(msg) {
    if (!this.#shape || this.#roundDone || typeof msg.text !== 'string' || msg.text.length > MAX_GUESS_LEN) return;
    if (msg.n !== this.#guesses.length + 1 || this.#guesses.length >= MAX_GUESSES) return;
    const ok = isCorrect(msg.text, this.#phrase);
    const close = !ok && isClose(msg.text, this.#phrase);
    this.#guesses.push({n: msg.n, text: msg.text, ok, close});
    const answer = {t: 'answer', round: this.#round, n: msg.n, ok, close};
    if (ok) {
      answer.pts = this.#byEmoji ? emojiPoints(this.#used) : guesserPoints(this.#deadline - this.#clock.now(), this.#ms);
      this.#score(answer.pts);
    }
    this.#session.send(answer);
    if (ok) this.#endRound('solved');
  }

  #onAnswer(msg) {
    const g = this.#guesses[msg.n - 1];
    if (!g || g.ok !== null || typeof msg.ok !== 'boolean') return;
    g.ok = msg.ok;
    g.close = msg.ok ? false : msg.close === true;
    if (msg.ok) {
      if (!Number.isInteger(msg.pts) || msg.pts < 20 || msg.pts > 100) return;
      this.#score(msg.pts);
    }
  }

  #score(pts) {
    this.#solved = true;
    this.#points = pts;
    this.#scores[1 - this.#describer()] += pts;
    this.#scores[this.#describer()] += drawerPoints(pts);
  }

  #onEnd(msg) {
    if (this.#roundDone || typeof msg.word !== 'string' || typeof msg.nonce !== 'string' || !validPhrase(msg.word)) return;
    this.#roundDone = true;
    this.#reason = ['solved', 'time', 'skip'].includes(msg.reason) ? msg.reason : 'time';
    this.#reveal = {word: msg.word};
    this.#clearTimers();
    this.#verifyReveal(msg.word, msg.nonce);
    if (this.#round >= ROUNDS) this.#finishMatch();
  }

  async #verifyReveal(word, nonce) {
    const epoch = this.#epoch;
    const round = this.#round;
    const hash = await sha256Hex(`${word}|${nonce}`);
    if (epoch !== this.#epoch || round !== this.#round) return;
    const ok = hash === this.#hash
      && JSON.stringify(phraseShape(word)) === JSON.stringify(this.#shape)
      && answersConsistent(word, this.#guesses, this.#hints)
      && (this.#reason !== 'solved' || this.#solved);
    this.#verified = ok;
    if (!ok) this.#error = `${this.#session.players[1 - this.#seat].name}’s answers did not match their phrase. They may have cheated.`;
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
    this.#startRound();
    const early = this.#early.splice(0);
    for (const m of early) this.#onMessage(m);
  }

  #emit() { this.#onChange(this.snapshot()); }

  destroy() {
    this.#epoch++;
    this.#clearTimers();
    this.#session.onMessage = null;
  }
}
