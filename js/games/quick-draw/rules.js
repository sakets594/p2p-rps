// Quick Draw rules: pure functions, no DOM, no clock. A standoff: both players wait for "DRAW!", the faster tap wins
// the round, a tap before it is a false start and loses. First to 3 round wins (draws replay, 7 rounds at most).
//
// The wait before DRAW comes from the session id, so both screens agree on it with nothing sent. Each screen measures
// its own player's reaction from the moment IT shows DRAW and reports it; the two reports are compared, so network
// delay never counts against anyone. It is built for friends: a modified client could lie about its time.

import {seededRandom} from '../../rng.js';

export const ROUNDS_TO_WIN = 3;
export const MAX_ROUNDS = 7;
export const MIN_WAIT_MS = 1800;
export const MAX_WAIT_MS = 6000;
export const REACT_TIMEOUT_MS = 1200;   // no tap this long after DRAW = too slow
export const HUMAN_LIMIT_MS = 90;       // nobody reacts faster than this: a tap that quick was a guess, and counts as a false start

/** How long the standoff lasts before DRAW, the same on both screens. */
export function standoffMs(sid, round) {
  const r = seededRandom(`${sid}:qd:${round}`)();
  return MIN_WAIT_MS + Math.floor(r * (MAX_WAIT_MS - MIN_WAIT_MS));
}

export const FAKEOUTS = ['crow', 'gust', 'bell'];

/**
 * Harmless things that happen during the wait to tempt a twitchy finger: [{at: ms into the standoff, kind}].
 * Always at least 700 ms before DRAW, so nothing looks like it.
 */
export function fakeouts(sid, round, waitMs = standoffMs(sid, round)) {
  const rand = seededRandom(`${sid}:qd-fake:${round}`);
  const out = [];
  const usable = waitMs - 1000;
  if (usable < 800) return out;
  const n = usable > 2600 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const at = Math.floor(400 + rand() * (usable - 400));
    out.push({at, kind: FAKEOUTS[Math.floor(rand() * FAKEOUTS.length)]});
  }
  return out.sort((a, b) => a.at - b.at).filter((f, i, all) => i === 0 || f.at - all[i - 1].at > 500);
}

/** A reported result is {early: boolean, ms: number | null}: ms is the reaction time, null if they never tapped. */
export function validResult(r) {
  return !!r && typeof r === 'object' && typeof r.early === 'boolean'
    && (r.ms === null || (typeof r.ms === 'number' && Number.isFinite(r.ms) && r.ms >= 0 && r.ms <= 10_000));
}

/** Normalize what a screen measured: a too-quick tap counts as early. */
export function classify(ms) {
  if (ms === null) return {early: false, ms: null};
  if (ms < HUMAN_LIMIT_MS) return {early: true, ms: null};
  return {early: false, ms: Math.round(ms)};
}

/**
 * Who won a round, from both players' results: 0, 1, or 'draw'.
 * Early loses. Both early, or both too slow, or the same time, is a draw.
 */
export function judge(a, b) {
  if (a.early && b.early) return 'draw';
  if (a.early) return 1;
  if (b.early) return 0;
  if (a.ms === null && b.ms === null) return 'draw';
  if (a.ms === null) return 1;
  if (b.ms === null) return 0;
  if (a.ms === b.ms) return 'draw';
  return a.ms < b.ms ? 0 : 1;
}

/** Scene mood for a round: dawn, morning, noon, dusk, night. */
export const timeOfDay = (round) => Math.min(4, Math.max(0, round - 1));
