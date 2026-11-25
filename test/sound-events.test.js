import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {matchEndScenario, resultScenario, soundsForChange, throwScenario} from '../js/sound-events.js';
import {SCENARIOS} from '../js/sound-map.js';
import {Room} from '../js/room.js';
import {MemoryNetwork, settle} from '../js/memory-transport.js';

const snap = (over = {}) => ({phase: 'idle', selfId: 'me', session: null, result: null, away: false, notice: null, ...over});
const session = (over = {}) => ({sid: 's1', gameId: 'rps', ...over});

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
  const after = (result) => snap({phase: 'playing', session: session(), result});
  assert.deepEqual(soundsForChange(before, after({winnerId: 'me'})), ['game.won']);
  assert.deepEqual(soundsForChange(before, after({winnerId: 'them'})), ['game.lost']);
  assert.deepEqual(soundsForChange(before, after({})), ['game.draw']);
});

test('a game that plays its own result sound is not doubled by the room', () => {
  const getGame = () => ({ownsResultSound: true});
  const before = snap({phase: 'playing', session: session()});
  const after = snap({phase: 'playing', session: session(), result: {winnerId: 'me'}});
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

// Static check, so a typo'd id (silent at runtime) or a mapped scenario nothing plays cannot slip in:
// every quoted 'scope.moment' in the code must be a mapped scenario, and every scenario must be used.
test('every scenario id in the code is mapped, and every mapped scenario is used by the code', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, {withFileTypes: true})) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (e.name.endsWith('.js') && e.name !== 'sound-map.js') files.push(path);
    }
  };
  walk(fileURLToPath(new URL('../js/', import.meta.url)));
  const scopes = new Set(Object.keys(SCENARIOS).map((id) => id.split('.')[0]));
  const used = new Set();
  const unknown = [];
  for (const file of files) {
    for (const [, id] of readFileSync(file, 'utf8').matchAll(/'([a-z]+\.[a-z_]+)'/g)) {
      if (!scopes.has(id.split('.')[0])) continue; // 'index.js', 'hands.js'...: not a scenario
      if (SCENARIOS[id]) used.add(id);
      else if (!/\.(js|css)$/.test(id)) unknown.push(`${file}: ${id}`);
    }
  }
  assert.deepEqual(unknown, [], 'ids the code plays that the map does not have');
  assert.deepEqual(Object.keys(SCENARIOS).filter((id) => !used.has(id)), [], 'mapped scenarios nothing plays');
  assert.equal(resultScenario({winnerId: 'a'}, 'a'), 'game.won');
});

// The room hands every snapshot the same live session object and sets `result` on it in place, so a
// detector that compares prev.session.result to next.session.result sees the result "already there".
// Unit tests with hand-made snapshots cannot catch that; this one uses two real rooms.
test('real room: the winner hears game.won, the loser game.lost, and a draw is a draw', async () => {
  for (const [result, mine, theirs] of [
    [{winnerId: 'alice'}, 'game.won', 'game.lost'],
    [{winnerId: 'bob'}, 'game.lost', 'game.won'],
    [{}, 'game.draw', 'game.draw'],
  ]) {
    const net = new MemoryNetwork();
    const heard = {alice: [], bob: []};
    const rooms = {};
    for (const id of ['alice', 'bob']) {
      let prev = null;
      const transport = net.createPeer(id);
      rooms[id] = {transport, room: new Room({
        transport, roomId: 'ABC123', name: id,
        getGame: () => ({id: 'ttt', title: 'T', status: 'ready', minPlayers: 2, maxPlayers: 2}),
        onChange: (snap) => { heard[id].push(...soundsForChange(prev, snap)); prev = snap; },
      })};
    }
    rooms.alice.transport.join(); rooms.bob.transport.join();
    await settle();
    rooms.alice.room.propose('ttt'); await settle();
    rooms.bob.room.accept(); await settle();
    rooms.alice.room.snapshot().session.finished(result); // what TurnMatch does when the game ends
    rooms.bob.room.snapshot().session.finished(result);
    await settle();
    assert.ok(heard.alice.includes('game.start'), 'start sound');
    assert.deepEqual(heard.alice.filter((x) => /^game\.(won|lost|draw)$/.test(x)), [mine], 'alice');
    assert.deepEqual(heard.bob.filter((x) => /^game\.(won|lost|draw)$/.test(x)), [theirs], 'bob');
  }
});
