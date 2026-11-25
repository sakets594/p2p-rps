// Tron match: first to 2 round wins (a round where both crash is replayed, at most 5 rounds in all).
//
// Lockstep: both sides run the same pure simulation (rules.js) and only inputs travel, so the two screens cannot
// disagree about who crashed. Step k needs both players' input for k. Each side sends its input for step k + INPUT_DELAY
// right after finishing step k, and the first INPUT_DELAY steps are "no turn" for both. If the other side's input
// has not arrived the simulation waits for it (the view shows a small "waiting" note), then carries on.
//   ready  {round}                 I am ready for this round (both needed, then a short countdown)
//   in     {round, k, d, hk, h}    my turn for step k (0..3, or null = straight on) and a hash of my state at tick hk
// The hashes are compared when both sides have reached the same tick; a mismatch is reported as "out of sync".
//
// The match owns no timer: the view calls `update(now)` often (every animation frame). Tests call it with a fake clock.

import {
  INPUT_DELAY, MAX_ROUNDS, ROUNDS_TO_WIN, newRound, opposite, stateHash, step, tickMsAt, validDir,
} from './rules.js';

export const COUNT_MS = 700;   // each of the "3, 2, 1" beats
export const COUNT_STEPS = 3;
const MAX_STEP = 4000;         // a round never gets this long; bounds what a stray message can ask for

export class TronMatch {
  #session;
  #onChange;
  #seat;
  #round = 1;
  #phase = 'waiting';       // waiting (for both ready) -> countdown -> playing -> (next round: waiting) | finished
  #readyMine = false;
  #readyTheirs = false;
  #countStart = 0;
  #state = newRound();
  #inputs = new Map();      // step k -> [dir|undefined, dir|undefined] (undefined = not known yet)
  #desired = null;          // the turn I asked for, not yet sent
  #nextAt = 0;
  #stalled = false;
  #hashes = new Map();      // tick -> [mine|undefined, theirs|undefined]
  #scores = [0, 0];
  #last = null;             // {round, winner, crashed, state} of the round that just ended
  #finished = false;
  #error = null;
  #early = [];

  constructor({session, onChange = () => {}}) {
    this.#session = session;
    this.#onChange = onChange;
    this.#seat = session.players.findIndex((p) => p.id === session.selfId);
    session.onMessage = (msg) => this.#onMessage(msg);
    this.#resetRound();
  }

  get seat() { return this.#seat; }

  #resetRound() {
    this.#state = newRound();
    this.#inputs = new Map();
    for (let k = 0; k < INPUT_DELAY; k++) this.#inputs.set(k, [null, null]);
    this.#desired = null;
    this.#hashes = new Map();
    this.#stalled = false;
    this.#readyMine = this.#readyTheirs = false;
    this.#phase = 'waiting';
  }

  snapshot(now = 0) {
    return {
      round: this.#round,
      maxRounds: MAX_ROUNDS,
      toWin: ROUNDS_TO_WIN,
      seat: this.#seat,
      phase: this.#finished ? 'finished' : this.#phase,
      countdown: this.#phase === 'countdown' ? Math.max(1, COUNT_STEPS - Math.floor((now - this.#countStart) / COUNT_MS)) : null,
      state: this.#state,                 // live, read only
      stalled: this.#stalled,
      heading: this.#state.bikes[this.#seat].d,
      readyMine: this.#readyMine,
      readyTheirs: this.#readyTheirs,
      scores: [...this.#scores],
      last: this.#last,
      finished: this.#finished,
      error: this.#error,
      names: this.#session.players.map((p) => p.name),
      opponentName: this.#session.players[1 - this.#seat]?.name ?? 'Friend',
      session: this.#session.sid,
    };
  }

  /** Say I am ready for the round that is about to start. */
  ready() {
    if (this.#phase !== 'waiting' || this.#readyMine || this.#finished) return;
    this.#readyMine = true;
    this.#session.send({t: 'ready', round: this.#round});
    this.#emit();
  }

  /** Ask for a turn to absolute direction `d` (0 up, 1 right, 2 down, 3 left). The latest ask wins. */
  steer(d) {
    if (this.#phase !== 'playing' || !validDir(d)) return false;
    const bike = this.#state.bikes[this.#seat];
    // Not a reversal of where I am going or of what I already asked for.
    const current = this.#desired ?? bike.d;
    if (d === opposite(current)) return false;
    this.#desired = d === bike.d ? null : d;
    return true;
  }

  /** Turn left (-1) or right (+1) of the direction I am heading (or about to head). */
  turn(side) {
    const from = this.#desired ?? this.#state.bikes[this.#seat].d;
    return this.steer((from + (side < 0 ? 3 : 1)) % 4);
  }

  #clockHint = 0;

  /** Drive the match. Call often with a monotonic clock in ms. */
  update(now) {
    this.#clockHint = now;
    if (this.#phase === 'waiting' && this.#readyMine && this.#readyTheirs) {
      this.#phase = 'countdown';
      this.#countStart = now;
      this.#emit();
    }
    if (this.#phase === 'countdown' && now - this.#countStart >= COUNT_STEPS * COUNT_MS) {
      this.#phase = 'playing';
      this.#nextAt = now;
      this.#emit();
    }
    if (this.#phase !== 'playing') return;
    let changed = false;
    // Catch up at most a few ticks per call, so a background tab does not fast-forward the round.
    for (let n = 0; n < 4 && now >= this.#nextAt && this.#phase === 'playing'; n++) {
      const k = this.#state.tick;
      const inputs = this.#inputs.get(k);
      if (!inputs || inputs[0] === undefined || inputs[1] === undefined) {
        if (!this.#stalled) { this.#stalled = true; changed = true; }
        this.#nextAt = now; // go again the moment the missing input arrives
        break;
      }
      this.#stalled = false;
      step(this.#state, inputs);
      this.#inputs.delete(k - 4);
      changed = true;
      const hash = stateHash(this.#state);
      this.#noteHash(this.#state.tick, this.#seat, hash);
      if (this.#state.over) { this.#roundOver(); break; }
      // My input for step k + INPUT_DELAY, with the hash of the state I just reached.
      const d = this.#desired;
      this.#desired = null;
      this.#setInput(k + INPUT_DELAY, this.#seat, d);
      this.#session.send({t: 'in', round: this.#round, k: k + INPUT_DELAY, d, hk: this.#state.tick, h: hash});
      this.#nextAt += tickMsAt(this.#state.tick);
      if (this.#nextAt < now - 250) this.#nextAt = now; // far behind: do not rush
    }
    if (changed) this.#emit();
  }

  #setInput(k, seat, d) {
    const row = this.#inputs.get(k) ?? [undefined, undefined];
    if (row[seat] !== undefined) return false;
    row[seat] = d;
    this.#inputs.set(k, row);
    return true;
  }

  #noteHash(tick, seat, h) {
    const row = this.#hashes.get(tick) ?? [undefined, undefined];
    row[seat] = h;
    this.#hashes.set(tick, row);
    if (row[0] !== undefined && row[1] !== undefined) {
      if (row[0] !== row[1]) this.#error = 'The two screens disagree about the game. Go back to the room and start again.';
      this.#hashes.delete(tick - 8);
    }
  }

  #roundOver() {
    const s = this.#state;
    this.#phase = 'over';
    this.#last = {round: this.#round, winner: s.winner, crashed: [...s.crashed], bikes: s.bikes.map((b) => ({x: b.x, y: b.y}))};
    if (s.winner === 0 || s.winner === 1) this.#scores[s.winner]++;
    const [a, b] = this.#scores;
    if (a >= ROUNDS_TO_WIN || b >= ROUNDS_TO_WIN || this.#round >= MAX_ROUNDS) this.#finishMatch();
  }

  #finishMatch() {
    if (this.#finished) return;
    this.#finished = true;
    const [a, b] = this.#scores;
    this.#session.finished(a === b ? {} : {winnerId: this.#session.players[a > b ? 0 : 1].id});
  }

  /** The round just played stays on screen (`phase: 'over'`) until each player taps for the next one. */
  nextRound() {
    if (this.#phase !== 'over' || this.#finished) return false;
    this.#round++;
    this.#resetRound();
    const early = this.#early.splice(0);
    for (const m of early) this.#onMessage(m);
    this.#emit();
    return true;
  }

  #onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (Number.isInteger(msg.round) && msg.round > this.#round) {
      if (this.#early.length < 40) this.#early.push(msg);
      return;
    }
    if (msg.round !== this.#round) return;
    if (msg.t === 'ready') {
      if (this.#phase !== 'waiting') return;
      this.#readyTheirs = true;
    } else if (msg.t === 'in') {
      const k = msg.k;
      if (!Number.isInteger(k) || k < INPUT_DELAY || k > MAX_STEP || (msg.d !== null && !validDir(msg.d))) return;
      if (k > this.#state.tick + 2 * INPUT_DELAY + 1 || k < this.#state.tick) return; // only the window we can be in
      this.#setInput(k, 1 - this.#seat, msg.d);
      if (Number.isInteger(msg.hk) && Number.isInteger(msg.h)) this.#noteHash(msg.hk, 1 - this.#seat, msg.h >>> 0);
    }
    this.#emit();
  }

  #emit() { this.#onChange(this.snapshot(this.#clockHint)); }

  destroy() { this.#session.onMessage = null; }
}
