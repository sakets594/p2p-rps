// Turns a change in the room's state into the sounds that go with it. Pure: it compares two
// room snapshots (see Room.snapshot) and returns scenario ids from js/sound-map.js.
// Moments inside a game (a round result, a throw) are not here; each game plays those itself.
//
// A game that plays its own win/lose/draw sound at the right moment (after its animation, not
// when the result is known) sets `ownsResultSound: true` in the catalog (js/games.js).

import {findGame} from './games.js';

export function resultScenario(result, selfId) {
  if (!result?.winnerId) return 'game.draw';
  return result.winnerId === selfId ? 'game.won' : 'game.lost';
}

/**
 * @param prev  the previous room snapshot, or null before the first one
 * @param next  the new room snapshot
 * @returns scenario ids, in the order they happened
 */
export function soundsForChange(prev, next, getGame = findGame) {
  if (!prev) return [];
  const out = [];

  if (prev.phase === 'waiting' && next.phase !== 'waiting') out.push('room.friend_joined');
  if (prev.phase !== 'waiting' && next.phase === 'waiting') out.push('room.friend_left');
  if (prev.phase !== 'invited' && next.phase === 'invited') out.push('room.invite_received');
  if (prev.phase === 'proposing' && next.phase === 'idle' && next.notice) out.push('room.invite_declined');
  if (prev.phase !== 'incompatible' && next.phase === 'incompatible') out.push('game.error');

  const was = prev.session;
  const now = next.session;
  if (now && now.sid !== was?.sid) out.push('game.start');
  if (now && was && now.sid === was.sid) {
    if (prev.away !== next.away) out.push(next.away ? 'game.friend_away' : 'game.friend_back');
    if (now.result && !was.result && !getGame(now.gameId)?.ownsResultSound) {
      out.push(resultScenario(now.result, next.selfId));
    }
  }
  return out;
}

/**
 * The sound for one Cup Pong throw event (see CupPongMatch). `mine` is whether I threw it.
 * Good things the friend does are bad news for me, so their hits get the "ouch" set and their
 * misses the "ha ha" set; only my own shots get the celebration sets.
 */
export function throwScenario(ev, mine) {
  if (ev.hit) {
    if (!mine) return 'cp.their_hit';
    if (ev.extra) return 'cp.extra_turn';
    return ev.sim.bounces > 0 ? 'cp.bounce_hit' : 'cp.my_hit';
  }
  if (!mine) return 'cp.their_miss';
  return ev.sim.rimHits > 0 ? 'cp.near_miss' : 'cp.my_miss';
}

/** The sound for the end of a Cup Pong match: `over` is {winner: seat | null, reason}. */
export function matchEndScenario(over, seat) {
  if (over.winner === null) return 'game.draw';
  if (over.winner !== seat) return 'game.lost';
  return over.reason === 'cups' ? 'cp.all_cups' : 'game.won';
}
