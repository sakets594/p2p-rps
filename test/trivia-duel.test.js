import {test} from 'node:test';
import assert from 'node:assert/strict';
import {QUESTIONS} from '../js/games/trivia-duel/questions.js';
import {QUESTION_COUNT, TIME_LIMIT_MS, TriviaMatch, pickQuestions, scoreQuestion} from '../js/games/trivia-duel/match.js';
import {memorySessions, settle} from '../js/memory-transport.js';

test('the question bank is well formed: four distinct options, a valid answer, no duplicate questions', () => {
  assert.ok(QUESTIONS.length >= QUESTION_COUNT * 3);
  const seen = new Set();
  for (const q of QUESTIONS) {
    assert.ok(q.q.endsWith('?') || q.q.endsWith(')?'), q.q);
    assert.equal(q.a.length, 4, q.q);
    assert.equal(new Set(q.a).size, 4, q.q);
    assert.ok(Number.isInteger(q.correct) && q.correct >= 0 && q.correct < 4, q.q);
    assert.ok(!seen.has(q.q), `duplicate: ${q.q}`);
    seen.add(q.q);
  }
});

test('pickQuestions: same seed, same questions and option order; different seed differs; answers stay right', () => {
  const a = pickQuestions('s1');
  assert.deepEqual(a, pickQuestions('s1'));
  assert.notDeepEqual(a.map((q) => q.q), pickQuestions('s2').map((q) => q.q));
  assert.equal(a.length, QUESTION_COUNT);
  assert.equal(new Set(a.map((q) => q.q)).size, QUESTION_COUNT);
  for (const q of a) {
    const original = QUESTIONS.find((x) => x.q === q.q);
    assert.equal(q.options[q.correct], original.a[original.correct], 'the right answer moved with its option');
    assert.deepEqual([...q.options].sort(), [...original.a].sort());
  }
});

test('scoreQuestion: right answers score, the faster right answer earns a bonus', () => {
  const q = {correct: 1};
  assert.deepEqual(scoreQuestion(q, {choice: 1, ms: 1000}, {choice: 1, ms: 2000}), [2, 1]);
  assert.deepEqual(scoreQuestion(q, {choice: 1, ms: 2000}, {choice: 1, ms: 1000}), [1, 2]);
  assert.deepEqual(scoreQuestion(q, {choice: 1, ms: 1000}, {choice: 1, ms: 1000}), [1, 1], 'a tie gives no bonus');
  assert.deepEqual(scoreQuestion(q, {choice: 1, ms: 9000}, {choice: 0, ms: 100}), [2, 0], 'a wrong fast answer earns nothing');
  assert.deepEqual(scoreQuestion(q, {choice: 0, ms: 100}, {choice: -1, ms: TIME_LIMIT_MS}), [0, 0]);
});

function pair(count = 3) {
  const {net, sessions: [sa, sb]} = memorySessions();
  return {net, sa, sb, a: new TriviaMatch({session: sa, count}), b: new TriviaMatch({session: sb, count})};
}

test('both players see the same questions, and the answer stays hidden until both have answered', async () => {
  const {a, b} = pair();
  assert.deepEqual(a.snapshot().options, b.snapshot().options);
  assert.equal(a.snapshot().question, b.snapshot().question);
  assert.equal(a.snapshot().correct, null);
  a.answer(0, 500);
  await settle();
  assert.equal(a.snapshot().phase, 'asking');
  assert.equal(a.snapshot().correct, null, 'still hidden for the one who answered');
  assert.equal(b.snapshot().theirAnswered, true);
  assert.equal(b.snapshot().theirChoice, null, 'their choice is not shown yet');
  b.answer(1, 900);
  await settle();
  assert.equal(a.snapshot().phase, 'reveal');
  assert.ok(Number.isInteger(a.snapshot().correct));
  assert.equal(a.snapshot().theirChoice, 1);
});

test('answering twice, with a bad choice, or with junk is ignored', async () => {
  const {a, sb} = pair();
  assert.equal(a.answer(7, 0), false);
  assert.equal(a.answer('x', 0), false);
  assert.equal(a.answer(2, 100), true);
  assert.equal(a.answer(3, 100), false, 'only one answer per question');
  for (const junk of [null, 5, {t: 'answer', q: 99, choice: 0, ms: 1}, {t: 'answer', q: 0, choice: 9, ms: 1}, {t: 'answer', q: 0, choice: 1, ms: -5}, {t: 'ready', q: 0}, {t: 'ready', q: 'a'}]) sb.send(junk);
  await settle();
  assert.equal(a.snapshot().theirAnswered, false);
  assert.equal(a.snapshot().readyMine, false);
});

test('the next question starts only when both are ready; two timeouts score nothing and end in a draw', async () => {
  const {a, b, sa, sb} = pair(3);
  const correctIndex = (m) => m.snapshot().correct;
  for (let q = 0; q < 3; q++) {
    assert.equal(a.snapshot().index, q);
    assert.equal(b.snapshot().index, q);
    // nobody answers in time
    a.answer(-1, TIME_LIMIT_MS);
    b.answer(-1, TIME_LIMIT_MS);
    await settle();
    assert.equal(a.snapshot().phase === 'reveal' || a.snapshot().phase === 'over', true);
    assert.ok(correctIndex(a) >= 0);
    a.next();
    await settle();
    if (q < 2) assert.equal(a.snapshot().index, q, 'still on the same question until the friend is ready too');
    b.next();
    await settle();
  }
  assert.deepEqual(a.snapshot().scores, {me: 0, them: 0});
  assert.deepEqual(sa.result, {});
  assert.deepEqual(sa.result, sb.result);
});

test('a full match with real answers: the faster correct player wins and both agree', async () => {
  const {a, b, sa, sb} = pair(3);
  const qs = pickQuestions('test-session', 3);
  for (let q = 0; q < 3; q++) {
    a.answer(qs[q].correct, 500);
    b.answer(qs[q].correct, 900);
    await settle();
    a.next(); b.next();
    await settle();
  }
  assert.deepEqual(a.snapshot().scores, {me: 6, them: 3});
  assert.deepEqual(b.snapshot().scores, {me: 3, them: 6});
  assert.equal(a.snapshot().phase, 'over');
  assert.equal(sa.result.winnerId, 'alice');
  assert.deepEqual(sa.result, sb.result);
});
