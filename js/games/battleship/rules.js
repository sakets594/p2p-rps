// Battleship rules: a 10x10 sea, five ships, no DOM and no network. A fleet is
// [{size, r, c, h}]: the ship starts at row r, column c and runs right (h) or down.

export const SIZE = 10;
export const SHIPS = [5, 4, 3, 3, 2];

export const cellsOf = (ship) => Array.from({length: ship.size}, (_, i) => [ship.r + (ship.h ? 0 : i), ship.c + (ship.h ? i : 0)]);
export const keyOf = (r, c) => `${r},${c}`;
const inSea = (r, c) => Number.isInteger(r) && Number.isInteger(c) && r >= 0 && c >= 0 && r < SIZE && c < SIZE;

/** True if this is exactly the allowed ships, inside the sea, none overlapping. */
export function validFleet(fleet) {
  if (!Array.isArray(fleet) || fleet.length !== SHIPS.length) return false;
  const sizes = fleet.map((s) => s?.size);
  if ([...sizes].sort().join() !== [...SHIPS].sort().join()) return false;
  const used = new Set();
  for (const ship of fleet) {
    if (typeof ship.h !== 'boolean') return false;
    for (const [r, c] of cellsOf(ship)) {
      if (!inSea(r, c) || used.has(keyOf(r, c))) return false;
      used.add(keyOf(r, c));
    }
  }
  return true;
}

/** A random legal fleet; `random` is any () => [0, 1) function. */
export function randomFleet(random = Math.random) {
  const fleet = [];
  const used = new Set();
  for (const size of SHIPS) {
    for (;;) {
      const ship = {size, h: random() < 0.5, r: 0, c: 0};
      ship.r = Math.floor(random() * (ship.h ? SIZE : SIZE - size + 1));
      ship.c = Math.floor(random() * (ship.h ? SIZE - size + 1 : SIZE));
      const cells = cellsOf(ship);
      if (cells.some(([r, c]) => used.has(keyOf(r, c)))) continue;
      cells.forEach(([r, c]) => used.add(keyOf(r, c)));
      fleet.push(ship);
      break;
    }
  }
  return fleet;
}

/** What a shot at (r, c) does to this fleet, given the cells already shot (a Set of keys, not including this one). */
export function resolveShot(fleet, shot, r, c) {
  const ship = fleet.find((s) => cellsOf(s).some(([sr, sc]) => sr === r && sc === c));
  if (!ship) return {hit: false, sunk: 0, over: false};
  const after = new Set(shot).add(keyOf(r, c));
  const sunk = cellsOf(ship).every(([sr, sc]) => after.has(keyOf(sr, sc))) ? ship.size : 0;
  const over = fleet.every((s) => cellsOf(s).every(([sr, sc]) => after.has(keyOf(sr, sc))));
  return {hit: true, sunk, over};
}

/** The text that gets hashed for the commitment: the fleet in a fixed order plus a secret nonce. */
export const commitText = (fleet, nonce) =>
  `${fleet.map((s) => `${s.size},${s.r},${s.c},${s.h ? 1 : 0}`).join(';')}|${nonce}`;
