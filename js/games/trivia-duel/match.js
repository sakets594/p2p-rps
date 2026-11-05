// Trivia Duel match. Pure logic over a room `session`; no DOM, no timers.
// Both browsers pick the same questions (a seeded shuffle of the bank, options shuffled too) so only
// answers travel:
//   answer  {q, choice, ms}   my choice for question q (-1 = ran out of time) and how long I took
//   ready   {q}               I have seen question q-1's result; start q when both sides are ready
// The view measures time and calls answer(choice, ms). Points per question: 1 for a right answer, plus
// 1 more if mine was right and faster than theirs (or theirs was wrong or missing). Times are
// reported by each player's own browser, so this is for friends, not for tournaments.

import {seededRandom, shuffled} from '../../rng.js';
import {QUESTIONS} from './questions.js';

export const QUESTION_COUNT = 8;
export const TIME_LIMIT_MS = 12_000;

/** The same questions, in the same order with the same option order, for the same seed. */
export function pickQuestions(seed, count = QUESTION_COUNT, bank = QUESTIONS) {
  const random = seededRandom(`${seed}:trivia`);
  return shuffled(bank, random).slice(0, count).map(({q, a, correct}) => {
    const order = shuffled(a.map((_, i) => i), random);
    return {q, options: order.map((i) => a[i]), correct: order.indexOf(correct)};
  });
}

/** Points for one question from both answers ({choice, ms} each). */
export function scoreQuestion(question, mine, theirs) {
  const right = (x) => x.choice === question.correct;
  const score = (x, y) => (right(x) ? 1 + (!right(y) || x.ms < y.ms ? 1 : 0) : 0);
  return [score(mine, theirs), score(theirs, mine)];
}

/**
 * phase: asking   question `index` is open; my answer may or may not be in
 *        reveal   both answers are in: show who was right
 *        over     the last question has been revealed
 */
export class TriviaMatch {
  #session;
  #onChange;
  #seat;
  #questions;
  #index = 0;
  #mine = []; // per question: {choice, ms} | undefined
  #theirs = [];
  #readyMine = new Set(); // question numbers I have said I am ready for
  #readyTheirs = new Set();
  #finished = false;

  constructor({session, onChange = () => {}, count = QUESTION_COUNT, bank = QUESTIONS}) {
    this.#session = session;
    this.#onChange = onChange;
    this.#seat = session.players.findIndex((p) => p.id === session.selfId);
    this.#questions = pickQuestions(session.sid, count, bank);
    session.onMessage = (msg) => this.#onMessage(msg);
  }

  #resolved(i) { return this.#mine[i] && this.#theirs[i]; }

  #scores() {
    const total = [0, 0];
    for (let i = 0; i < this.#questions.length; i++) {
      if (!this.#resolved(i)) continue;
      const [m, t] = scoreQuestion(this.#questions[i], this.#mine[i], this.#theirs[i]);
      total[0] += m; total[1] += t;
    }
    return {me: total[0], them: total[1]};
  }

  snapshot() {
    const i = this.#index;
    const q = this.#questions[i];
    const revealed = !!this.#resolved(i);
    const last = i === this.#questions.length - 1;
    const result = revealed ? scoreQuestion(q, this.#mine[i], this.#theirs[i]) : null;
    return {
      phase: revealed ? (last ? 'over' : 'reveal') : 'asking',
      index: i,
      total: this.#questions.length,
      question: q.q,
      options: q.options,
      correct: revealed ? q.correct : null, // never leak the answer before both have answered
      myChoice: this.#mine[i]?.choice ?? null,
      answered: !!this.#mine[i],
      theirAnswered: !!this.#theirs[i],
      theirChoice: revealed ? this.#theirs[i].choice : null,
      gained: result ? {me: result[0], them: result[1]} : null,
      scores: this.#scores(),
      readyMine: this.#readyMine.has(i + 1),
      seat: this.#seat,
      names: this.#session.players.map((p) => p.name),
      opponentName: this.#session.players[1 - this.#seat]?.name ?? 'Friend',
      session: this.#session.sid,
    };
  }

  /** My answer: `choice` is an option index, or -1 for "ran out of time"; `ms` is how long I took. */
  answer(choice, ms) {
    const i = this.#index;
    if (this.#mine[i] || this.#resolved(i)) return false;
    if (!Number.isInteger(choice) || choice < -1 || choice >= this.#questions[i].options.length) return false;
    const entry = {choice, ms: Math.max(0, Math.min(Number(ms) || 0, TIME_LIMIT_MS))};
    this.#mine[i] = entry;
    this.#session.send({t: 'answer', q: i, choice: entry.choice, ms: entry.ms});
    this.#afterChange();
    return true;
  }

  /** I have seen this result: move on once the other player has too. */
  next() {
    const i = this.#index;
    if (!this.#resolved(i) || i >= this.#questions.length - 1 || this.#readyMine.has(i + 1)) return;
    this.#readyMine.add(i + 1);
    this.#session.send({t: 'ready', q: i + 1});
    this.#advance();
    this.#onChange(this.snapshot());
  }

  #onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'answer') {
      const {q, choice, ms} = msg;
      if (!Number.isInteger(q) || q < 0 || q >= this.#questions.length || this.#theirs[q]) return;
      if (!Number.isInteger(choice) || choice < -1 || choice >= this.#questions[q].options.length || typeof ms !== 'number' || !(ms >= 0)) return;
      this.#theirs[q] = {choice, ms: Math.min(ms, TIME_LIMIT_MS)};
      this.#afterChange();
    } else if (msg.t === 'ready') {
      if (!Number.isInteger(msg.q) || msg.q < 1 || msg.q >= this.#questions.length) return;
      this.#readyTheirs.add(msg.q);
      this.#advance();
      this.#onChange(this.snapshot());
    }
  }

  #advance() {
    const next = this.#index + 1;
    if (this.#resolved(this.#index) && this.#readyMine.has(next) && this.#readyTheirs.has(next)) this.#index = next;
  }

  #afterChange() {
    const last = this.#questions.length - 1;
    if (!this.#finished && this.#resolved(last)) {
      this.#finished = true;
      const {me, them} = this.#scores();
      const other = this.#session.players[1 - this.#seat].id;
      this.#session.finished(me === them ? {} : {winnerId: me > them ? this.#session.selfId : other});
    }
    this.#onChange(this.snapshot());
  }

  destroy() { this.#session.onMessage = null; }
}
