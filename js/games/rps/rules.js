// Rock Paper Scissors rules and its commit-reveal. Pure: no DOM, no network.
// With no referee, the player who sends second could peek. So each player first
// sends SHA-256(rps|room|round|move|nonce), and only reveals move+nonce once both
// hashes are in. The other side checks the reveal against the earlier hash.

import {randomNonce, sha256Hex} from '../../crypto.js';

export const MOVES = ['rock', 'paper', 'scissors'];

const BEATS = {rock: 'scissors', paper: 'rock', scissors: 'paper'};

/** @returns {'win'|'lose'|'draw'} from the point of view of `mine`. */
export function resolve(mine, theirs) {
  if (mine === theirs) return 'draw';
  return BEATS[mine] === theirs ? 'win' : 'lose';
}

const preimage = ({roomId, round, move, nonce}) => `rps|${roomId}|${round}|${move}|${nonce}`;

export async function makeCommit({roomId, round, move, nonce = randomNonce()}) {
  return {nonce, hash: await sha256Hex(preimage({roomId, round, move, nonce}))};
}

export async function verifyReveal({roomId, round, move, nonce, hash}) {
  if (!MOVES.includes(move)) return false;
  return (await sha256Hex(preimage({roomId, round, move, nonce}))) === hash;
}
