// Cup Pong match: rules, turn order and networking. Pure logic: no DOM, no timers.
// It talks to the other player only through a room `session` (see js/room.js):
//   session.players          [{id, name}] sorted by id, so index 0 and 1 are stable seats
//   session.send(msg)        to the other player (dropped while they are away)
//   session.onMessage        set here
//   session.onPeerLeave / onPeerJoin   set here (the game is resumable)
//   session.finished({winnerId})
//
// Both players run identical code. Only the throw inputs travel ({angleQ, powerQ}); each side
// replays the throw with the same deterministic physics, and the sender also includes the
// outcome it computed so a mismatch ("desync") is caught instead of silently diverging.
//
// Rules (taken from a popular cup-pong game): 5 rounds, 2 balls per turn, 10 cups per player.
// A cup that is hit stays gone. Both balls in = an extra turn (2 more balls). Clearing every cup
// wins at once; otherwise after round 5 the player with more cups hit wins.
//
// phase: handshake  waiting for the other side's hello
//        flip       fair coin flip (commit-reveal) for who throws first
//        play       the match is running
//        over       finished
//        incompatible  the other side runs different physics or rules: refresh
//        desync     the two sides disagree about a throw or the coin flip: the match is void

import {REFERENCE, layoutCups, simulate} from './physics.js';
import {sha256Hex, randomNonce} from '../../crypto.js';

export const RULES = {rounds: 5, balls: 2, cups: 10};
export const PARAMS = REFERENCE;

/** A short fingerprint of the physics and rules; two sides must agree before they play. */
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}
export const PHYSICS_ID = fnv1a(JSON.stringify({RULES, PARAMS}));

const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const validThrow = (a, p) => isInt(a, -127, 127) && isInt(p, 0, 255);

export class CupPongMatch {
  #session;
  #seat; // my seat: 0 or 1
  #names;
  #onEvent;
  #geometry = layoutCups(RULES.cups, PARAMS); // cup positions; alive flags live in the racks
  #s;
  #helloOk = false;
  #sentHello = false;
  #away = false;
  #destroyed = false;
  #epoch = 0;
  #flip = null;

  constructor({session, onEvent = () => {}}) {
    this.#session = session;
    this.#seat = session.players.findIndex((p) => p.id === session.selfId);
    this.#names = session.players.map((p) => p.name);
    this.#onEvent = onEvent;
    this.#s = {
      phase: 'handshake',
      first: null,
      turn: null,
      round: 1,
      ball: 1, // the ball about to be thrown, 1..balls
      turnHits: 0,
      scores: [0, 0],
      racks: [Array(RULES.cups).fill(true), Array(RULES.cups).fill(true)], // racks[seat][i]: that player's cup i still stands
      log: [], // every throw so far: [angleQ, powerQ]
      over: null, // {winner: seat | null, reason: 'cups' | 'rounds'}
      error: null,
    };
    session.onMessage = (msg, from) => this.#onMessage(msg, from);
    session.onPeerLeave = () => { this.#away = true; this.#emit({type: 'away', away: true}); };
    session.onPeerJoin = () => { this.#away = false; this.#emit({type: 'away', away: false}); this.#resync(); };
    this.#sendHello();
  }

  get seat() { return this.#seat; }
  get names() { return [...this.#names]; }
  get away() { return this.#away; }

  snapshot() {
    const s = this.#s;
    return {
      phase: s.phase,
      first: s.first,
      turn: s.turn,
      round: s.round,
      ball: s.ball,
      turnHits: s.turnHits,
      scores: [...s.scores],
      racks: s.racks.map((r) => [...r]),
      throws: s.log.length,
      over: s.over ? {...s.over} : null,
      error: s.error,
      seat: this.#seat,
      names: [...this.#names],
      away: this.#away,
      session: this.#session.sid,
    };
  }

  /** The cups (with alive flags) that `seat`'s throw is aimed at, ready for simulate(). */
  targetCups(seat = this.#seat) {
    const rack = this.#s.racks[1 - seat];
    return this.#geometry.map((c, i) => ({x: c.x, z: c.z, alive: rack[i]}));
  }

  canThrow() {
    const s = this.#s;
    return s.phase === 'play' && s.turn === this.#seat && !this.#away;
  }

  /** My throw. Returns the throw event (also delivered to onEvent), or null if it is not my turn. */
  throw(angleQ, powerQ) {
    if (!this.canThrow() || !validThrow(angleQ, powerQ)) return null;
    const ev = this.#apply(this.#seat, angleQ, powerQ);
    this.#session.send({t: 'throw', i: ev.i, a: angleQ, p: powerQ, o: ev.sim.outcome, c: ev.sim.cup});
    return ev;
  }

  destroy() {
    this.#destroyed = true;
    this.#epoch++;
  }

  // ---- state changes -----------------------------------------------------------------------------

  #emit(ev) {
    if (!this.#destroyed) this.#onEvent(ev);
  }

  #setPhase(phase, error = null) {
    if (this.#s.phase === phase) return;
    this.#s.phase = phase;
    this.#s.error = error;
    this.#emit({type: 'phase', snap: this.snapshot()});
  }

  #startPlay(first) {
    const s = this.#s;
    s.first = first;
    s.turn = first;
    this.#setPhase('play');
  }

  /** Apply one throw by `seat`. The caller has already checked it is that seat's turn. */
  #apply(seat, angleQ, powerQ) {
    const s = this.#s;
    const before = this.snapshot();
    const sim = simulate(angleQ, powerQ, this.targetCups(seat), PARAMS);
    const i = s.log.length;
    s.log.push([angleQ, powerQ]);
    const ballNo = s.ball;
    const hit = sim.outcome === 'in';
    let extra = false, switched = false, roundAdvanced = false;
    if (hit) {
      s.racks[1 - seat][sim.cup] = false;
      s.scores[seat]++;
      s.turnHits++;
    }
    if (!s.racks[1 - seat].some(Boolean)) { // every cup cleared: instant win
      this.#finish(seat, 'cups');
    } else if (s.ball >= RULES.balls) {
      if (s.turnHits >= RULES.balls) { // every ball went in: extra turn
        s.ball = 1;
        s.turnHits = 0;
        extra = true;
      } else {
        if (seat !== s.first) { // the second player of a round has finished
          if (s.round >= RULES.rounds) {
            const [a, b] = s.scores;
            this.#finish(a > b ? 0 : b > a ? 1 : null, 'rounds');
          } else {
            s.round++;
            roundAdvanced = true;
          }
        }
        if (s.phase !== 'over') {
          s.turn = 1 - seat;
          s.ball = 1;
          s.turnHits = 0;
          switched = true;
        }
      }
    } else {
      s.ball++;
    }
    const ev = {type: 'throw', i, seat, a: angleQ, p: powerQ, ballNo, sim, hit, cup: hit ? sim.cup : -1, extra, switched, roundAdvanced, before, after: this.snapshot()};
    this.#emit(ev);
    return ev;
  }

  #finish(winner, reason) {
    const s = this.#s;
    s.over = {winner, reason};
    s.phase = 'over';
    this.#session.finished(winner === null ? {} : {winnerId: this.#session.players[winner].id});
  }

  #fail(phase, error) {
    this.#setPhase(phase, error);
  }

  // ---- handshake and coin flip -------------------------------------------------------------------

  #sendHello(isReply = false) {
    this.#sentHello = true;
    this.#session.send(isReply ? {t: 'hello', v: PHYSICS_ID, r: true} : {t: 'hello', v: PHYSICS_ID});
  }

  async #startFlip() {
    const epoch = this.#epoch;
    const bit = globalThis.crypto.getRandomValues(new Uint8Array(1))[0] & 1;
    const nonce = randomNonce();
    const flip = (this.#flip = {bit, nonce, commit: null, theirCommit: this.#flip?.theirCommit ?? null, theirReveal: null, sentReveal: false});
    this.#setPhase('flip');
    const commit = await sha256Hex(`${this.#session.sid}|${this.#seat}|${bit}|${nonce}`);
    if (epoch !== this.#epoch || flip !== this.#flip) return;
    flip.commit = commit;
    this.#session.send({t: 'commit', h: commit});
    this.#flipProgress();
  }

  #flipProgress() {
    const f = this.#flip;
    if (!f || !f.commit || !f.theirCommit || this.#s.phase !== 'flip') return;
    if (!f.sentReveal) {
      f.sentReveal = true;
      this.#session.send({t: 'reveal', bit: f.bit, nonce: f.nonce});
    }
    if (f.theirReveal) this.#startPlay((f.bit ^ f.theirReveal.bit) === 0 ? 0 : 1);
  }

  async #onReveal(msg) {
    const f = this.#flip;
    if (!f || !f.theirCommit || f.theirReveal) return;
    if (!(msg.bit === 0 || msg.bit === 1) || typeof msg.nonce !== 'string' || !HEX32.test(msg.nonce)) return;
    const epoch = this.#epoch;
    const theirSeat = 1 - this.#seat;
    const h = await sha256Hex(`${this.#session.sid}|${theirSeat}|${msg.bit}|${msg.nonce}`);
    if (epoch !== this.#epoch || f !== this.#flip) return;
    if (h !== f.theirCommit) return this.#fail('desync', 'The coin flip did not check out.');
    f.theirReveal = {bit: msg.bit};
    this.#flipProgress();
  }

  // ---- reconnect --------------------------------------------------------------------------------------

  #resync() {
    // Messages sent while either side was away were dropped: say how far I got.
    this.#session.send({t: 'sync', n: this.#s.log.length, first: this.#s.first});
  }

  #onSync(msg) {
    const s = this.#s;
    if (!isInt(msg.n, 0, 100000)) return;
    if (s.phase === 'handshake' || s.phase === 'flip') {
      if ((msg.first === 0 || msg.first === 1) && this.#helloOk) return this.#startPlay(msg.first); // they finished the flip, I lost a message
      this.#flip = null; // start the handshake over
      this.#helloOk = false;
      this.#sendHello();
      return;
    }
    if (s.phase === 'play' || s.phase === 'over') {
      if (msg.first === null) return this.#resync(); // they have not started: tell them who did
      if (msg.first !== s.first) return this.#fail('desync', 'The other side disagrees about who started.');
      if (msg.n < s.log.length) this.#session.send({t: 'log', from: msg.n, throws: s.log.slice(msg.n)});
    }
  }

  #onLog(msg) {
    const s = this.#s;
    if (s.phase !== 'play' || !isInt(msg.from, 0, 100000) || !Array.isArray(msg.throws) || msg.throws.length > 500) return;
    if (msg.from > s.log.length) return; // a gap: wait for the next sync
    const skip = s.log.length - msg.from; // entries I already have
    for (let k = skip; k < msg.throws.length; k++) {
      const t = msg.throws[k];
      if (!Array.isArray(t) || !validThrow(t[0], t[1])) return this.#fail('desync', 'Got a throw that makes no sense.');
      if (s.phase !== 'play') return;
      if (s.turn === this.#seat) return this.#fail('desync', 'The other side claims a throw that was mine.');
      this.#apply(s.turn, t[0], t[1]);
    }
  }

  // ---- incoming messages (all remote input is validated) ------------------------------------------

  #onMessage(msg, fromId) {
    if (this.#destroyed || !msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    if (fromId !== this.#session.players[1 - this.#seat]?.id) return;
    const s = this.#s;
    if (s.phase === 'incompatible' || s.phase === 'desync') return;
    switch (msg.t) {
      case 'hello': {
        if (msg.v !== PHYSICS_ID) return this.#fail('incompatible', 'Your friend is on a different version. Refresh the page.');
        if (this.#helloOk) { // they are starting over (a lost message): answer once, and say how far we got
          if (msg.r !== true) { this.#sendHello(true); if (s.phase === 'play' || s.phase === 'over') this.#resync(); }
          return;
        }
        this.#helloOk = true;
        if (!this.#sentHello || msg.r !== true) this.#sendHello(true);
        if (s.phase === 'handshake') this.#startFlip();
        return;
      }
      case 'commit': {
        if (typeof msg.h !== 'string' || !HEX64.test(msg.h)) return;
        if (!this.#flip) this.#flip = {bit: null, nonce: null, commit: null, theirCommit: null, theirReveal: null, sentReveal: false};
        if (this.#flip.theirCommit) return;
        this.#flip.theirCommit = msg.h;
        this.#flipProgress();
        return;
      }
      case 'reveal': return this.#onReveal(msg);
      case 'sync': return this.#onSync(msg);
      case 'log': return this.#onLog(msg);
      case 'throw': return this.#onThrow(msg);
      default:
    }
  }

  #onThrow(msg) {
    const s = this.#s;
    if (s.phase !== 'play' && s.phase !== 'over') return;
    if (!isInt(msg.i, 0, 100000) || !validThrow(msg.a, msg.p)) return;
    if (msg.i < s.log.length) return; // a duplicate
    if (msg.i > s.log.length) return this.#resync(); // we missed one: ask the other side to fill in
    if (s.phase !== 'play' || s.turn === this.#seat) return this.#fail('desync', 'The other side threw out of turn.');
    const ev = this.#apply(s.turn, msg.a, msg.p);
    if (ev.sim.outcome !== msg.o || ev.sim.cup !== msg.c) this.#fail('desync', 'The two sides disagree about a throw.');
  }
}
