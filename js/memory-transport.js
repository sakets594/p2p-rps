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

/** Let queued microtasks and async crypto settle. */
export const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
