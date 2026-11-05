import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MAX_WRONG, cleanWord, consistent, positionsOf, roundState, validWord} from '../js/games/hangman/rules.js';
import {HangmanMatch, ROUNDS} from '../js/games/hangman/match.js';
import {memorySessions, settle} from '../js/memory-transport.js';

test('rules: words are cleaned and validated', () => {
  assert.equal(cleanWord('  Hello, World! 42 '), 'helloworld');
  assert.equal(validWord('ab'), false);
  assert.equal(validWord('abcdefghijklm'), false);
  assert.equal(validWord('Hello'), false, 'must already be lowercase letters');
  assert.equal(validWord('hello'), true);
  assert.deepEqual(positionsOf('banana', 'a'), [1, 3, 5]);
  assert.deepEqual(positionsOf('banana', 'z'), []);
});

test('rules: roundState tracks revealed letters, wrong letters, solved and hanged', () => {
  let rs = roundState(3, [{letter: 'a', positions: [0, 2]}, {letter: 'z', positions: []}]);
  assert.deepEqual(rs.revealed, ['a', null, 'a']);
  assert.deepEqual(rs.wrong, ['z']);
  assert.equal(rs.done, false);
  rs = roundState(3, [{letter: 'a', positions: [0, 2]}, {letter: 'b', positions: [1]}]);
  assert.equal(rs.solved, true);
  rs = roundState(2, 'qwerty'.split('').map((l) => ({letter: l, positions: []})));
  assert.equal(rs.wrongCount, MAX_WRONG);
  assert.equal(rs.hanged, true);
  assert.equal(consistent('cat', [{letter: 'c', positions: [0]}, {letter: 'z', positions: []}]), true);
  assert.equal(consistent('cat', [{letter: 'a', positions: []}]), false);
});

function pair() {
  const {net, sessions: [sa, sb]} = memorySessions();
  const a = new HangmanMatch({session: sa});
  const b = new HangmanMatch({session: sb});
  const setter = a.snapshot().iAmSetter ? [a, b] : [b, a];
  return {net, a, b, sa, sb, setter0: setter[0], guesser0: setter[1]};
}

async function playRound(setter, guesser, word, letters) {
  assert.equal(await setter.chooseWord(word), true);
  await settle();
  for (const l of letters) { guesser.guess(l); await settle(); }
}

test('the first setter is agreed and only they can choose a word', async () => {
  const {a, b, setter0, guesser0} = pair();
  assert.equal(a.snapshot().iAmSetter, !b.snapshot().iAmSetter);
  assert.equal(await guesser0.chooseWord('banana'), false);
  assert.equal(await setter0.chooseWord('no'), false, 'too short');
  assert.equal(await setter0.chooseWord('banana'), true);
  assert.equal(await setter0.chooseWord('apple'), false, 'cannot change it');
  await settle();
  assert.equal(guesser0.snapshot().phase, 'guessing');
  assert.equal(guesser0.snapshot().length, 6);
  assert.equal(guesser0.snapshot().word, null, 'the guesser does not see the word');
  assert.equal(setter0.snapshot().word, 'banana');
});

test('guessing letters reveals positions; the guesser wins by completing the word', async () => {
  const {setter0, guesser0} = pair();
  await playRound(setter0, guesser0, 'banana', ['a', 'z', 'b', 'n']);
  const g = guesser0.snapshot();
  assert.deepEqual(g.revealed, ['b', 'a', 'n', 'a', 'n', 'a']);
  assert.deepEqual(g.wrong, ['z']);
  assert.equal(g.phase, 'roundover');
  assert.equal(g.solved, true);
  assert.equal(g.roundWinner, guesser0.seat);
  assert.deepEqual(setter0.snapshot().scores, g.scores);
  assert.equal(g.scores[guesser0.seat], 1);
  assert.equal(g.word, 'banana');
  assert.equal(g.verified, true);
});

test('six wrong letters hang the guesser and the setter scores', async () => {
  const {setter0, guesser0} = pair();
  await playRound(setter0, guesser0, 'cat', ['q', 'w', 'e', 'r', 'y', 'u']);
  const g = guesser0.snapshot();
  assert.equal(g.hanged, true);
  assert.equal(g.roundWinner, setter0.seat);
  assert.equal(g.scores[setter0.seat], 1);
  assert.equal(g.word, 'cat', 'the word is shown after the round');
  assert.equal(guesser0.guess('c'), false, 'no guesses after the round is over');
});

test('repeat letters, out-of-turn guesses and pending guesses are refused', async () => {
  const {setter0, guesser0} = pair();
  await setter0.chooseWord('hello');
  await settle();
  assert.equal(setter0.guess('e'), false, 'the setter does not guess');
  assert.equal(guesser0.guess('1'), false);
  assert.equal(guesser0.guess('e'), true);
  assert.equal(guesser0.guess('l'), false, 'one at a time until the answer comes');
  await settle();
  assert.equal(guesser0.guess('e'), false, 'already guessed');
});

test('two rounds with roles swapped; the match ends with the higher score, same on both sides', async () => {
  const {a, b, sa, sb, setter0, guesser0} = pair();
  await playRound(setter0, guesser0, 'cat', ['c', 'a', 't']); // guesser0 wins round 1
  guesser0.next(); setter0.next();
  await settle();
  assert.equal(guesser0.snapshot().round, 2);
  assert.equal(guesser0.snapshot().iAmSetter, true, 'roles swap');
  await playRound(guesser0, setter0, 'dog', ['q', 'w', 'e', 'r', 't', 'y']); // setter0 hanged, guesser0 wins again
  assert.equal(ROUNDS, 2);
  assert.equal(sa.result?.winnerId, guesser0 === a ? 'alice' : 'bob');
  assert.deepEqual(sa.result, sb.result);
  assert.deepEqual(a.snapshot().scores, b.snapshot().scores);
  assert.equal(guesser0.snapshot().scores[guesser0.seat], 2);
});

test('a tie reports a draw', async () => {
  const {sa, setter0, guesser0} = pair();
  await playRound(setter0, guesser0, 'cat', ['c', 'a', 't']); // guesser0 +1
  guesser0.next(); setter0.next();
  await settle();
  await playRound(guesser0, setter0, 'dog', ['d', 'o', 'g']); // setter0 +1
  assert.deepEqual(sa.result, {});
});

test('a setter who lies about a letter is caught at the reveal', async () => {
  const {net, setter0, guesser0} = pair();
  const liar = setter0.seat === 0 ? 'alice' : 'bob';
  net.intercept = (from, to, msg) => (from === liar && msg.t === 'answer' && msg.letter === 'a' ? {...msg, positions: []} : msg);
  await playRound(setter0, guesser0, 'cat', ['a', 'c', 't', 'z', 'x', 'q', 'w', 'e']);
  await settle(40);
  const g = guesser0.snapshot();
  assert.equal(g.verified, false);
  assert.match(g.error, /may have cheated/);
});

test('a changed word is caught because it no longer matches the hash', async () => {
  const {net, setter0, guesser0} = pair();
  const liar = setter0.seat === 0 ? 'alice' : 'bob';
  net.intercept = (from, to, msg) => (from === liar && msg.t === 'reveal' ? {...msg, word: 'dog'} : msg);
  await playRound(setter0, guesser0, 'cat', ['c', 'a', 't']);
  await settle(40);
  assert.equal(guesser0.snapshot().verified, false);
});

test('junk messages are ignored', async () => {
  const {sa, sb, setter0, guesser0} = pair();
  const [fromSetter, fromGuesser] = setter0 === undefined ? [] : (setter0.seat === 0 ? [sa, sb] : [sb, sa]);
  await setter0.chooseWord('hello');
  await settle();
  for (const junk of [null, 3, {t: 'word', round: 1, hash: 'x', length: 5}, {t: 'answer', round: 1, letter: 'e', positions: 'no'}, {t: 'reveal', round: 1, word: 5, nonce: 1}, {t: 'guess', round: 9, letter: 'a', n: 1}]) {
    fromSetter.send(junk);
    fromGuesser.send(junk);
  }
  await settle();
  assert.equal(guesser0.snapshot().phase, 'guessing');
  assert.equal(guesser0.snapshot().guessed.length, 0);
  assert.equal(guesser0.snapshot().error, null);
});
