// Match state machine. Talks to the network only through a `transport`:
//   transport.send(msg, peerId)
//   transport.onMessage = (msg, peerId) => {}
//   transport.onPeerJoin = (peerId) => {}
//   transport.onPeerLeave = (peerId) => {}
//   transport.leave()
// Both players run identical code; there is no host.

import {MOVES, makeCommit, resolve, verifyReveal} from './game.js';

export const MAX_NAME_LENGTH = 16;
export const MAX_ROOM_NAME_LENGTH = 24;

/** Names come from the network and are shown in the UI: strip control chars, trim, cap. */
export function cleanName(raw, fallback = '', max = MAX_NAME_LENGTH) {
  if (typeof raw !== 'string') return fallback;
  const name = raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  return Array.from(name).slice(0, max).join('') || fallback;
}

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
  #name;
  #roomName;
  #roomNames = new Map(); // peerId -> room name that peer announced (the creator's)
  #names = new Map(); // peerId -> display name (kept even if a hello beats the join event)
  #onChange;
  #peers = new Set();
  #opponentId = null;
  #epoch = 0; // bumped on reset so stale async work is discarded
  #s;
  #myCommit = null;
  #theirCommits = new Map(); // round -> hash
  #theirReveals = new Map(); // round -> {move, nonce}
  #verifying = false;

  constructor({transport, roomId, name = 'Player', roomName = '', onChange = () => {}}) {
    this.#transport = transport;
    this.#roomId = roomId;
    this.#name = cleanName(name, 'Player');
    this.#roomName = cleanName(roomName, '', MAX_ROOM_NAME_LENGTH);
    this.#onChange = onChange;
    this.#s = this.#fresh();
    transport.onMessage = (msg, peerId) => this.#onMessage(msg, peerId);
    transport.onPeerJoin = (peerId) => this.#onPeerJoin(peerId);
    transport.onPeerLeave = (peerId) => this.#onPeerLeave(peerId);
  }

  snapshot() {
    return {
      ...this.#s,
      scores: {...this.#s.scores},
      opponentName: this.#names.get(this.#opponentId) ?? null,
      roomName: this.#roomName || this.#roomNames.get(this.#opponentId) || null,
      theirCommitted: this.#theirCommits.has(this.#s.round),
      session: this.#epoch, // changes whenever the match restarts (new opponent)
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
    this.#transport.send({t: 'hello', name: this.#name, room: this.#roomName}, peerId);
  }

  #onPeerLeave(peerId) {
    this.#peers.delete(peerId);
    this.#names.delete(peerId);
    this.#roomNames.delete(peerId);
    if (peerId !== this.#opponentId) return;
    this.#opponentId = this.#peers.values().next().value ?? null;
    this.#reset();
    this.#emit();
  }

  // Everything below is remote input: validate before trusting.
  #onMessage(msg, peerId) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      const name = cleanName(msg.name);
      if (!name) return;
      this.#names.set(peerId, name);
      const room = cleanName(msg.room, '', MAX_ROOM_NAME_LENGTH);
      if (room) this.#roomNames.set(peerId, room);
      if (peerId === this.#opponentId) this.#emit();
      return;
    }
    if (peerId !== this.#opponentId) return;
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
