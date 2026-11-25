// Hashing helpers shared by games that use commit-reveal (each player first sends
// a hash of their secret, and only reveals the secret once both hashes are in).
// Runs in the browser and in Node tests.

export const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** How many hashes are being worked out right now, so tests can wait for them instead of guessing a delay. */
export const hashing = {pending: 0};

export async function sha256Hex(text) {
  hashing.pending++;
  try {
    return toHex(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  } finally {
    hashing.pending--;
  }
}

export function randomNonce() {
  return toHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
}
