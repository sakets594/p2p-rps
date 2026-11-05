import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TurnMatch} from '../js/games/turn-match.js';
import {tttRules} from '../js/games/tic-tac-toe/rules.js';
import {connectFourRules, COLS, ROWS} from '../js/games/connect-four/rules.js';
import {dotsRules, SIZE} from '../js/games/dots-and-boxes/rules.js';
import {memoryRules, PAIRS} from '../js/games/memory-match/rules.js';
import {firstSeat, seededRandom, shuffled} from '../js/rng.js';
import {memorySessions, settle} from '../js/memory-transport.js';

const play = (rules, state, moves) => moves.reduce((s, [seat, m]) => {
  assert.equal(rules.turn(s), seat, `turn before ${JSON.stringify(m)}`);
  assert.ok(rules.legal(s, seat, m), `legal ${JSON.stringify(m)}`);
  return rules.apply(s, seat, m);
}, state);

test('rng: same seed gives the same shuffle, and firstSeat is stable and 0 or 1', () => {
  const a = shuffled([1, 2, 3, 4, 5, 6, 7, 8], seededRandom('x'));
  const b = shuffled([1, 2, 3, 4, 5, 6, 7, 8], seededRandom('x'));
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort(), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(firstSeat('abc'), firstSeat('abc'));
  const seats = new Set(Array.from({length: 40}, (_, i) => firstSeat(`s${i}`)));
  assert.deepEqual([...seats].sort(), [0, 1]);
});

test('tic-tac-toe: three in a row wins, a full board without one is a draw', () => {
  let s = play(tttRules, tttRules.create({first: 0}), [[0, 0], [1, 3], [0, 1], [1, 4], [0, 2]]);
  assert.deepEqual(tttRules.outcome(s), {winner: 0});
  assert.deepEqual(s.line, [0, 1, 2]);
  assert.equal(tttRules.legal(s, 1, 8), false, 'no moves after the game is won');

  // X O X / X O O / O X X : a draw
  const order = [0, 1, 2, 4, 3, 5, 7, 6, 8];
  s = tttRules.create({first: 0});
  order.forEach((cell, i) => { s = tttRules.apply(s, i % 2, cell); });
  assert.deepEqual(tttRules.outcome(s), {winner: null});
});

test('tic-tac-toe: occupied cells and bad cells are illegal', () => {
  const s = tttRules.apply(tttRules.create({first: 0}), 0, 4);
  for (const bad of [4, -1, 9, 1.5, '1', null, undefined]) assert.equal(tttRules.legal(s, 1, bad), false, String(bad));
});

test('connect four: discs fall to the lowest row; four in a column, row and diagonal win', () => {
  let s = connectFourRules.create({first: 0});
  s = play(connectFourRules, s, [[0, 3], [1, 3]]);
  assert.equal(s.grid[ROWS - 1][3], 0);
  assert.equal(s.grid[ROWS - 2][3], 1);

  const vertical = play(connectFourRules, connectFourRules.create({first: 0}), [[0, 0], [1, 1], [0, 0], [1, 1], [0, 0], [1, 1], [0, 0]]);
  assert.deepEqual(connectFourRules.outcome(vertical), {winner: 0});

  const horizontal = play(connectFourRules, connectFourRules.create({first: 1}), [[1, 0], [0, 0], [1, 1], [0, 1], [1, 2], [0, 2], [1, 3]]);
  assert.deepEqual(connectFourRules.outcome(horizontal), {winner: 1});

  // seat 0 builds a rising diagonal on columns 0..3
  const diagonal = play(connectFourRules, connectFourRules.create({first: 0}), [
    [0, 0], [1, 1], [0, 1], [1, 2], [0, 6], [1, 2], [0, 2], [1, 3], [0, 3], [1, 3], [0, 3],
  ]);
  assert.deepEqual(connectFourRules.outcome(diagonal), {winner: 0});
  assert.equal(diagonal.line.length, 4);
});

test('connect four: a full column is illegal and a full board is a draw', () => {
  const s = connectFourRules.create({first: 0});
  s.grid = [
    [0, 0, 1, 1, 0, 0, 1], [1, 1, 0, 0, 1, 1, 0], [0, 0, 1, 1, 0, 0, 1],
    [1, 1, 0, 0, 1, 1, 0], [0, 0, 1, 1, 0, 0, 1], [1, 1, 0, 0, 1, 1, 0],
  ];
  assert.deepEqual(connectFourRules.outcome(s), {winner: null});
  assert.equal(connectFourRules.legal(s, 0, 2), false, 'a full column is illegal');
});

test('dots and boxes: closing a box scores it and keeps the turn; otherwise the turn passes', () => {
  let s = dotsRules.create({first: 0});
  s = play(dotsRules, s, [
    [0, {h: true, r: 0, c: 0}], [1, {h: false, r: 0, c: 0}], [0, {h: false, r: 0, c: 1}],
  ]);
  assert.equal(s.turn, 1);
  s = dotsRules.apply(s, 1, {h: true, r: 1, c: 0}); // closes box (0,0)
  assert.equal(s.owner[0][0], 1);
  assert.deepEqual(s.scores, [0, 1]);
  assert.equal(s.turn, 1, 'a closed box earns another move');
});

test('dots and boxes: one line can close two boxes, drawn lines are illegal, and the board fills to a winner', () => {
  let s = dotsRules.create({first: 0});
  // Boxes (0,0) and (0,1) both need the shared vertical line v[0][1] last.
  const sides = [
    {h: true, r: 0, c: 0}, {h: true, r: 1, c: 0}, {h: false, r: 0, c: 0},
    {h: true, r: 0, c: 1}, {h: true, r: 1, c: 1}, {h: false, r: 0, c: 2},
  ];
  for (const m of sides) s = dotsRules.apply(s, s.turn, m);
  s.turn = 1;
  s = dotsRules.apply(s, 1, {h: false, r: 0, c: 1});
  assert.deepEqual(s.scores, [0, 2]);
  assert.equal(dotsRules.legal(s, 1, {h: false, r: 0, c: 1}), false);
  for (const bad of [null, {h: true, r: SIZE + 1, c: 0}, {h: false, r: 0, c: SIZE + 1}, {h: 1, r: 0, c: 0}, {h: true, r: -1, c: 0}]) {
    assert.equal(dotsRules.legal(s, 1, bad), false, JSON.stringify(bad));
  }

  // Draw every remaining line: the game ends with a decided winner (odd number of boxes)
  let t = dotsRules.create({first: 0});
  for (let r = 0; r <= SIZE; r++) for (let c = 0; c < SIZE; c++) t = dotsRules.apply(t, t.turn, {h: true, r, c});
  for (let r = 0; r < SIZE; r++) for (let c = 0; c <= SIZE; c++) t = dotsRules.apply(t, t.turn, {h: false, r, c});
  assert.equal(t.scores[0] + t.scores[1], SIZE * SIZE);
  assert.ok(dotsRules.outcome(t).winner !== null);
});

test('memory match: layout is identical for the same seed and has every symbol twice', () => {
  const a = memoryRules.create({seed: 'game-1', first: 0});
  const b = memoryRules.create({seed: 'game-1', first: 0});
  const c = memoryRules.create({seed: 'game-2', first: 0});
  assert.deepEqual(a.cards, b.cards);
  assert.notDeepEqual(a.cards, c.cards);
  assert.equal(a.cards.length, PAIRS * 2);
  for (const sym of new Set(a.cards)) assert.equal(a.cards.filter((x) => x === sym).length, 2);
});

test('memory match: a pair scores and keeps the turn, a miss shows both cards and passes the turn', () => {
  const s0 = memoryRules.create({seed: 'k', first: 0});
  const first = 0;
  const twin = s0.cards.findIndex((x, i) => i !== first && x === s0.cards[first]);
  const other = s0.cards.findIndex((x) => x !== s0.cards[first]);

  let s = play(memoryRules, s0, [[0, first], [0, twin]]);
  assert.deepEqual(s.scores, [1, 0]);
  assert.equal(s.turn, 0);
  assert.equal(s.matched[first], 0);
  assert.equal(memoryRules.legal(s, 0, first), false, 'a matched card cannot be flipped again');

  s = play(memoryRules, s, [[0, other], [0, s.cards.findIndex((x, i) => x !== s.cards[other] && s.matched[i] === null)]]);
  assert.equal(s.turn, 1);
  assert.equal(s.peek.length, 2);
  assert.equal(memoryRules.apply(s, 1, s.cards.findIndex((x, i) => s.matched[i] === null && !s.peek.includes(i))).peek.length, 0, 'the next flip clears the peek');
});

test('memory match: matching every pair ends the game with the higher score winning', () => {
  let s = memoryRules.create({seed: 'full', first: 0});
  const seen = new Set();
  for (let i = 0; i < s.cards.length; i++) {
    if (s.matched[i] !== null) continue;
    const j = s.cards.findIndex((x, k) => k !== i && x === s.cards[i] && s.matched[k] === null);
    s = memoryRules.apply(memoryRules.apply(s, 0, i), 0, j);
    seen.add(i);
  }
  assert.deepEqual(memoryRules.outcome(s), {winner: 0});
  assert.deepEqual(s.scores, [PAIRS, 0]);
});

// --- TurnMatch over the in-memory network -------------------------------------------------

function setup(rules = tttRules) {
  const {sessions: [sa, sb]} = memorySessions();
  const a = new TurnMatch({session: sa, rules});
  const b = new TurnMatch({session: sb, rules});
  return {a, b, sa, sb};
}

test('turn match: both sides agree on who is first and whose turn it is', () => {
  const {a, b} = setup();
  assert.equal(a.snapshot().turn, b.snapshot().turn);
  assert.equal(a.snapshot().myTurn, !b.snapshot().myTurn);
  assert.equal(a.snapshot().seat, 0);
  assert.equal(b.snapshot().seat, 1);
  assert.equal(a.snapshot().opponentName, 'Bob');
});

test('turn match: a move shows up on the other side, out of turn is refused', async () => {
  const {a, b} = setup();
  const [mover, waiter] = a.snapshot().myTurn ? [a, b] : [b, a];
  assert.equal(waiter.play(0), false, 'not my turn');
  assert.equal(mover.play(4), true);
  await settle();
  assert.equal(waiter.snapshot().state.board[4], mover.seat);
  assert.equal(waiter.snapshot().myTurn, true);
  assert.equal(mover.play(5), false, 'it is now their turn');
  assert.equal(waiter.play(4), false, 'cell taken');
});

test('turn match: a finished game reports the winner once, on both sides', async () => {
  const {a, b, sa, sb} = setup();
  const players = a.snapshot().myTurn ? [a, b] : [b, a];
  const [x, o] = players; // x moves first
  for (const [m, cell] of [[x, 0], [o, 3], [x, 1], [o, 4], [x, 2]]) { m.play(cell); await settle(); }
  assert.equal(x.snapshot().won, true);
  assert.equal(o.snapshot().won, false);
  assert.equal(sa.result?.winnerId, x === a ? 'alice' : 'bob');
  assert.deepEqual(sa.result, sb.result);
});

test('turn match: a draw reports an empty result', async () => {
  const {a, b, sa} = setup();
  const [x, o] = a.snapshot().myTurn ? [a, b] : [b, a];
  const order = [0, 1, 2, 4, 3, 5, 7, 6, 8];
  for (let i = 0; i < order.length; i++) { (i % 2 ? o : x).play(order[i]); await settle(); }
  assert.equal(x.snapshot().over.winner, null);
  assert.deepEqual(sa.result, {});
});

test('turn match: repeated, skipped or illegal incoming moves are ignored or flagged, never applied', async () => {
  const {a, b, sa, sb, } = setup();
  const [x, o] = a.snapshot().myTurn ? [a, b] : [b, a];
  const sx = x === a ? sa : sb;
  x.play(4);
  await settle();
  const before = JSON.stringify(o.snapshot().state);
  sx.send({t: 'move', n: 1, move: 4}); // a repeat
  sx.send({t: 'move', n: 5, move: 0}); // a skip
  sx.send({t: 'nonsense'});
  await settle();
  assert.equal(JSON.stringify(o.snapshot().state), before);
  assert.equal(o.snapshot().error, null);
  sx.send({t: 'move', n: 2, move: 0}); // it is the other player's turn, so this is cheating
  await settle();
  assert.equal(JSON.stringify(o.snapshot().state), before);
  assert.match(o.snapshot().error, /Start a new game/);
});

test('turn match drives every rule set to completion with the same result on both sides', async () => {
  for (const [rules, movesFor] of [
    [connectFourRules, (s) => [...Array(COLS).keys()].find((c) => connectFourRules.legal(s, 0, c))],
    [memoryRules, (s) => {
      const first = s.up[0] ?? s.cards.findIndex((_, i) => memoryRules.legal(s, 0, i));
      return s.up.length ? s.cards.findIndex((x, i) => i !== first && x === s.cards[first] && s.matched[i] === null) : first;
    }],
  ]) {
    const {a, b, sa, sb} = setup(rules);
    for (let guard = 0; guard < 400 && !a.snapshot().over; guard++) {
      const mover = a.snapshot().myTurn ? a : b;
      mover.play(movesFor(mover.snapshot().state));
      await settle(2);
    }
    assert.ok(a.snapshot().over, 'game finished');
    assert.equal(JSON.stringify(a.snapshot().state), JSON.stringify(b.snapshot().state));
    assert.deepEqual(sa.result, sb.result);
  }
});
