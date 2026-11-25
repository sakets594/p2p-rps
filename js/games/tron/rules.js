// Tron Light Cycles rules: pure and deterministic, no DOM, no clock. Two bikes move one cell per tick and leave a
// wall behind them; hitting any wall (the edge, a trail, the other bike) crashes you. Both players run this same
// code on the same inputs, so only inputs travel over the network (see match.js).

export const W = 36;
export const H = 36;
export const UP = 0; export const RIGHT = 1; export const DOWN = 2; export const LEFT = 3;
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];
export const opposite = (d) => (d + 2) % 4;
export const validDir = (d) => Number.isInteger(d) && d >= 0 && d <= 3;

/** Fresh round: seat 0 starts on the left heading right, seat 1 on the right heading left. */
export function newRound() {
  const my = Math.floor(H / 2);
  const bikes = [
    {x: 5, y: my - 1, d: RIGHT, alive: true},
    {x: W - 6, y: my, d: LEFT, alive: true},
  ];
  const grid = new Uint8Array(W * H); // 0 empty, 1 = seat 0's trail, 2 = seat 1's trail
  bikes.forEach((b, i) => { grid[b.y * W + b.x] = i + 1; });
  const paths = bikes.map((b) => [b.y * W + b.x]); // each bike's cells in order, for drawing a continuous trail
  return {tick: 0, bikes, grid, paths, over: false, winner: null, crashed: []};
}

export const cell = (state, x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 3 : state.grid[y * W + x]);

/**
 * Advance one tick in place. `dirs` is [dir or null, dir or null]: a turn each player asked for (null keeps going
 * straight). A reversal into your own trail is ignored. Returns the state.
 * Ends the round when someone crashes: `winner` is 0, 1, or 'draw' (both crashed on the same tick).
 */
export function step(state, dirs) {
  if (state.over) return state;
  const next = state.bikes.map((b, i) => {
    const want = dirs[i];
    const d = validDir(want) && want !== opposite(b.d) ? want : b.d;
    return {d, x: b.x + DX[d], y: b.y + DY[d]};
  });
  const crashed = next.map((n, i) => cell(state, n.x, n.y) !== 0 || (next[1 - i].x === n.x && next[1 - i].y === n.y));
  state.bikes.forEach((b, i) => {
    b.d = next[i].d;
    if (crashed[i]) { b.alive = false; return; }
    b.x = next[i].x; b.y = next[i].y;
    state.grid[b.y * W + b.x] = i + 1;
    state.paths[i].push(b.y * W + b.x);
  });
  state.tick++;
  state.crashed = crashed.flatMap((c, i) => (c ? [i] : []));
  if (state.crashed.length) {
    state.over = true;
    state.winner = state.crashed.length === 2 ? 'draw' : 1 - state.crashed[0];
  }
  return state;
}

/** A number that summarizes the state, so the two sides can check they still agree. */
export function stateHash(state) {
  let h = 0x811c9dc5;
  const mix = (n) => { h ^= n & 0xff; h = Math.imul(h, 0x01000193) >>> 0; h ^= (n >>> 8) & 0xff; h = Math.imul(h, 0x01000193) >>> 0; };
  mix(state.tick);
  for (const b of state.bikes) { mix(b.x); mix(b.y); mix(b.d); mix(b.alive ? 1 : 0); }
  return h >>> 0;
}

/** Milliseconds per tick: starts calm and speeds up a little the longer a round lasts. */
export const tickMsAt = (tick) => Math.max(62, 105 - Math.floor(tick / 14));

export const ROUNDS_TO_WIN = 2;
export const MAX_ROUNDS = 5;
export const INPUT_DELAY = 2; // a turn you ask for is applied this many ticks later, on both screens
