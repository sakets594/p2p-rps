// Connect Four rules for TurnMatch. A move is a column number 0..6; the disc falls to the lowest free row.
// state: {grid: rows from the top, each COLS cells null | 0 | 1, turn: seat, line: winning cells [[r, c] x4] | null,
//         last: [r, c] | null}

export const COLS = 7;
export const ROWS = 6;

const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

export function findLine(grid, r, c, seat) {
  for (const [dr, dc] of DIRS) {
    const cells = [[r, c]];
    for (const sign of [1, -1]) {
      let rr = r + dr * sign, cc = c + dc * sign;
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && grid[rr][cc] === seat) {
        cells.push([rr, cc]);
        rr += dr * sign; cc += dc * sign;
      }
    }
    if (cells.length >= 4) return cells.slice(0, 4).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }
  return null;
}

export const connectFourRules = {
  create: ({first}) => ({grid: Array.from({length: ROWS}, () => Array(COLS).fill(null)), turn: first, line: null, last: null}),
  turn: (s) => s.turn,
  legal: (s, seat, col) => Number.isInteger(col) && col >= 0 && col < COLS && s.grid[0][col] === null && !s.line,
  apply(s, seat, col) {
    const grid = s.grid.map((row) => [...row]);
    let r = ROWS - 1;
    while (grid[r][col] !== null) r--;
    grid[r][col] = seat;
    return {grid, turn: 1 - seat, line: findLine(grid, r, col, seat), last: [r, col]};
  },
  outcome(s) {
    if (s.line) return {winner: s.grid[s.line[0][0]][s.line[0][1]]};
    return s.grid[0].every((c) => c !== null) ? {winner: null} : null;
  },
};
