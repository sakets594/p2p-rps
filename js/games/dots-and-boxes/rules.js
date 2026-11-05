// Dots and Boxes rules for TurnMatch. The board is SIZE x SIZE boxes. A move is a line between two
// neighbouring dots: {h: true, r, c} runs along dot row r from dot column c to c+1;
// {h: false, r, c} runs down dot column c from dot row r to r+1.
// Closing a box scores it and earns another move. state: {h, v, owner, turn, scores}
//   h[r][c]  seat who drew it | null    (r 0..SIZE, c 0..SIZE-1)
//   v[r][c]  seat who drew it | null    (r 0..SIZE-1, c 0..SIZE)
//   owner[r][c]  seat who closed the box | null

export const SIZE = 5;

const grid = (rows, cols) => Array.from({length: rows}, () => Array(cols).fill(null));

export const boxSides = (s, r, c) => [s.h[r][c], s.h[r + 1][c], s.v[r][c], s.v[r][c + 1]];

export const dotsRules = {
  create: ({first}) => ({h: grid(SIZE + 1, SIZE), v: grid(SIZE, SIZE + 1), owner: grid(SIZE, SIZE), turn: first, scores: [0, 0]}),
  turn: (s) => s.turn,
  legal(s, seat, m) {
    if (!m || typeof m.h !== 'boolean' || !Number.isInteger(m.r) || !Number.isInteger(m.c)) return false;
    const rows = m.h ? SIZE + 1 : SIZE;
    const cols = m.h ? SIZE : SIZE + 1;
    if (m.r < 0 || m.r >= rows || m.c < 0 || m.c >= cols) return false;
    return (m.h ? s.h : s.v)[m.r][m.c] === null;
  },
  apply(s, seat, m) {
    const n = {h: s.h.map((x) => [...x]), v: s.v.map((x) => [...x]), owner: s.owner.map((x) => [...x]), turn: s.turn, scores: [...s.scores]};
    (m.h ? n.h : n.v)[m.r][m.c] = seat;
    // The boxes this line borders: above and below a horizontal line, left and right of a vertical one.
    const touched = m.h ? [[m.r - 1, m.c], [m.r, m.c]] : [[m.r, m.c - 1], [m.r, m.c]];
    let closed = 0;
    for (const [r, c] of touched) {
      if (r < 0 || c < 0 || r >= SIZE || c >= SIZE || n.owner[r][c] !== null) continue;
      if (boxSides(n, r, c).every((x) => x !== null)) { n.owner[r][c] = seat; n.scores[seat]++; closed++; }
    }
    n.turn = closed ? seat : 1 - seat;
    return n;
  },
  outcome(s) {
    if (s.scores[0] + s.scores[1] < SIZE * SIZE) return null;
    return {winner: s.scores[0] === s.scores[1] ? null : s.scores[0] > s.scores[1] ? 0 : 1};
  },
};
