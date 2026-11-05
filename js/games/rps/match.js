// Rock Paper Scissors match state machine. Pure logic: no DOM, no network code.
// It talks to the other player only through a room `session`:
//   session.players          [{id, name}], both players
//   session.send(msg)        to the other player
//   session.onMessage = (msg, fromId) => {}
// The room handles who is here, names and disconnects; if the other player
// leaves, the room ends the session and this match is simply destroyed.

import {MOVES, makeCommit, resolve, verifyReveal} from './rules.js';

const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;

/**
 * phase: choosing  pick a move
 *        committed my hash is sent, waiting for theirs
 *        revealing both hashes in, waiting for their reveal
 *        result    round resolved
 *        cheat     their reveal did not match their commit
 */
export class RpsMatch {
  #session;
  #opponent;
  #onChange;
  #epoch = 0; // bumped on destroy so stale async work is discarded
  #s;
  #myCommit = null;
  #theirCommits = new Map(); // round -> hash
  #theirReveals = new Map(); // round -> {move, nonce}
  #verifying = false;

  constructor({session, onChange = () => {}}) {
    this.#session = session;
    this.#opponent = session.players.find((p) => p.id !== session.selfId);
    this.#onChange = onChange;
    this.#s = {
      phase: 'choosing',
      round: 1,
      myMove: null,
      theirMove: null,
      outcome: null,
      error: null,
      scores: {win: 0, lose: 0, draw: 0},
    };
    session.onMessage = (msg, peerId) => this.#onMessage(msg, peerId);
  }

  snapshot() {
    return {
      ...this.#s,
      scores: {...this.#s.scores},
      opponentName: this.#opponent.name,
      theirCommitted: this.#theirCommits.has(this.#s.round),
      session: this.#session.sid, // lets the view tell one game apart from the next
    };
  }

  async pick(move) {
    const s = this.#s;
    if (s.phase !== 'choosing' || !MOVES.includes(move)) return;
    const epoch = this.#epoch;
    const round = s.round;
    s.phase = 'committed'; // synchronous, so a double click cannot pick twice
    s.myMove = move;
    this.#emit();

    const commit = await makeCommit({roomId: this.#session.roomId, round, move});
    if (epoch !== this.#epoch) return;
    this.#myCommit = commit;
    this.#session.send({t: 'commit', round, hash: commit.hash});
    await this.#progress();
  }

  nextRound() {
    const s = this.#s;
    if (s.phase !== 'result' && s.phase !== 'cheat') return;
    this.#theirCommits.delete(s.round);
    this.#theirReveals.delete(s.round);
    this.#myCommit = null;
    s.round += 1;
    s.phase = 'choosing';
    s.myMove = s.theirMove = s.outcome = s.error = null;
    this.#emit();
  }

  destroy() {
    this.#epoch++;
    this.#session.onMessage = null;
  }

  // --- internals -------------------------------------------------------------

  #emit() {
    this.#onChange(this.snapshot());
  }

  // Everything below is remote input: validate before trusting.
  #onMessage(msg, peerId) {
    if (!msg || typeof msg !== 'object' || peerId !== this.#opponent.id) return;
    const {round} = msg;
    // The opponent can be at most one round ahead of us, never behind.
    if (!Number.isInteger(round) || round < this.#s.round || round > this.#s.round + 1) return;

    if (msg.t === 'commit') {
      if (!HEX64.test(msg.hash) || this.#theirCommits.has(round)) return;
      this.#theirCommits.set(round, msg.hash);
      if (round === this.#s.round) this.#emit(); // lets the UI show "friend locked in"
    } else if (msg.t === 'reveal') {
      if (!MOVES.includes(msg.move) || !HEX32.test(msg.nonce)) return;
      if (!this.#theirCommits.has(round) || this.#theirReveals.has(round)) return;
      this.#theirReveals.set(round, {move: msg.move, nonce: msg.nonce});
    } else {
      return;
    }
    this.#progress();
  }

  async #progress() {
    const s = this.#s;

    if (s.phase === 'committed' && this.#myCommit && this.#theirCommits.has(s.round)) {
      s.phase = 'revealing';
      this.#session.send({t: 'reveal', round: s.round, move: s.myMove, nonce: this.#myCommit.nonce});
      this.#emit();
    }

    if (s.phase === 'revealing' && this.#theirReveals.has(s.round) && !this.#verifying) {
      this.#verifying = true;
      const epoch = this.#epoch;
      const round = s.round;
      const {move, nonce} = this.#theirReveals.get(round);
      const ok = await verifyReveal({
        roomId: this.#session.roomId,
        round,
        move,
        nonce,
        hash: this.#theirCommits.get(round),
      });
      if (epoch !== this.#epoch) return;
      this.#verifying = false;

      if (!ok) {
        s.phase = 'cheat';
        s.error = 'Your friend’s move did not match what they locked in. Round voided.';
      } else {
        s.theirMove = move;
        s.outcome = resolve(s.myMove, move);
        s.scores[s.outcome] += 1;
        s.phase = 'result';
      }
      this.#emit();
    }
  }
}
