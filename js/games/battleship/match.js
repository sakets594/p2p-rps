// Battleship match. Pure logic over a room `session`; no DOM.
//
// Nobody can see the other fleet, so it is committed by hash first:
//   fleet   {hash}                       "I have placed my ships; this hash locks them in"
//   shot    {r, c}                       the player whose turn it is fires
//   result  {r, c, hit, sunk, over}      the other player answers truthfully from their own fleet
//   reveal  {fleet, nonce}               when the game is over both fleets are shown
// On reveal each side checks the other's fleet against its hash and against every answer it was given,
// so an answer that did not match the committed fleet is caught (`verified: false`).
// Players take turns shooting, one shot each.

import {randomNonce, sha256Hex} from '../../crypto.js';
import {firstSeat} from '../../rng.js';
import {SIZE, commitText, keyOf, randomFleet, resolveShot, validFleet, cellsOf} from './rules.js';

/**
 * phase: placing  arranging my fleet (shuffle until happy)
 *        waiting  my fleet is locked in, waiting for the other
 *        battle   shooting
 *        over     someone sank everything
 */
export class BattleshipMatch {
  #session;
  #onChange;
  #random;
  #seat;
  #epoch = 0;
  #s;
  #nonce = randomNonce();
  #theirHash = null;
  #theirReveal = null;
  #myShots = new Map(); // key -> {r, c, hit, sunk}
  #theirShots = new Map(); // key -> {r, c, hit}
  #pending = null; // {r, c} fired, answer not in yet

  constructor({session, onChange = () => {}, random = Math.random}) {
    this.#session = session;
    this.#onChange = onChange;
    this.#random = random;
    this.#seat = session.players.findIndex((p) => p.id === session.selfId);
    this.#s = {
      phase: 'placing',
      fleet: randomFleet(random),
      myHash: null,
      turn: firstSeat(session.sid),
      winner: undefined, // seat | null; set when over
      verified: null, // null until the other fleet is revealed, then true or false
      error: null,
    };
    session.onMessage = (msg) => this.#onMessage(msg);
  }

  snapshot() {
    const s = this.#s;
    const sunkByMe = [...this.#myShots.values()].filter((x) => x.sunk).map((x) => x.sunk);
    return {
      ...s,
      seat: this.#seat,
      myTurn: s.phase === 'battle' && s.turn === this.#seat && !this.#pending,
      shots: [...this.#myShots.values()],
      incoming: [...this.#theirShots.values()],
      pending: this.#pending,
      sunkByMe,
      theirFleet: this.#theirReveal?.fleet ?? null,
      won: s.phase === 'over' && s.winner === this.#seat,
      names: this.#session.players.map((p) => p.name),
      opponentName: this.#session.players[1 - this.#seat]?.name ?? 'Friend',
      session: this.#session.sid,
    };
  }

  shuffle() {
    if (this.#s.phase !== 'placing') return;
    this.#s.fleet = randomFleet(this.#random);
    this.#emit();
  }

  /** Lock in my fleet. */
  async ready() {
    if (this.#s.phase !== 'placing') return;
    const epoch = this.#epoch;
    const hash = await sha256Hex(commitText(this.#s.fleet, this.#nonce));
    if (epoch !== this.#epoch || this.#s.phase !== 'placing') return;
    this.#s.myHash = hash;
    this.#s.phase = 'waiting';
    this.#session.send({t: 'fleet', hash});
    this.#maybeStart();
    this.#emit();
  }

  fire(r, c) {
    const s = this.#s;
    if (s.phase !== 'battle' || s.turn !== this.#seat || this.#pending) return false;
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= SIZE || c >= SIZE) return false;
    if (this.#myShots.has(keyOf(r, c))) return false;
    this.#pending = {r, c};
    this.#session.send({t: 'shot', r, c});
    this.#emit();
    return true;
  }

  #maybeStart() {
    const s = this.#s;
    if (s.phase === 'waiting' && s.myHash && this.#theirHash) s.phase = 'battle';
  }

  #onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    const s = this.#s;
    if (msg.t === 'fleet') {
      if (this.#theirHash || typeof msg.hash !== 'string' || !/^[0-9a-f]{64}$/.test(msg.hash)) return;
      this.#theirHash = msg.hash;
      this.#maybeStart();
      this.#emit();
    } else if (msg.t === 'shot') {
      const {r, c} = msg;
      if (s.phase !== 'battle' || s.turn !== 1 - this.#seat) return;
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= SIZE || c >= SIZE) return;
      if (this.#theirShots.has(keyOf(r, c))) return;
      const res = resolveShot(s.fleet, this.#theirShots.keys(), r, c);
      this.#theirShots.set(keyOf(r, c), {r, c, hit: res.hit});
      this.#session.send({t: 'result', r, c, hit: res.hit, sunk: res.sunk, over: res.over});
      s.turn = this.#seat;
      if (res.over) this.#finish(1 - this.#seat);
      this.#emit();
    } else if (msg.t === 'result') {
      const p = this.#pending;
      if (!p || msg.r !== p.r || msg.c !== p.c || typeof msg.hit !== 'boolean') return;
      this.#pending = null;
      this.#myShots.set(keyOf(p.r, p.c), {r: p.r, c: p.c, hit: msg.hit, sunk: Number.isInteger(msg.sunk) ? msg.sunk : 0});
      s.turn = 1 - this.#seat;
      if (msg.over === true) this.#finish(this.#seat);
      this.#verify();
      this.#emit();
    } else if (msg.t === 'reveal') {
      if (this.#theirReveal || !Array.isArray(msg.fleet) || typeof msg.nonce !== 'string') return;
      this.#theirReveal = {fleet: msg.fleet, nonce: msg.nonce};
      this.#verify();
      this.#emit();
    }
  }

  #finish(winnerSeat) {
    const s = this.#s;
    if (s.phase === 'over') return;
    s.phase = 'over';
    s.winner = winnerSeat;
    this.#session.send({t: 'reveal', fleet: s.fleet, nonce: this.#nonce});
    this.#session.finished({winnerId: this.#session.players[winnerSeat].id});
    this.#verify();
  }

  /** Check their revealed fleet against their hash and every answer they gave me. */
  async #verify() {
    const r = this.#theirReveal;
    if (!r || this.#s.phase !== 'over' || this.#s.verified !== null || this.#verifying) return;
    this.#verifying = true;
    const epoch = this.#epoch;
    const hash = validFleet(r.fleet) ? await sha256Hex(commitText(r.fleet, r.nonce)) : null;
    this.#verifying = false;
    if (epoch !== this.#epoch) return;
    let ok = hash === this.#theirHash;
    if (ok) {
      const shot = new Set();
      for (const x of this.#myShots.values()) {
        const res = resolveShot(r.fleet, shot, x.r, x.c);
        shot.add(keyOf(x.r, x.c));
        if (res.hit !== x.hit || res.sunk !== x.sunk) ok = false;
      }
      // They said they lost: every one of their ship cells must really have been shot.
      if (this.#s.winner === this.#seat && !r.fleet.every((sh) => cellsOf(sh).every(([a, b]) => shot.has(keyOf(a, b))))) ok = false;
    }
    this.#s.verified = ok;
    if (!ok) this.#s.error = `${this.#session.players[1 - this.#seat].name}’s answers did not match their fleet. They may have cheated.`;
    this.#emit();
  }
  #verifying = false;

  #emit() { this.#onChange(this.snapshot()); }

  destroy() {
    this.#epoch++;
    this.#session.onMessage = null;
  }
}
