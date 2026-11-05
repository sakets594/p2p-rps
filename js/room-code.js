// Room codes: what people read out loud or put in a link to meet in a room.

// Crockford base32: no I, L, O, U, so codes are easy to read out loud.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ROOM_CODE_LENGTH = 6;

/**
 * Random room code from crypto.getRandomValues, XOR-mixed with the clock.
 * XOR with a uniform random byte keeps the output uniform; the time only adds
 * extra entropy and never makes the code predictable.
 */
export function generateRoomCode({
  length = ROOM_CODE_LENGTH,
  random = globalThis.crypto,
  now = Date.now(),
} = {}) {
  const bytes = random.getRandomValues(new Uint8Array(length));
  let code = '';
  for (let i = 0; i < length; i++) {
    const timeByte = Math.floor(now / 2 ** (8 * (i % 6))) % 256;
    code += ALPHABET[(bytes[i] ^ timeByte) & 31];
  }
  return code;
}

/** Forgiving parse of user input; returns the canonical code or null. */
export function normalizeRoomCode(input) {
  const code = String(input ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return new RegExp(`^[${ALPHABET}]{${ROOM_CODE_LENGTH}}$`).test(code) ? code : null;
}
