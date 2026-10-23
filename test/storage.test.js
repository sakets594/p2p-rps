import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MAX_NAMES, MAX_ROOMS, createStore, memoryStorage} from '../js/storage.js';

test('names: most recent first, de-duplicated ignoring case, capped', () => {
  const store = createStore(memoryStorage());
  assert.deepEqual(store.names(), []);
  store.rememberName('Sam');
  store.rememberName('Priya');
  store.rememberName('sam');
  assert.deepEqual(store.names(), ['sam', 'Priya']);
  for (let i = 0; i < 10; i++) store.rememberName(`Player ${i}`);
  assert.equal(store.names().length, MAX_NAMES);
  assert.equal(store.names()[0], 'Player 9');
});

test('names: blank and non-string input is ignored, long names are capped', () => {
  const store = createStore(memoryStorage());
  store.rememberName('   ');
  store.rememberName(undefined);
  store.rememberName({evil: true});
  assert.deepEqual(store.names(), []);
  store.rememberName('x'.repeat(50));
  assert.equal(store.names()[0].length, 16);
});

test('names: picks up the single name saved by the first version', () => {
  const storage = memoryStorage();
  storage.setItem('rps-name', 'OldSam');
  assert.deepEqual(createStore(storage).names(), ['OldSam']);
});

test('rooms: remembered with code, room name, my name and role', () => {
  const store = createStore(memoryStorage());
  store.rememberRoom({code: 'ab12cd', name: 'Friday', myName: 'Sam', role: 'creator'}, 100);
  assert.deepEqual(store.rooms(), [{code: 'AB12CD', name: 'Friday', myName: 'Sam', role: 'creator', at: 100}]);
});

test('rooms: re-entering moves a room to the front and keeps its known name', () => {
  const store = createStore(memoryStorage());
  store.rememberRoom({code: 'AAAAAA', name: 'First', myName: 'Sam', role: 'creator'}, 1);
  store.rememberRoom({code: 'BBBBBB', myName: 'Sam'}, 2);
  store.rememberRoom({code: 'AAAAAA', myName: 'Sam', role: 'creator'}, 3);
  const rooms = store.rooms();
  assert.deepEqual(rooms.map((r) => r.code), ['AAAAAA', 'BBBBBB']);
  assert.equal(rooms[0].name, 'First', 'name survives a rejoin that did not supply one');
});

test('rooms: capped, and a joiner learns the room name later without reordering', () => {
  const store = createStore(memoryStorage());
  for (let i = 0; i < 10; i++) store.rememberRoom({code: `ROOM0${i}`.slice(0, 6), myName: 'Sam'}, i);
  assert.equal(store.rooms().length, MAX_ROOMS);
  const newest = store.rooms()[0].code;
  store.rememberRoom({code: 'ZZZZZZ', myName: 'Sam'}, 100);
  store.updateRoomName('ZZZZZZ', 'Kali Pahadi Ke Pichhe');
  const [first, second] = store.rooms();
  assert.equal(first.code, 'ZZZZZZ');
  assert.equal(first.name, 'Kali Pahadi Ke Pichhe');
  assert.equal(second.code, newest);
});

test('rooms: forget removes one room', () => {
  const store = createStore(memoryStorage());
  store.rememberRoom({code: 'AAAAAA'}, 1);
  store.rememberRoom({code: 'BBBBBB'}, 2);
  store.forgetRoom('aaaaaa');
  assert.deepEqual(store.rooms().map((r) => r.code), ['BBBBBB']);
});

test('rooms: invalid codes are never stored', () => {
  const store = createStore(memoryStorage());
  store.rememberRoom({code: 'nope'});
  store.rememberRoom({code: '<script>'});
  store.rememberRoom({});
  assert.deepEqual(store.rooms(), []);
});

test('corrupt or hostile stored data is tolerated and sanitized', () => {
  const storage = memoryStorage();
  storage.setItem('rps-names', '{not json');
  storage.setItem('rps-rooms', JSON.stringify([
    null, 'x', {code: 'bad'}, {code: 'ABCDEF', name: '<b>hi</b>\u0000', myName: 5, role: 'admin', at: 'soon'},
    {code: 'abcdef', name: 'duplicate'},
  ]));
  const store = createStore(storage);
  assert.deepEqual(store.names(), []);
  const rooms = store.rooms();
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].role, 'joiner');
  assert.equal(rooms[0].myName, '');
  assert.equal(rooms[0].at, 0);
  assert.equal(rooms[0].name, '<b>hi</b>', 'control chars stripped; the UI uses textContent so markup is inert');
});

test('storage that throws never breaks the store', () => {
  const broken = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('quota'); },
  };
  const store = createStore(broken);
  assert.deepEqual(store.names(), []);
  store.rememberName('Sam');
  store.rememberRoom({code: 'AAAAAA'});
  assert.deepEqual(store.rooms(), []);
});
