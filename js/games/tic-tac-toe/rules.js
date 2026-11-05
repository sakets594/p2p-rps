// Tic-Tac-Toe rules for TurnMatch (see js/games/turn-match.js). Seat 0 plays X, seat 1 plays O.
// state: {board: 9 cells holding null | 0 | 1, turn: seat, line: winning cells | null}

export const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export const tttRules = {
  create: ({first}) => ({board: Array(9).fill(null), turn: first, line: null}),
  turn: (s) => s.turn,
  legal: (s, seat, i) => Number.isInteger(i) && i >= 0 && i < 9 && s.board[i] === null && !s.line,
  apply(s, seat, i) {
    const board = [...s.board];
    board[i] = seat;
    const line = LINES.find((l) => l.every((c) => board[c] === seat)) ?? null;
    return {board, turn: 1 - seat, line};
  },
  outcome(s) {
    if (s.line) return {winner: s.board[s.line[0]]};
    return s.board.every((c) => c !== null) ? {winner: null} : null;
  },
};
