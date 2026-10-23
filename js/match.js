// Match state machine. Talks to the network only through a `transport`:
//   transport.send(msg, peerId)
//   transport.onMessage = (msg, peerId) => {}
//   transport.onPeerJoin = (peerId) => {}
//   transport.onPeerLeave = (peerId) => {}
//   transport.leave()
// Both players run identical code; there is no host.

import {MOVES, makeCommit, resolve, verifyReveal} from './game.js';

const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;

/**
 * phase: waiting   no opponent yet
 *        choosing  pick a move
 *        committed my hash is sent, waiting for theirs
 *        revealing both hashes in, waiting for their reveal
 *        result    round resolved
 *        cheat     their reveal did not match their commit
 */
export class RpsMatch {
  #transport;
  #roomId;
  #onChange;
  #peers = new Set();
  #opponentId = null;
  #epoch = 0; // bumped on reset so stale async work is discarded
  #s;
  #myCommit = null;
  #theirCommits = new Map(); // round -> hash
  #theirReveals = new Map(); // round -> {move, nonce}
  #verifying = false;

  constructor({transport, roomId, onChange = () => {}}) {
    this.#transport = transport;
    this.#roomId = roomId;
    this.#onChange = onChange;
    this.#s = this.#fresh();
    transport.onMessage = (msg, peerId) => this.#onMessage(msg, peerId);
    transport.onPeerJoin = (peerId) => this.#onPeerJoin(peerId);
    transport.onPeerLeave = (peerId) => this.#onPeerLeave(peerId);
  }

  snapshot() {
    return {...this.#s, scores: {...this.#s.scores}};
  }

  async pick(move) {
    const s = this.#s;
    if (s.phase !== 'choosing' || !MOVES.includes(move)) return;
    const epoch = this.#epoch;
    const round = s.round;
    s.phase = 'committed'; // synchronous, so a double click cannot pick twice
    s.myMove = move;
    this.#emit();

    const commit = await makeCommit({roomId: this.#roomId, round, move});
    if (epoch !== this.#epoch) return;
    this.#myCommit = commit;
    this.#transport.send({t: 'commit', round, hash: commit.hash}, this.#opponentId);
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

  leave() {
    this.#epoch++;
    this.#transport.leave();
  }

  // --- internals -------------------------------------------------------------

  #fresh() {
    return {
      phase: 'waiting',
      round: 1,
      myMove: null,
      theirMove: null,
      outcome: null,
      error: null,
      scores: {win: 0, lose: 0, draw: 0},
    };
  }

  #emit() {
    this.#onChange(this.snapshot());
  }

  #reset() {
    this.#epoch++;
    this.#s = this.#fresh();
    this.#myCommit = null;
    this.#verifying = false;
    this.#theirCommits.clear();
    this.#theirReveals.clear();
    this.#s.phase = this.#opponentId ? 'choosing' : 'waiting';
  }

  #onPeerJoin(peerId) {
    this.#peers.add(peerId);
    if (this.#opponentId) return; // a third player is ignored
    this.#opponentId = peerId;
    this.#reset();
    this.#emit();
  }

  #onPeerLeave(peerId) {
    this.#peers.delete(peerId);
    if (peerId !== this.#opponentId) return;
    this.#opponentId = this.#peers.values().next().value ?? null;
    this.#reset();
    this.#emit();
  }

  // Everything below is remote input: validate before trusting.
  #onMessage(msg, peerId) {
    if (peerId !== this.#opponentId || !msg || typeof msg !== 'object') return;
    const {round} = msg;
    // The opponent can be at most one round ahead of us, never behind.
    if (!Number.isInteger(round) || round < this.#s.round || round > this.#s.round + 1) return;

    if (msg.t === 'commit') {
      if (!HEX64.test(msg.hash) || this.#theirCommits.has(round)) return;
      this.#theirCommits.set(round, msg.hash);
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
      this.#transport.send(
        {t: 'reveal', round: s.round, move: s.myMove, nonce: this.#myCommit.nonce},
        this.#opponentId,
      );
      this.#emit();
    }

    if (s.phase === 'revealing' && this.#theirReveals.has(s.round) && !this.#verifying) {
      this.#verifying = true;
      const epoch = this.#epoch;
      const round = s.round;
      const {move, nonce} = this.#theirReveals.get(round);
      const ok = await verifyReveal({
        roomId: this.#roomId,
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
