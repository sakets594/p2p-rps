// Quick Draw match. Rules and fairness notes: rules.js. Messages:
//   ready   {round}              I am ready for this round (both needed, then the standoff starts on both screens)
//   result  {round, early, ms}   what happened at my screen: a false start, my reaction time, or no tap at all
// Both screens work out the winner from the two results, so they agree. The match owns no timer: the view calls
// `update(now)` often (every animation frame) and `tap(now)` when the player fires. Tests use a fake clock.

import {
  MAX_ROUNDS, REACT_TIMEOUT_MS, ROUNDS_TO_WIN, classify, fakeouts, judge, standoffMs, validResult,
} from './rules.js';

export class QuickDrawMatch {
  #session;
  #onChange;
  #seat;
  #round = 1;
  #phase = 'waiting';    // waiting -> standoff -> draw -> shot (I have fired, waiting for their report) -> result
  #readyMine = false;
  #readyTheirs = false;
  #startAt = 0;          // when the standoff began on this screen
  #waitMs = 0;
  #fakes = [];
  #mine = null;          // my result this round
  #theirs = null;
  #scores = [0, 0];
  #last = null;          // {round, winner, results: [seat0, seat1]}
  #finished = false;
  #early = [];
  #clockHint = 0;

  constructor({session, onChange = () => {}}) {
    this.#session = session;
    this.#onChange = onChange;
    this.#seat = session.players.findIndex((p) => p.id === session.selfId);
    session.onMessage = (msg) => this.#onMessage(msg);
  }

  get seat() { return this.#seat; }

  /** When DRAW shows on this screen, on the clock `update` is given. */
  get drawAt() { return this.#startAt + this.#waitMs; }

  snapshot() {
    return {
      round: this.#round,
      toWin: ROUNDS_TO_WIN,
      maxRounds: MAX_ROUNDS,
      seat: this.#seat,
      phase: this.#finished && this.#phase === 'result' ? 'finished' : this.#phase,
      readyMine: this.#readyMine,
      readyTheirs: this.#readyTheirs,
      startAt: this.#startAt,
      waitMs: this.#waitMs,
      drawAt: this.#phase === 'waiting' ? null : this.drawAt,
      fakeouts: this.#fakes,
      mine: this.#mine,
      theirs: this.#theirs,
      scores: [...this.#scores],
      last: this.#last,
      finished: this.#finished,
      names: this.#session.players.map((p) => p.name),
      opponentName: this.#session.players[1 - this.#seat]?.name ?? 'Friend',
      session: this.#session.sid,
    };
  }

  /** Say I am ready for this round's standoff. */
  ready() {
    if (this.#phase !== 'waiting' || this.#readyMine || this.#finished) return;
    this.#readyMine = true;
    this.#session.send({t: 'ready', round: this.#round});
    this.#emit();
  }

  /** The player fired. A tap before DRAW is a false start; after it, it is their reaction time. */
  tap(now) {
    if (this.#mine) return false;
    if (this.#phase === 'standoff' && now >= this.drawAt) this.#phase = 'draw'; // DRAW is due even if no frame has said so yet
    if (this.#phase === 'standoff') return this.#report({early: true, ms: null});
    if (this.#phase === 'draw') return this.#report(classify(now - this.drawAt));
    return false;
  }

  /** Drive the match. Call often with a monotonic clock in ms. */
  update(now) {
    this.#clockHint = now;
    if (this.#phase === 'waiting' && this.#readyMine && this.#readyTheirs) {
      this.#phase = 'standoff';
      this.#startAt = now;
      this.#waitMs = standoffMs(this.#session.sid, this.#round);
      this.#fakes = fakeouts(this.#session.sid, this.#round, this.#waitMs);
      this.#emit();
    }
    if (this.#phase === 'standoff' && now >= this.drawAt) {
      this.#phase = 'draw';
      this.#emit();
    }
    if (this.#phase === 'draw' && !this.#mine && now - this.drawAt > REACT_TIMEOUT_MS) this.#report({early: false, ms: null});
  }

  #report(result) {
    this.#mine = result;
    this.#session.send({t: 'result', round: this.#round, early: result.early, ms: result.ms});
    if (this.#phase === 'standoff' || this.#phase === 'draw') this.#phase = 'shot';
    this.#settle();
    this.#emit();
    return true;
  }

  #settle() {
    if (this.#phase === 'result') return;
    // Their false start decides the round for me at once, even if I have not fired: I will not be early any more.
    if (this.#theirs?.early && !this.#mine) { this.#report({early: false, ms: null}); return; }
    if (!this.#mine || !this.#theirs) return;
    const results = this.#seat === 0 ? [this.#mine, this.#theirs] : [this.#theirs, this.#mine];
    const winner = judge(results[0], results[1]);
    this.#phase = 'result';
    this.#last = {round: this.#round, winner, results};
    if (winner === 0 || winner === 1) this.#scores[winner]++;
    const [a, b] = this.#scores;
    if (a >= ROUNDS_TO_WIN || b >= ROUNDS_TO_WIN || this.#round >= MAX_ROUNDS) this.#finishMatch();
  }

  #finishMatch() {
    if (this.#finished) return;
    this.#finished = true;
    const [a, b] = this.#scores;
    this.#session.finished(a === b ? {} : {winnerId: this.#session.players[a > b ? 0 : 1].id});
  }

  /** After a result: on to the next standoff. */
  nextRound() {
    if (this.#phase !== 'result' || this.#finished) return false;
    this.#round++;
    this.#phase = 'waiting';
    this.#readyMine = this.#readyTheirs = false;
    this.#mine = this.#theirs = null;
    this.#fakes = [];
    const early = this.#early.splice(0);
    for (const m of early) this.#onMessage(m);
    this.#emit();
    return true;
  }

  #onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (Number.isInteger(msg.round) && msg.round > this.#round) {
      if (this.#early.length < 20) this.#early.push(msg);
      return;
    }
    if (msg.round !== this.#round) return;
    if (msg.t === 'ready') {
      if (this.#phase !== 'waiting') return;
      this.#readyTheirs = true;
    } else if (msg.t === 'result') {
      const r = {early: msg.early, ms: msg.ms};
      if (this.#theirs || !validResult(r) || this.#phase === 'waiting' || this.#phase === 'result') return;
      this.#theirs = r.early ? {early: true, ms: null} : {early: false, ms: r.ms === null ? null : Math.round(r.ms)};
      this.#settle();
    }
    this.#emit();
  }

  #emit() { this.#onChange(this.snapshot()); }

  destroy() { this.#session.onMessage = null; }
}
