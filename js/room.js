// A Room is the long-lived thing two people share: the connection, who is here,
// their names. Games are activities started inside it. The room owns the
// transport; a game only ever sees a `session` (see startSession).
//
// Talks to the network only through a `transport`:
//   transport.send(msg, peerId)
//   transport.onMessage = (msg, peerId) => {}
//   transport.onPeerJoin = (peerId) => {}
//   transport.onPeerLeave = (peerId) => {}
//   transport.leave()
// Both players run identical code; there is no host. Two players for now: a
// third peer is ignored.
//
// Wire format, one channel, every message `{t: kind, ...}`:
//   hello    {v, name, room}     who I am; v is PROTOCOL_VERSION
//   propose  {gid, pid}          "let's play game gid"; pid names this proposal
//   accept   {pid}               the proposal pid is on; its pid becomes the session id
//   decline  {pid}  cancel {pid}
//   end      {sid}               I left the game (or never had it); go back to the picker
//   game     {sid, gid, m}       a game's own message m, only delivered to that session

import {cleanName, MAX_ROOM_NAME_LENGTH} from './names.js';
import {findGame} from './games.js';

/** Bump when the room protocol changes; a mismatch shows "refresh" instead of a silent hang. */
export const PROTOCOL_VERSION = 2;
/** How long a resumable game waits for a dropped peer to come back. */
export const RESUME_GRACE_MS = 20_000;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_EARLY_MESSAGES = 100;

/**
 * phase: waiting       nobody else here yet
 *        idle          two people, no game: show the picker
 *        proposing     I asked to play something, waiting for their answer
 *        invited       they asked, waiting for my answer
 *        playing       a game session is running (see snapshot().session)
 *        incompatible  the other side runs a different protocol version
 */
export class Room {
  #transport;
  #roomId;
  #name;
  #roomName;
  #getGame;
  #graceMs;
  #onChange;
  #peers = new Set();
  #opponentId = null; // the one other player; a third peer is ignored
  #awayId = null; // opponent of a resumable game who dropped and may come back
  #graceTimer = null;
  #info = new Map(); // peerId -> {name, room, v}, kept even if a hello beats the join event
  #pending = null; // {pid, gid, from: peerId}
  #session = null;
  #early = []; // game messages that arrived before the game attached its handler
  #notice = null;

  constructor({
    transport,
    roomId,
    name = 'Player',
    roomName = '',
    getGame = findGame,
    graceMs = RESUME_GRACE_MS,
    onChange = () => {},
  }) {
    this.#transport = transport;
    this.#roomId = roomId;
    this.#name = cleanName(name, 'Player');
    this.#roomName = cleanName(roomName, '', MAX_ROOM_NAME_LENGTH);
    this.#getGame = getGame;
    this.#graceMs = graceMs;
    this.#onChange = onChange;
    transport.onMessage = (msg, peerId) => this.#onMessage(msg, peerId);
    transport.onPeerJoin = (peerId) => this.#onPeerJoin(peerId);
    transport.onPeerLeave = (peerId) => this.#onPeerLeave(peerId);
  }

  snapshot() {
    const them = this.#info.get(this.#opponentId);
    const players = [{id: this.#transport.selfId, name: this.#name}];
    if (this.#opponentId) players.push({id: this.#opponentId, name: them?.name ?? 'Friend'});
    players.sort((a, b) => (a.id < b.id ? -1 : 1));
    return {
      phase: this.#phase(),
      roomId: this.#roomId,
      selfId: this.#transport.selfId,
      players,
      opponentName: them?.name ?? null,
      roomName: this.#roomName || them?.room || null,
      pending: this.#pending && {
        gameId: this.#pending.gid,
        from: this.#pending.from === this.#opponentId ? 'them' : 'me',
      },
      session: this.#session,
      away: this.#awayId !== null,
      notice: this.#notice,
    };
  }

  /** Ask the other player to play `gameId`. */
  propose(gameId) {
    if (this.#phase() !== 'idle' || !this.#playable(gameId)) return;
    this.#notice = null;
    this.#pending = {pid: newId(), gid: gameId, from: this.#transport.selfId};
    this.#send({t: 'propose', gid: gameId, pid: this.#pending.pid});
    this.#emit();
  }

  /** Withdraw my own proposal. */
  cancel() {
    if (this.#phase() !== 'proposing') return;
    this.#send({t: 'cancel', pid: this.#pending.pid});
    this.#pending = null;
    this.#emit();
  }

  accept() {
    if (this.#phase() !== 'invited') return;
    const {pid, gid} = this.#pending;
    this.#pending = null;
    this.#send({t: 'accept', pid});
    this.#startSession(gid, pid);
  }

  decline() {
    if (this.#phase() !== 'invited') return;
    this.#send({t: 'decline', pid: this.#pending.pid});
    this.#pending = null;
    this.#emit();
  }

  /** Leave the running game; both players go back to the picker. */
  endGame() {
    if (this.#session) this.#endSession({tell: true});
  }

  leave() {
    clearTimeout(this.#graceTimer);
    if (this.#session) this.#session.closed = true;
    this.#transport.leave();
  }

  // --- internals -------------------------------------------------------------

  #phase() {
    if (!this.#opponentId) return 'waiting';
    const version = this.#info.get(this.#opponentId)?.v; // unknown until their hello arrives
    if (version !== undefined && version !== PROTOCOL_VERSION) return 'incompatible';
    if (this.#session) return 'playing';
    if (this.#pending) return this.#pending.from === this.#opponentId ? 'invited' : 'proposing';
    return 'idle';
  }

  #emit() {
    this.#onChange(this.snapshot());
  }

  #send(msg) {
    if (this.#opponentId) this.#transport.send(msg, this.#opponentId);
  }

  #hello(peerId) {
    this.#transport.send({t: 'hello', v: PROTOCOL_VERSION, name: this.#name, room: this.#roomName}, peerId);
  }

  /** Only games that exist, are ready, and fit two players can be proposed or accepted. */
  #playable(gameId) {
    const game = typeof gameId === 'string' ? this.#getGame(gameId) : null;
    return !!game && game.status === 'ready' && (game.minPlayers ?? 2) <= 2 && 2 <= (game.maxPlayers ?? 2);
  }

  #startSession(gid, sid) {
    const room = this;
    const opponentId = this.#opponentId;
    const game = this.#getGame(gid);
    const snap = this.snapshot();
    // A game loads lazily, so its first messages can arrive before it has attached
    // a handler. Hold them (briefly, bounded) and deliver once it does.
    let handler = null;
    const early = (this.#early = []);
    const session = {
      gameId: gid,
      sid,
      roomId: this.#roomId,
      selfId: this.#transport.selfId,
      players: snap.players,
      resumable: game?.resumable === true,
      closed: false,
      result: null,
      /** Send a game message to the other player. Dropped while they are away or after the session ends. */
      send(m) {
        if (session.closed || room.#awayId) return;
        room.#transport.send({t: 'game', sid, gid, m}, opponentId);
      },
      /** The game sets these to receive messages and, if resumable, connection changes. */
      get onMessage() { return handler; },
      set onMessage(fn) {
        handler = fn;
        if (fn) queueMicrotask(() => { while (early.length && handler) room.#deliver(session, early.shift(), opponentId); });
      },
      onPeerLeave: null,
      onPeerJoin: null,
      /** The game reports it is over; the room shows "Play again / Back to room". */
      finished(result) {
        if (session.closed || session.result) return;
        session.result = result ?? {};
        room.#emit();
      },
    };
    this.#session = session;
    this.#notice = null;
    this.#emit();
  }

  #endSession({tell = false, notice = null} = {}) {
    const session = this.#session;
    if (!session) return;
    session.closed = true;
    clearTimeout(this.#graceTimer);
    this.#awayId = null;
    if (tell) this.#send({t: 'end', sid: session.sid});
    this.#session = null;
    this.#pending = null;
    this.#notice = notice;
    this.#emit();
  }

  #onPeerJoin(peerId) {
    this.#peers.add(peerId);
    if (peerId === this.#awayId) {
      // The same peer came back inside the grace period: the game carries on.
      clearTimeout(this.#graceTimer);
      this.#awayId = null;
      this.#hello(peerId);
      this.#session?.onPeerJoin?.(peerId);
      this.#emit();
      return;
    }
    if (this.#opponentId) return; // a third player is ignored
    this.#opponentId = peerId;
    this.#hello(peerId);
    this.#emit();
  }

  #onPeerLeave(peerId) {
    this.#peers.delete(peerId);
    if (peerId !== this.#opponentId) {
      this.#info.delete(peerId);
      return;
    }
    const session = this.#session;
    if (session?.resumable && !session.closed && !this.#awayId) {
      this.#awayId = peerId;
      clearTimeout(this.#graceTimer);
      this.#graceTimer = setTimeout(() => this.#dropOpponent(peerId), this.#graceMs);
      session.onPeerLeave?.(peerId);
      this.#emit();
      return;
    }
    this.#dropOpponent(peerId);
  }

  #dropOpponent(peerId) {
    if (peerId !== this.#opponentId) return;
    const name = this.#info.get(peerId)?.name;
    const hadSession = !!this.#session;
    this.#info.delete(peerId);
    this.#awayId = null;
    this.#pending = null;
    if (this.#session) {
      this.#session.closed = true;
      this.#session = null;
    }
    clearTimeout(this.#graceTimer);
    this.#opponentId = this.#peers.values().next().value ?? null;
    if (this.#opponentId) this.#hello(this.#opponentId); // a waiting third peer never got our hello
    this.#notice = hadSession && name ? `${name} disconnected.` : null;
    this.#emit();
  }

  // Everything below is remote input: validate before trusting.
  #onMessage(msg, peerId) {
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;

    if (msg.t === 'hello') {
      const name = cleanName(msg.name);
      if (!name) return;
      const room = cleanName(msg.room, '', MAX_ROOM_NAME_LENGTH);
      this.#info.set(peerId, {name, room, v: Number.isInteger(msg.v) ? msg.v : 0});
      if (peerId === this.#opponentId) this.#emit();
      return;
    }

    if (peerId !== this.#opponentId) return;
    if (this.#phase() === 'incompatible') return;

    switch (msg.t) {
      case 'propose': return this.#onPropose(msg);
      case 'accept': return this.#onAccept(msg);
      case 'decline': return this.#onDecline(msg);
      case 'cancel': return this.#onCancel(msg);
      case 'end': return this.#onEnd(msg);
      case 'game': return this.#onGame(msg, peerId);
      default:
    }
  }

  #onPropose({gid, pid}) {
    if (!ID.test(pid) || !this.#playable(gid)) return;
    const phase = this.#phase();
    if (phase === 'proposing') {
      // Both asked at once. The lower peer id wins, so both sides pick the same proposal.
      if (!(this.#opponentId < this.#transport.selfId)) return;
    } else if (phase !== 'idle' && phase !== 'invited') {
      return;
    }
    this.#notice = null;
    this.#pending = {pid, gid, from: this.#opponentId};
    this.#emit();
  }

  #onAccept({pid}) {
    const mine = this.#pending?.from === this.#transport.selfId ? this.#pending : null;
    if (!mine || mine.pid !== pid) {
      // They accepted something I already withdrew: do not leave them in a game alone.
      if (typeof pid === 'string' && ID.test(pid)) this.#send({t: 'end', sid: pid});
      return;
    }
    this.#pending = null;
    this.#startSession(mine.gid, mine.pid);
  }

  #onDecline({pid}) {
    if (this.#phase() !== 'proposing' || this.#pending.pid !== pid) return;
    const title = this.#getGame(this.#pending.gid)?.title ?? 'that game';
    const name = this.#info.get(this.#opponentId)?.name ?? 'Your friend';
    this.#pending = null;
    this.#notice = `${name} declined ${title}.`;
    this.#emit();
  }

  #onCancel({pid}) {
    if (this.#phase() !== 'invited' || this.#pending.pid !== pid) return;
    this.#pending = null;
    this.#emit();
  }

  #onEnd({sid}) {
    if (!this.#session || this.#session.sid !== sid) return;
    const name = this.#info.get(this.#opponentId)?.name ?? 'Your friend';
    this.#endSession({notice: `${name} left the game.`});
  }

  #onGame({sid, gid, m}, peerId) {
    const session = this.#session;
    if (!session || session.closed || session.sid !== sid || session.gameId !== gid) return; // stale or foreign
    if (!session.onMessage) {
      if (this.#early.length < MAX_EARLY_MESSAGES) this.#early.push(m);
      return;
    }
    this.#deliver(session, m, peerId);
  }

  #deliver(session, m, peerId) {
    if (session.closed) return;
    try {
      session.onMessage?.(m, peerId);
    } catch (err) {
      console.error('game message handler failed', err);
    }
  }
}

function newId() {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
}
