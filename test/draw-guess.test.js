import {afterEach, test} from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUNDS, drawerPoints, guesserPoints, isClose, isCorrect, normalizeGuess, pickChoices, validChunk, wordShape,
} from '../js/games/draw-guess/rules.js';
import {WORDS} from '../js/games/draw-guess/words.js';
import {DrawGuessMatch} from '../js/games/draw-guess/match.js';
import {memorySessions, settle} from '../js/memory-transport.js';

test('words: every word is lowercase letters, one or two words, no repeats', () => {
  for (const w of WORDS) assert.match(w, /^[a-z]+( [a-z]+)?$/, w);
  assert.equal(new Set(WORDS).size, WORDS.length);
});

test('rules: guesses match loosely but not wrongly', () => {
  assert.equal(normalizeGuess('  Ice-Cream! '), 'icecream');
  assert.equal(isCorrect('Ice Cream', 'ice cream'), true);
  assert.equal(isCorrect('cats', 'cat'), true);
  assert.equal(isCorrect('cat', 'cats'), true);
  assert.equal(isCorrect('', 'cat'), false);
  assert.equal(isCorrect('dog', 'cat'), false);
  assert.equal(isClose('pizzs', 'pizza'), true);
  assert.equal(isClose('pizza', 'pizza'), false, 'a right answer is not "close"');
  assert.equal(isClose('cet', 'cat'), false, 'three-letter words are too easy to be "close"');
  assert.deepEqual(wordShape('ice cream'), [3, 5]);
});

test('rules: points fall from 100 to 50 as time runs out; the drawer gets half', () => {
  assert.equal(guesserPoints(60_000, 60_000), 100);
  assert.equal(guesserPoints(30_000, 60_000), 75);
  assert.equal(guesserPoints(0, 60_000), 50);
  assert.equal(guesserPoints(-5, 60_000), 50);
  assert.equal(drawerPoints(100), 50);
});

test('rules: three different choices, and stroke chunks are validated', () => {
  const c = pickChoices(Math.random);
  assert.equal(c.length, 3);
  assert.equal(new Set(c).size, 3);
  assert.equal(validChunk({i: 0, c: 1, w: 1, p: [0, 0, 1000, 1000]}), true);
  assert.equal(validChunk({i: 0, c: 9, w: 1, p: [0, 0]}), false, 'unknown colour');
  assert.equal(validChunk({i: 0, c: 1, w: 1, p: [0, 0, 5]}), false, 'odd number of coordinates');
  assert.equal(validChunk({i: 0, c: 1, w: 1, p: [0, 1001]}), false, 'off the canvas');
  assert.equal(validChunk({i: 0, c: 1, w: 1, p: [0.5, 1]}), false, 'not an integer');
});

const live = [];
afterEach(() => { for (const m of live.splice(0)) m.destroy(); }); // a round left open would keep its 60 s timer alive

function pair(opts = {}) {
  const {net, sessions: [sa, sb]} = memorySessions();
  const a = new DrawGuessMatch({session: sa, ...opts});
  const b = new DrawGuessMatch({session: sb, ...opts});
  live.push(a, b);
  const [drawer, guesser] = a.snapshot().iDraw ? [a, b] : [b, a];
  return {net, a, b, sa, sb, drawer, guesser};
}

/** The drawer picks the first offered word. */
async function pick(drawer) {
  const word = drawer.snapshot().choices[0];
  assert.equal(await drawer.chooseWord(word), true);
  await settle();
  return word;
}

test('roles: exactly one side draws, they alternate, and only the drawer is offered words', () => {
  const {drawer, guesser} = pair();
  assert.equal(drawer.snapshot().iDraw, true);
  assert.equal(guesser.snapshot().iDraw, false);
  assert.equal(drawer.snapshot().choices.length, 3);
  assert.equal(guesser.snapshot().choices, null);
  assert.equal(guesser.snapshot().phase, 'choosing');
});

test('a word must be one of the offered ones, and the guesser sees only its shape', async () => {
  const {drawer, guesser} = pair();
  assert.equal(await drawer.chooseWord('definitely not offered'), false);
  assert.equal(await guesser.chooseWord('cat'), false);
  const word = await pick(drawer);
  assert.equal(guesser.snapshot().phase, 'drawing');
  assert.deepEqual(guesser.snapshot().shape, word.split(' ').map((w) => w.length));
  assert.equal(guesser.snapshot().word, null, 'the word stays secret');
  assert.equal(drawer.snapshot().word, word);
});

test('strokes reach the guesser exactly as drawn, and undo and clear follow', async () => {
  const {drawer, guesser} = pair();
  await pick(drawer);
  drawer.beginStroke(1, 2, 10, 20);
  drawer.extendStroke(30, 40);
  drawer.extendStroke(50, 60);
  drawer.endStroke();
  drawer.beginStroke(3, 0, 500, 500);
  drawer.endStroke();
  await settle();
  assert.deepEqual(guesser.snapshot().strokes, [
    {c: 1, w: 2, p: [10, 20, 30, 40, 50, 60]},
    {c: 3, w: 0, p: [500, 500]},
  ]);
  const rev = guesser.snapshot().canvasRev;
  drawer.undo();
  await settle();
  assert.equal(guesser.snapshot().strokes.length, 1);
  assert.ok(guesser.snapshot().canvasRev > rev, 'the view is told to repaint');
  drawer.clear();
  await settle();
  assert.equal(guesser.snapshot().strokes.length, 0);
});

test('guessers cannot draw, and out-of-range points are clamped onto the canvas', async () => {
  const {drawer, guesser} = pair();
  await pick(drawer);
  assert.equal(guesser.beginStroke(0, 0, 1, 1), false);
  drawer.beginStroke(0, 0, -50, 5000);
  drawer.endStroke();
  await settle();
  assert.deepEqual(guesser.snapshot().strokes[0].p, [0, 1000]);
});

test('a wrong guess is answered, a right one scores both sides identically and ends the round', async () => {
  const {drawer, guesser} = pair();
  const word = await pick(drawer);
  assert.equal(guesser.guess('zzzzzz'), true);
  await settle();
  assert.equal(guesser.snapshot().guesses[0].ok, false);
  assert.equal(drawer.snapshot().guesses.length, 1, 'the drawer watches the guesses come in');
  assert.equal(guesser.snapshot().phase, 'drawing');

  guesser.guess(word.toUpperCase());
  await settle();
  const g = guesser.snapshot();
  const d = drawer.snapshot();
  assert.equal(g.phase, 'roundover');
  assert.equal(d.phase, 'roundover');
  assert.equal(g.reason, 'solved');
  assert.ok(g.points >= 50 && g.points <= 100);
  assert.deepEqual(g.scores, d.scores, 'both sides agree on the score');
  assert.equal(g.scores[g.seat], g.points);
  assert.equal(g.scores[d.seat], Math.round(g.points / 2));
  assert.equal(g.word, word, 'the word is shown to the guesser after the round');
  assert.equal(g.verified, true);
  assert.equal(g.error, null);
});

test('time running out ends the round with no points, and the word is revealed and verified', async () => {
  const {drawer, guesser} = pair({roundMs: 2_000});
  const word = await pick(drawer);
  guesser.guess('nope');
  await settle(2_150);
  assert.equal(guesser.snapshot().phase, 'roundover');
  assert.equal(guesser.snapshot().reason, 'time');
  assert.deepEqual(guesser.snapshot().scores, [0, 0]);
  assert.equal(guesser.snapshot().word, word);
  assert.equal(guesser.snapshot().verified, true);
  assert.equal(guesser.guess('late'), false, 'no guessing after time is up');
});

test('hints appear for the guesser at half time and never give the whole word away', async () => {
  const {drawer, guesser} = pair({roundMs: 2_000});
  const word = await pick(drawer);
  await settle(1_700);
  const hints = guesser.snapshot().hints.filter(Boolean);
  assert.ok(hints.length >= 1 || word.replace(/ /g, '').length <= 2);
  assert.ok(hints.length < word.replace(/ /g, '').length);
  const letters = word.replace(/ /g, '');
  guesser.snapshot().hints.forEach((ch, i) => { if (ch) assert.equal(ch, letters[i]); });
  await settle(500);
});

test('a drawer who lies about a guess is caught at the reveal', async () => {
  const {drawer, guesser, net} = pair();
  const word = await pick(drawer);
  // The drawer's side answers "wrong" to every guess, even a right one.
  net.intercept = (_from, _to, msg) => (msg.t === 'answer' ? {...msg, ok: false, pts: undefined} : msg);
  guesser.guess(word);
  await settle();
  net.intercept = null;
  drawer.skip();
  await settle();
  assert.equal(guesser.snapshot().phase, 'roundover');
  assert.equal(guesser.snapshot().verified, false);
  assert.match(guesser.snapshot().error, /cheated/);
});

test('a drawer who swaps the word after locking it in is caught', async () => {
  const {drawer, guesser, net} = pair();
  await pick(drawer);
  net.intercept = (_from, _to, msg) => (msg.t === 'end' ? {...msg, word: 'banana'} : msg);
  drawer.skip();
  await settle();
  assert.equal(guesser.snapshot().verified, false);
});

test('junk messages are ignored', async () => {
  const {drawer, guesser, a, sa, sb} = pair();
  await pick(drawer);
  const inbox = guesser === a ? sa : sb;
  const before = JSON.stringify({...guesser.snapshot(), strokes: null});
  for (const m of [null, 'x', 7, {t: 'stroke', round: 1, i: 5, c: 0, w: 0, p: [1, 1]}, {t: 'stroke', round: 1, i: 0, c: 99, w: 0, p: [1, 1]},
    {t: 'stroke', round: 1, i: 0, c: 0, w: 0, p: [1, 5000]}, {t: 'hint', round: 1, i: 999, ch: 'a'}, {t: 'hint', round: 1, i: 0, ch: 'ab'},
    {t: 'answer', round: 1, n: 7, ok: true, pts: 100}, {t: 'end', round: 1, word: 5, nonce: 1}, {t: 'word', round: 1, hash: 'x', shape: [3], ms: 1}]) {
    inbox.onMessage(m);
  }
  assert.equal(guesser.snapshot().strokes.length, 0);
  assert.equal(guesser.snapshot().phase, 'drawing');
  assert.equal(JSON.stringify({...guesser.snapshot(), strokes: null}), before);
  assert.deepEqual(guesser.snapshot().scores, [0, 0]);
});

test('four rounds alternate the drawer, then the higher total wins and the session finishes', async () => {
  const {drawer: d0, guesser: g0, a, b, sa, sb} = pair({roundMs: 5_000});
  const drawers = [];
  for (let round = 1; round <= ROUNDS; round++) {
    const drawer = [a, b].find((m) => m.snapshot().iDraw);
    const guesser = drawer === a ? b : a;
    drawers.push(drawer === d0 ? 'first' : 'second');
    assert.equal(drawer.snapshot().round, round);
    const word = await pick(drawer);
    // The first drawer's rounds are skipped; the other player draws theirs and the first drawer guesses it, so the first drawer wins.
    if (drawer === g0) { guesser.guess(word); } else { drawer.skip(); }
    await settle();
    assert.equal(guesser.snapshot().phase, 'roundover');
    if (round < ROUNDS) {
      a.next(); b.next();
      await settle();
    }
  }
  assert.deepEqual(drawers, ['first', 'second', 'first', 'second']);
  assert.equal(a.snapshot().finished, true);
  assert.equal(b.snapshot().finished, true);
  assert.deepEqual(a.snapshot().scores, b.snapshot().scores);
  const winner = sa.players[d0.snapshot().seat].id;
  assert.deepEqual(sa.result, {winnerId: winner});
  assert.deepEqual(sb.result, {winnerId: winner});
});

test('a mode is carried in the snapshot, and the blind drawer still sends real strokes', async () => {
  const {drawer, guesser} = pair({mode: 'blind'});
  assert.equal(drawer.snapshot().mode, 'blind');
  await pick(drawer);
  drawer.beginStroke(0, 1, 100, 100);
  drawer.extendStroke(200, 200);
  drawer.endStroke();
  await settle();
  assert.equal(guesser.snapshot().strokes.length, 1);
});
