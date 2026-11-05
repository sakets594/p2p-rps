// Small deterministic helpers. Both players run the same code on the same game session id (`sid`),
// so anything derived from it (who goes first, how cards are shuffled, which questions come up)
// comes out the same on both sides with nothing sent over the network.

/** FNV-1a: a string to an unsigned 32-bit number. */
export function hashString(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: a seeded random function returning floats in [0, 1). */
export function seededRandom(seed) {
  let a = (typeof seed === 'string' ? hashString(seed) : seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A shuffled copy (Fisher-Yates) using `random`. */
export function shuffled(items, random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Seat 0 or 1 that goes first in this session, the same on both sides. */
export function firstSeat(sid, salt = '') {
  return hashString(`${sid}:${salt}`) & 1;
}
