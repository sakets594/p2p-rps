// Draw & Guess match. Four rounds; in each, one player draws a secret word and the other guesses it.
// Roles alternate, so each player draws twice. Messages (all carry `round`):
//   word    {hash, shape, ms}       drawer locks the word in (hash of word + secret nonce) and starts the clock
//   stroke  {i, c, w, p, done}      drawer: more points of stroke number i (colour, width, then x,y,x,y...)
//   undo / clear                    drawer takes back the last stroke / wipes the canvas
//   hint    {i, ch}                 drawer reveals letter i (twice per round, at half time and at three quarters)
//   guess   {n, text}               guesser tries a word
//   answer  {n, ok, close, pts}     drawer's side answers honestly; a right answer carries the guesser's points
//   end     {reason, word, nonce}   round over (solved, time or skip): the word is revealed and the guesser checks
//                                   it against the hash and against every answer and hint it was given
//   next    {}                      each player says they have seen the result (both needed)
// The drawer's clock decides when time is up, so a slow connection cannot stretch a round.

import {randomNonce, sha256Hex} from '../../crypto.js';
import {firstSeat} from '../../rng.js';
import {
  CANVAS, MAX_GUESS_LEN, MAX_STROKES, MAX_STROKE_POINTS, ROUNDS, ROUND_MS, WIDTHS,
  answersConsistent, drawerPoints, drawerSeat, guesserPoints, isClose, isCorrect, letterCount, pickChoices, validChunk,
  validShape, validWord, wordShape,
} from './rules.js';

export {ROUNDS, ROUND_MS};
const HEX64 = /^[0-9a-f]{64}$/;
const FLUSH_MS = 50;
const MAX_GUESSES = 200;

const realClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};

export class DrawGuessMatch {
  #session;
  #onChange;
  #seat;
  #mode;
  #random;
  #clock;
  #roundMs;
  #epoch = 0;
  #round = 1;
  #choices = null;       // the three words offered to the drawer (drawer's side only)
  #word = null;          // the real word, only on the drawer's side until the reveal
  #nonce = null;
  #hash = null;
  #shape = null;
  #ms = ROUND_MS;
  #deadline = null;      // when time is up, on this device's clock
  #timers = [];
  #strokes = [];         // [{c, w, p: [x, y, ...]}]
  #canvasRev = 0;        // bumps when strokes are taken away, so a view knows to repaint from scratch
  #open = null;          // index of the stroke the drawer is in the middle of
  #queued = [];          // points of that stroke not sent yet
  #flushTimer = null;
  #hints = [];
  #guesses = [];         // [{n, text, ok, close}]
  #solved = false;
  #points = 0;           // what the guesser got for the right answer
  #reveal = null;        // {word} once shown
  #verified = null;
  #roundDone = false;
  #reason = null;
  #readyMine = false;
  #readyTheirs = false;
  #scores = [0, 0];
  #finished = false;
  #error = null;
  #early = [];

  constructor({session, onChange = () => {}, mode = 'classic', random = Math.random, clock = realClock, roundMs = ROUND_MS}) {
    this.#session = session;
    this.#onChange = onChange;
    this.#mode = mode;
    this.#random = random;
    this.#clock = clock;
    this.#roundMs = roundMs;
    this.#seat = session.players.findIndex((p) => p.id === session.selfId);
    session.onMessage = (msg) => this.#onMessage(msg);
    this.#startRound();
  }

  get seat() { return this.#seat; }

  #drawer(round = this.#round) { return drawerSeat(firstSeat(this.#session.sid), round); }
  #iDraw() { return this.#drawer() === this.#seat; }

  #startRound() {
    this.#choices = this.#iDraw() ? pickChoices(this.#random) : null;
    this.#word = this.#nonce = this.#hash = this.#shape = this.#deadline = this.#reveal = this.#verified = this.#reason = null;
    this.#strokes = [];
    this.#canvasRev++;
    this.#open = null;
    this.#queued = [];
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
    if (this.#flushTimer !== null) this.#clock.clearTimeout(this.#flushTimer);
    this.#flushTimer = null;
  }

  snapshot() {
    const drawer = this.#drawer();
    const iDraw = drawer === this.#seat;
    return {
      mode: this.#mode,
      round: this.#round,
      rounds: ROUNDS,
      seat: this.#seat,
      drawer,
      iDraw,
      phase: !this.#shape ? 'choosing' : this.#roundDone ? 'roundover' : 'drawing',
      choices: iDraw && !this.#shape ? this.#choices : null,
      shape: this.#shape,
      hints: this.#hints,
      word: this.#reveal?.word ?? (iDraw ? this.#word : null), // the full word: the drawer always knows it, the guesser once it is shown
      strokes: this.#strokes,   // live array, read only; see canvasRev
      canvasRev: this.#canvasRev,
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

  // --- drawer ---------------------------------------------------------------------------------

  /** Drawer: lock in one of the offered words and start the clock. */
  async chooseWord(word) {
    if (this.#shape || !this.#iDraw() || !this.#choices?.includes(word) || !validWord(word)) return false;
    const epoch = this.#epoch;
    const round = this.#round;
    const nonce = randomNonce();
    const hash = await sha256Hex(`${word}|${nonce}`);
    if (epoch !== this.#epoch || round !== this.#round || this.#shape) return false;
    this.#word = word; this.#nonce = nonce; this.#hash = hash; this.#shape = wordShape(word); this.#ms = this.#roundMs;
    this.#hints = new Array(letterCount(word)).fill(null);
    this.#deadline = this.#clock.now() + this.#ms;
    this.#session.send({t: 'word', round, hash, shape: this.#shape, ms: this.#ms});
    this.#timers.push(this.#clock.setTimeout(() => this.#endRound('time'), this.#ms));
    this.#timers.push(this.#clock.setTimeout(() => this.#giveHint(), this.#ms * 0.5));
    this.#timers.push(this.#clock.setTimeout(() => this.#giveHint(), this.#ms * 0.75));
    this.#emit();
    return true;
  }

  #drawing() { return this.#iDraw() && !!this.#shape && !this.#roundDone; }

  /** Drawer: put the pen down. Colour 0..5, width 0..2, position in the 1000 x 1000 canvas. */
  beginStroke(c, w, x, y) {
    if (!this.#drawing() || this.#strokes.length >= MAX_STROKES) return false;
    this.endStroke();
    const stroke = {c, w, p: []};
    if (!validChunk({i: 0, c, w, p: [clamp(x), clamp(y)]})) return false;
    this.#strokes.push(stroke);
    this.#open = this.#strokes.length - 1;
    this.#addPoint(stroke, x, y);
    this.#emit();
    return true;
  }

  extendStroke(x, y) {
    if (this.#open === null || !this.#drawing()) return false;
    return this.#addPoint(this.#strokes[this.#open], x, y);
  }

  #addPoint(stroke, x, y) {
    if (stroke.p.length >= MAX_STROKE_POINTS * 2) return false;
    const px = clamp(x); const py = clamp(y);
    stroke.p.push(px, py);
    this.#queued.push(px, py);
    if (this.#queued.length >= 100) this.#flush(false);
    else if (this.#flushTimer === null) this.#flushTimer = this.#clock.setTimeout(() => { this.#flushTimer = null; this.#flush(false); }, FLUSH_MS);
    return true;
  }

  /** Drawer: lift the pen. */
  endStroke() {
    if (this.#open === null) return;
    this.#flush(true);
    this.#open = null;
    this.#emit();
  }

  #flush(done) {
    if (this.#flushTimer !== null) { this.#clock.clearTimeout(this.#flushTimer); this.#flushTimer = null; }
    if (this.#open === null) { this.#queued = []; return; }
    const stroke = this.#strokes[this.#open];
    // Chunks of at most 200 points (400 numbers) fit the receiver's limit.
    while (this.#queued.length > 0 || done) {
      const chunk = this.#queued.splice(0, 400);
      const last = this.#queued.length === 0;
      if (chunk.length) this.#session.send({t: 'stroke', round: this.#round, i: this.#open, c: stroke.c, w: stroke.w, p: chunk, done: done && last});
      if (last) break;
    }
  }

  /** Drawer: take back the last stroke. */
  undo() {
    if (!this.#drawing() || !this.#strokes.length) return false;
    this.endStroke();
    this.#strokes.pop();
    this.#canvasRev++;
    this.#session.send({t: 'undo', round: this.#round});
    this.#emit();
    return true;
  }

  /** Drawer: wipe the canvas. */
  clear() {
    if (!this.#drawing() || !this.#strokes.length) return false;
    this.endStroke();
    this.#strokes = [];
    this.#canvasRev++;
    this.#session.send({t: 'clear', round: this.#round});
    this.#emit();
    return true;
  }

  /** Drawer: give up on this word (nobody scores). */
  skip() {
    if (!this.#drawing()) return false;
    this.#endRound('skip');
    return true;
  }

  #giveHint() {
    if (!this.#drawing()) return;
    const hidden = this.#hints.flatMap((h, i) => (h === null ? [i] : []));
    if (hidden.length <= 2) return; // never give away nearly everything
    const i = hidden[Math.floor(this.#random() * hidden.length)];
    const ch = this.#word.replace(/ /g, '')[i];
    this.#hints[i] = ch;
    this.#session.send({t: 'hint', round: this.#round, i, ch});
    this.#emit();
  }

  #endRound(reason) {
    if (this.#roundDone || !this.#shape || !this.#iDraw()) return;
    this.endStroke();
    this.#clearTimers();
    this.#roundDone = true;
    this.#reason = reason;
    this.#reveal = {word: this.#word};
    this.#session.send({t: 'end', round: this.#round, reason, word: this.#word, nonce: this.#nonce});
    if (this.#round >= ROUNDS) this.#finishMatch();
    this.#emit();
  }

  // --- guesser --------------------------------------------------------------------------------

  /** Guesser: try a word. */
  guess(text) {
    const t = String(text ?? '').trim().slice(0, MAX_GUESS_LEN);
    if (!t || this.#iDraw() || !this.#shape || this.#roundDone || this.#guesses.length >= MAX_GUESSES) return false;
    const n = this.#guesses.length + 1;
    this.#guesses.push({n, text: t, ok: null, close: false});
    this.#session.send({t: 'guess', round: this.#round, n, text: t});
    this.#emit();
    return true;
  }

  // --- both -----------------------------------------------------------------------------------

  /** After a round: say I am ready for the next one. */
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
    const iDraw = this.#iDraw();
    if (iDraw) {
      if (msg.t === 'guess') this.#onGuess(msg);
      else if (msg.t === 'next') { this.#readyTheirs = true; this.#advance(); }
    } else if (msg.t === 'word') {
      if (this.#shape || !HEX64.test(msg.hash) || !validShape(msg.shape) || !Number.isInteger(msg.ms) || msg.ms < 2_000 || msg.ms > 180_000) return;
      this.#hash = msg.hash; this.#shape = msg.shape; this.#ms = msg.ms;
      this.#hints = new Array(msg.shape.reduce((a, b) => a + b, 0)).fill(null);
      this.#deadline = this.#clock.now() + msg.ms;
    } else if (!this.#shape || this.#roundDone && msg.t !== 'next') {
      return;
    } else if (msg.t === 'stroke') {
      this.#onStroke(msg);
    } else if (msg.t === 'undo') {
      if (this.#strokes.length) { this.#strokes.pop(); this.#canvasRev++; }
    } else if (msg.t === 'clear') {
      this.#strokes = []; this.#canvasRev++;
    } else if (msg.t === 'hint') {
      if (Number.isInteger(msg.i) && msg.i >= 0 && msg.i < this.#hints.length && typeof msg.ch === 'string' && /^[a-z]$/.test(msg.ch)) this.#hints[msg.i] = msg.ch;
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

  #onStroke(msg) {
    if (!validChunk(msg)) return;
    let stroke = this.#strokes[msg.i];
    if (!stroke) {
      if (msg.i !== this.#strokes.length) return; // strokes arrive in order
      stroke = {c: msg.c, w: msg.w, p: []};
      this.#strokes.push(stroke);
    }
    if (stroke.p.length + msg.p.length > MAX_STROKE_POINTS * 2) return;
    stroke.p.push(...msg.p);
  }

  #onGuess(msg) {
    if (!this.#shape || this.#roundDone || typeof msg.text !== 'string' || msg.text.length > MAX_GUESS_LEN) return;
    if (msg.n !== this.#guesses.length + 1 || this.#guesses.length >= MAX_GUESSES) return;
    const ok = isCorrect(msg.text, this.#word);
    const close = !ok && isClose(msg.text, this.#word);
    this.#guesses.push({n: msg.n, text: msg.text, ok, close});
    const answer = {t: 'answer', round: this.#round, n: msg.n, ok, close};
    if (ok) {
      answer.pts = guesserPoints(this.#deadline - this.#clock.now(), this.#ms);
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
      if (!Number.isInteger(msg.pts) || msg.pts < 50 || msg.pts > 100) return;
      this.#score(msg.pts);
    }
  }

  #score(pts) {
    this.#solved = true;
    this.#points = pts;
    this.#scores[1 - this.#drawer()] += pts;
    this.#scores[this.#drawer()] += drawerPoints(pts);
  }

  #onEnd(msg) {
    if (this.#roundDone || typeof msg.word !== 'string' || typeof msg.nonce !== 'string' || !validWord(msg.word)) return;
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
      && JSON.stringify(wordShape(word)) === JSON.stringify(this.#shape)
      && answersConsistent(word, this.#guesses, this.#hints)
      && (this.#reason !== 'solved' || this.#solved);
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

const clamp = (n) => Math.max(0, Math.min(CANVAS, Math.round(Number.isFinite(n) ? n : 0)));
export {WIDTHS};
