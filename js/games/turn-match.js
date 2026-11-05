// Shared engine for turn-based games where both players can see everything (Tic-Tac-Toe, Connect Four,
// Dots and Boxes, Memory Match). Both browsers hold the same state and apply the same moves with the same
// pure rules, so only the moves travel. A move that is illegal or out of turn is ignored and reported.
//
// `rules` is a plain object (no DOM, no network), so each game's rules are easy to unit test:
//   create({seed, first})        the starting state; `first` is the seat (0 or 1) that moves first
//   turn(state)                  seat (0 or 1) whose move it is
//   legal(state, seat, move)     true if that seat may play that move now
//   apply(state, seat, move)     a new state (never mutates the old one)
//   outcome(state)               null while playing, else {winner: seat | null} (null = draw)
//
// Seats are indexes in session.players (sorted by id, the same order on both sides).

import {firstSeat} from '../rng.js';

export class TurnMatch {
  #session;
  #rules;
  #onChange;
  #seat;
  #state;
  #count = 0; // moves applied so far; every move message carries its number so a repeat is ignored
  #error = null;
  #reported = false;
  #destroyed = false;

  constructor({session, rules, onChange = () => {}}) {
    this.#session = session;
    this.#rules = rules;
    this.#onChange = onChange;
    this.#seat = session.players.findIndex((p) => p.id === session.selfId);
    this.#state = rules.create({seed: session.sid, first: firstSeat(session.sid)});
    session.onMessage = (msg) => this.#onMessage(msg);
  }

  get seat() { return this.#seat; }

  snapshot() {
    const state = this.#state;
    const over = this.#rules.outcome(state);
    const turn = over ? null : this.#rules.turn(state);
    return {
      state,
      seat: this.#seat,
      turn,
      myTurn: turn === this.#seat,
      over, // null, or {winner: seat | null}
      won: over ? over.winner === this.#seat : false,
      moves: this.#count,
      error: this.#error,
      names: this.#session.players.map((p) => p.name),
      opponentName: this.#session.players[1 - this.#seat]?.name ?? 'Friend',
      session: this.#session.sid,
    };
  }

  /** Play a move as myself. Returns false (and changes nothing) if it is not my turn or is illegal. */
  play(move) {
    if (this.#destroyed || this.#rules.outcome(this.#state)) return false;
    if (!this.#rules.legal(this.#state, this.#seat, move) || this.#rules.turn(this.#state) !== this.#seat) return false;
    this.#apply(this.#seat, move);
    this.#session.send({t: 'move', n: this.#count, move});
    this.#changed();
    return true;
  }

  #apply(seat, move) {
    this.#state = this.#rules.apply(this.#state, seat, move);
    this.#count++;
    this.#error = null;
  }

  #onMessage(msg) {
    if (this.#destroyed || !msg || msg.t !== 'move') return;
    const seat = 1 - this.#seat;
    if (msg.n !== this.#count + 1) return; // a repeat or a skip, not the move we expect next
    if (this.#rules.outcome(this.#state)
      || this.#rules.turn(this.#state) !== seat
      || !this.#rules.legal(this.#state, seat, msg.move)) {
      this.#error = 'Your friend sent a move that does not fit the game. Start a new game.';
      this.#changed();
      return;
    }
    this.#apply(seat, msg.move);
    this.#changed();
  }

  #changed() {
    const over = this.#rules.outcome(this.#state);
    if (over && !this.#reported) {
      this.#reported = true;
      this.#session.finished(over.winner === null ? {} : {winnerId: this.#session.players[over.winner].id});
    }
    this.#onChange(this.snapshot());
  }

  destroy() {
    this.#destroyed = true;
    this.#session.onMessage = null;
  }
}
