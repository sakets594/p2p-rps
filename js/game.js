// Pure game logic: no DOM, no network. Runs in the browser and in Node tests.

export const MOVES = ['rock', 'paper', 'scissors'];

const BEATS = {rock: 'scissors', paper: 'rock', scissors: 'paper'};

/** @returns {'win'|'lose'|'draw'} from the point of view of `mine`. */
export function resolve(mine, theirs) {
  if (mine === theirs) return 'draw';
  return BEATS[mine] === theirs ? 'win' : 'lose';
}

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

// --- Commit-reveal -----------------------------------------------------------
// With no referee, the player who sends second could peek. So each player first
// sends SHA-256(room|round|move|nonce), and only reveals move+nonce once both
// hashes are in. The other side checks the reveal against the earlier hash.

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(text) {
  return toHex(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

export function randomNonce() {
  return toHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
}

const preimage = ({roomId, round, move, nonce}) => `rps|${roomId}|${round}|${move}|${nonce}`;

export async function makeCommit({roomId, round, move, nonce = randomNonce()}) {
  return {nonce, hash: await sha256Hex(preimage({roomId, round, move, nonce}))};
}

export async function verifyReveal({roomId, round, move, nonce, hash}) {
  if (!MOVES.includes(move)) return false;
  return (await sha256Hex(preimage({roomId, round, move, nonce}))) === hash;
}
