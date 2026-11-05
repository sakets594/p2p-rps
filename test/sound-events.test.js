import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchEndScenario, resultScenario, soundsForChange, throwScenario} from '../js/sound-events.js';
import {SCENARIOS} from '../js/sound-map.js';

const snap = (over = {}) => ({phase: 'idle', selfId: 'me', session: null, away: false, notice: null, ...over});
const session = (over = {}) => ({sid: 's1', gameId: 'rps', result: null, ...over});

test('friend joins and leaves the room', () => {
  assert.deepEqual(soundsForChange(snap({phase: 'waiting'}), snap({phase: 'idle'})), ['room.friend_joined']);
  assert.deepEqual(soundsForChange(snap({phase: 'idle'}), snap({phase: 'waiting'})), ['room.friend_left']);
});

test('nothing plays for the first snapshot or for no change', () => {
  assert.deepEqual(soundsForChange(null, snap()), []);
  assert.deepEqual(soundsForChange(snap(), snap()), []);
});

test('invitations: received, declined, but not cancelled by me', () => {
  assert.deepEqual(soundsForChange(snap(), snap({phase: 'invited'})), ['room.invite_received']);
  assert.deepEqual(soundsForChange(snap({phase: 'proposing'}), snap({notice: 'Sam declined Cup Pong.'})), ['room.invite_declined']);
  assert.deepEqual(soundsForChange(snap({phase: 'proposing'}), snap()), []);
});

test('a game starting is heard once, not on every later snapshot', () => {
  const playing = snap({phase: 'playing', session: session()});
  assert.deepEqual(soundsForChange(snap(), playing), ['game.start']);
  assert.deepEqual(soundsForChange(playing, snap({phase: 'playing', session: session()})), []);
  assert.deepEqual(soundsForChange(playing, snap({phase: 'playing', session: session({sid: 's2'})})), ['game.start']);
});

test('a finished game: won, lost or draw, from my side', () => {
  const before = snap({phase: 'playing', session: session()});
  const after = (result) => snap({phase: 'playing', session: session({result})});
  assert.deepEqual(soundsForChange(before, after({winnerId: 'me'})), ['game.won']);
  assert.deepEqual(soundsForChange(before, after({winnerId: 'them'})), ['game.lost']);
  assert.deepEqual(soundsForChange(before, after({})), ['game.draw']);
});

test('a game that plays its own result sound is not doubled by the room', () => {
  const getGame = () => ({ownsResultSound: true});
  const before = snap({phase: 'playing', session: session()});
  const after = snap({phase: 'playing', session: session({result: {winnerId: 'me'}})});
  assert.deepEqual(soundsForChange(before, after, getGame), []);
});

test('the friend dropping out of a resumable game and coming back', () => {
  const playing = snap({phase: 'playing', session: session()});
  const away = snap({phase: 'playing', session: session(), away: true});
  assert.deepEqual(soundsForChange(playing, away), ['game.friend_away']);
  assert.deepEqual(soundsForChange(away, playing), ['game.friend_back']);
});

test('a protocol mismatch is an error sound', () => {
  assert.deepEqual(soundsForChange(snap(), snap({phase: 'incompatible'})), ['game.error']);
});

test('cup pong throws: whose shot it was decides which set plays', () => {
  const ev = (o = {}) => ({hit: false, extra: false, sim: {bounces: 0, rimHits: 0}, ...o});
  assert.equal(throwScenario(ev({hit: true}), true), 'cp.my_hit');
  assert.equal(throwScenario(ev({hit: true, sim: {bounces: 1, rimHits: 0}}), true), 'cp.bounce_hit');
  assert.equal(throwScenario(ev({hit: true, extra: true, sim: {bounces: 1, rimHits: 0}}), true), 'cp.extra_turn');
  assert.equal(throwScenario(ev({hit: true, extra: true}), false), 'cp.their_hit');
  assert.equal(throwScenario(ev(), true), 'cp.my_miss');
  assert.equal(throwScenario(ev({sim: {bounces: 0, rimHits: 2}}), true), 'cp.near_miss');
  assert.equal(throwScenario(ev(), false), 'cp.their_miss');
  assert.equal(throwScenario(ev({sim: {bounces: 0, rimHits: 2}}), false), 'cp.their_miss');
});

test('cup pong match end: all cups only for the winner who cleared them', () => {
  assert.equal(matchEndScenario({winner: 0, reason: 'cups'}, 0), 'cp.all_cups');
  assert.equal(matchEndScenario({winner: 0, reason: 'cups'}, 1), 'game.lost');
  assert.equal(matchEndScenario({winner: 1, reason: 'rounds'}, 1), 'game.won');
  assert.equal(matchEndScenario({winner: null, reason: 'rounds'}, 0), 'game.draw');
});

test('every scenario the code can ask for exists in the sound map', () => {
  const asked = [
    'room.friend_joined', 'room.friend_left', 'room.invite_received', 'room.invite_declined', 'game.error',
    'game.start', 'game.friend_away', 'game.friend_back', 'game.won', 'game.lost', 'game.draw',
    'rps.round_won', 'rps.round_lost', 'rps.round_draw', 'rps.friend_waiting', 'rps.cheat_detected',
    'cp.my_hit', 'cp.their_hit', 'cp.my_miss', 'cp.their_miss', 'cp.bounce_hit', 'cp.near_miss', 'cp.extra_turn', 'cp.all_cups',
  ];
  for (const id of asked) assert.ok(SCENARIOS[id], id);
  assert.deepEqual(Object.keys(SCENARIOS).sort(), [...asked].sort(), 'a mapped scenario nothing ever plays');
  assert.equal(resultScenario({winnerId: 'a'}, 'a'), 'game.won');
});
