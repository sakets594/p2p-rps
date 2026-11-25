import {afterEach, test} from 'node:test';
import assert from 'node:assert/strict';
import {ROUNDS, emojiPoints, isClose, isCorrect, pickChoices, validPhrase, validSequence} from '../js/games/emoji-charades/rules.js';
import {PHRASES} from '../js/games/emoji-charades/phrases.js';
import {PALETTE, TABS} from '../js/games/emoji-charades/emoji.js';
import {EmojiCharadesMatch} from '../js/games/emoji-charades/match.js';
import {memorySessions, settle} from '../js/memory-transport.js';

test('phrases: all valid and unique; palette has no repeats inside a tab', () => {
  for (const p of PHRASES) assert.equal(validPhrase(p.text), true, p.text);
  assert.equal(new Set(PHRASES.map((p) => p.text)).size, PHRASES.length);
  for (const t of TABS) assert.equal(new Set(t.set).size, t.set.length, t.name);
  assert.ok(PALETTE.size > 100);
});

test('rules: loose matching ignores "the", punctuation and a plural s', () => {
  assert.equal(isCorrect('The Lion King!', 'lion king'), true);
  assert.equal(isCorrect('lion king', 'lion king'), true);
  assert.equal(isCorrect('taco', 'tacos'), true);
  assert.equal(isCorrect('lion', 'lion king'), false);
  assert.equal(isClose('lion kin', 'lion king'), true);
  assert.equal(isClose('lion king', 'lion king'), false);
});

test('rules: emoji scoring is 100 up to three emoji, 10 less for each more, never below 20', () => {
  assert.equal(emojiPoints(1), 100);
  assert.equal(emojiPoints(3), 100);
  assert.equal(emojiPoints(4), 90);
  assert.equal(emojiPoints(8), 50);
  assert.equal(emojiPoints(40), 20);
});

test('rules: three choices from three different categories; sequences must be palette emoji', () => {
  const c = pickChoices(Math.random);
  assert.equal(c.length, 3);
  assert.equal(new Set(c.map((x) => x.cat)).size, 3);
  assert.equal(validSequence(['😀', '🍕']), true);
  assert.equal(validSequence(['hello']), false);
  assert.equal(validSequence(Array(25).fill('😀')), false);
  assert.equal(validSequence('😀'), false);
});

const live = [];
afterEach(() => { for (const m of live.splice(0)) m.destroy(); });

function pair(opts = {}) {
  const {net, sessions: [sa, sb]} = memorySessions();
  const a = new EmojiCharadesMatch({session: sa, ...opts});
  const b = new EmojiCharadesMatch({session: sb, ...opts});
  live.push(a, b);
  const [describer, guesser] = a.snapshot().iDescribe ? [a, b] : [b, a];
  return {net, a, b, sa, sb, describer, guesser};
}

async function pick(describer) {
  const choice = describer.snapshot().choices[0];
  assert.equal(await describer.chooseWord(choice.text), true);
  await settle();
  return choice;
}

test('only the describer is offered phrases, and the guesser learns the clue and shape but not the phrase', async () => {
  const {describer, guesser} = pair();
  assert.equal(describer.snapshot().choices.length, 3);
  assert.equal(guesser.snapshot().choices, null);
  const choice = await pick(describer);
  const g = guesser.snapshot();
  assert.equal(g.cat, choice.cat);
  assert.deepEqual(g.shape, choice.text.split(' ').map((w) => w.length));
  assert.equal(g.phrase, null);
  assert.equal(describer.snapshot().phrase, choice.text);
});

test('emoji reach the guesser, undo keeps counting as used, only palette emoji are accepted', async () => {
  const {describer, guesser} = pair();
  await pick(describer);
  assert.equal(describer.addEmoji('🦁'), true);
  assert.equal(describer.addEmoji('👑'), true);
  assert.equal(describer.addEmoji('x'), false, 'not in the palette');
  describer.removeLast();
  describer.addEmoji('🌊');
  await settle();
  const g = guesser.snapshot();
  assert.deepEqual(g.seq, ['🦁', '🌊']);
  assert.equal(g.used, 3, 'the taken-back crown still counts');
  assert.equal(guesser.addEmoji('🦁'), false, 'the guesser cannot describe');
  describer.clearEmoji();
  await settle();
  assert.deepEqual(guesser.snapshot().seq, []);
  assert.equal(guesser.snapshot().used, 3);
});

test('with the flag on (default) a right guess scores by emoji used, and both sides agree', async () => {
  const {describer, guesser} = pair();
  const choice = await pick(describer);
  for (const e of ['🦁', '👑', '🌊', '🔥', '⭐']) describer.addEmoji(e);
  await settle();
  guesser.guess(choice.text);
  await settle();
  const g = guesser.snapshot();
  assert.equal(g.reason, 'solved');
  assert.equal(g.points, 80, 'five emoji = 100 - 2 x 10');
  assert.deepEqual(g.scores, describer.snapshot().scores);
  assert.equal(g.scores[g.seat], 80);
  assert.equal(g.scores[1 - g.seat], 40);
  assert.equal(g.verified, true);
  assert.equal(g.phrase, choice.text);
});

test('with the flag off a right guess scores by speed, whatever the emoji count', async () => {
  const {describer, guesser} = pair({scoreByEmoji: false});
  const choice = await pick(describer);
  for (let i = 0; i < 12; i++) describer.addEmoji('🔥');
  await settle();
  guesser.guess(choice.text);
  await settle();
  const pts = guesser.snapshot().points;
  assert.ok(pts >= 95 && pts <= 100, `time-based and quick: ${pts}`);
});

test('the first describer can flip the flag before picking, and the guesser sees it; nobody else can', async () => {
  const {describer, guesser} = pair();
  assert.equal(describer.snapshot().canSetFlag, true);
  assert.equal(guesser.snapshot().canSetFlag, false);
  assert.equal(guesser.setScoring(false), false);
  assert.equal(describer.setScoring(false), true);
  await pick(describer);
  assert.equal(guesser.snapshot().scoreByEmoji, false);
  assert.equal(describer.setScoring(true), false, 'locked once the phrase is picked');
  assert.equal(describer.snapshot().scoreByEmoji, false);
});

test('a wrong guess, "so close", and time running out', async () => {
  const {describer, guesser} = pair({roundMs: 2_000});
  const choice = await pick(describer);
  guesser.guess('zzzz');
  guesser.guess(choice.text.slice(0, -1) + 'q');
  await settle();
  const gs = guesser.snapshot().guesses;
  assert.equal(gs[0].ok, false);
  assert.equal(gs[1].ok, false);
  await settle(2_100);
  assert.equal(guesser.snapshot().reason, 'time');
  assert.deepEqual(guesser.snapshot().scores, [0, 0]);
  assert.equal(guesser.snapshot().verified, true);
});

test('a describer who lies about a guess or swaps the phrase is caught', async () => {
  let s = pair();
  let choice = await pick(s.describer);
  s.net.intercept = (_f, _t, msg) => (msg.t === 'answer' ? {...msg, ok: false, pts: undefined} : msg);
  s.guesser.guess(choice.text);
  await settle();
  s.net.intercept = null;
  s.describer.skip();
  await settle();
  assert.equal(s.guesser.snapshot().verified, false);
  assert.match(s.guesser.snapshot().error, /cheated/);

  s = pair();
  choice = await pick(s.describer);
  s.net.intercept = (_f, _t, msg) => (msg.t === 'end' ? {...msg, word: 'banana'} : msg);
  s.describer.skip();
  await settle();
  assert.equal(s.guesser.snapshot().verified, false);
});

test('junk messages are ignored', async () => {
  const {describer, guesser, a, sa, sb} = pair();
  await pick(describer);
  const inbox = guesser === a ? sa : sb;
  for (const m of [null, 'x', {t: 'emoji', round: 1, seq: ['nope'], used: 1}, {t: 'emoji', round: 1, seq: ['😀'], used: 0}, {t: 'emoji', round: 1, seq: ['😀'], used: 999},
    {t: 'hint', round: 1, i: 99, ch: 'a'}, {t: 'answer', round: 1, n: 3, ok: true, pts: 100}, {t: 'end', round: 1, word: 1, nonce: 1}]) inbox.onMessage(m);
  assert.deepEqual(guesser.snapshot().seq, []);
  assert.deepEqual(guesser.snapshot().scores, [0, 0]);
  assert.equal(guesser.snapshot().phase, 'playing');
});

test('four rounds alternate the describer and the higher total wins', async () => {
  const {describer: d0, a, b, sa, sb} = pair({roundMs: 5_000});
  for (let round = 1; round <= ROUNDS; round++) {
    const describer = [a, b].find((m) => m.snapshot().iDescribe);
    const guesser = describer === a ? b : a;
    const choice = await pick(describer);
    // d0 only ever guesses right; the other player's rounds are skipped, so d0 wins on points.
    if (describer === d0) describer.skip(); else guesser.guess(choice.text);
    await settle();
    assert.equal(guesser.snapshot().phase, 'roundover');
    if (round < ROUNDS) { a.next(); b.next(); await settle(); }
  }
  assert.equal(a.snapshot().finished, true);
  assert.deepEqual(a.snapshot().scores, b.snapshot().scores);
  const winner = sa.players[d0.snapshot().seat].id;
  assert.deepEqual(sa.result, {winnerId: winner});
  assert.deepEqual(sb.result, {winnerId: winner});
});
