// In-memory stand-in for the Trystero transport. Used by tests (and handy for
// local experiments): same interface as net.js, no browser or network needed.

export class MemoryNetwork {
  #peers = new Map();
  /** Optional hook: (from, to, msg) => msg | null. Return null to drop. */
  intercept = null;

  createPeer(selfId) {
    const net = this;
    const peers = this.#peers;
    const transport = {
      selfId,
      onMessage: () => {},
      onPeerJoin: () => {},
      onPeerLeave: () => {},

      /** Enter the room; every existing peer and this one learn about each other. */
      join() {
        if (peers.has(selfId)) return;
        for (const [id, peer] of peers) {
          queueMicrotask(() => peer.onPeerJoin(selfId));
          queueMicrotask(() => transport.onPeerJoin(id));
        }
        peers.set(selfId, transport);
      },

      send(msg, to) {
        const wire = JSON.parse(JSON.stringify(msg)); // mimic serialization
        const out = net.intercept ? net.intercept(selfId, to, wire) : wire;
        if (!out) return;
        queueMicrotask(() => peers.get(to)?.onMessage(out, selfId));
      },

      leave() {
        if (!peers.delete(selfId)) return;
        for (const peer of peers.values()) queueMicrotask(() => peer.onPeerLeave(selfId));
      },
    };
    return transport;
  }
}

/**
 * Two game sessions wired to each other over a MemoryNetwork, shaped like the
 * `session` the room hands to a game (see js/room.js). For testing a game's
 * Match without a room: `const {sessions: [a, b]} = memorySessions()`.
 * `transports` are the raw peers, for injecting junk or using net.intercept.
 */
export function memorySessions({
  roomId = 'ABC123',
  sid = 'test-session',
  players = [{id: 'alice', name: 'Alice'}, {id: 'bob', name: 'Bob'}],
} = {}) {
  const net = new MemoryNetwork();
  const sorted = [...players].sort((x, y) => (x.id < y.id ? -1 : 1));
  const transports = [];
  const sessions = players.map((me) => {
    const other = players.find((p) => p.id !== me.id);
    const transport = net.createPeer(me.id);
    const session = {
      roomId,
      sid,
      gameId: 'test',
      selfId: me.id,
      players: sorted,
      closed: false,
      result: null,
      send: (m) => transport.send(m, other.id),
      onMessage: null,
      onPeerLeave: null,
      onPeerJoin: null,
      finished(result) { session.result = result ?? {}; },
    };
    transport.onMessage = (m, from) => session.onMessage?.(m, from);
    transports.push(transport);
    return session;
  });
  for (const t of transports) t.join();
  return {net, sessions, transports};
}

/** Let queued microtasks and async crypto settle. 50 ms, because hashing runs on a thread pool and 20 ms flaked when test files ran in parallel. */
export const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
