import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MAX_ROOMS, STORAGE_VERSION, createStore, memoryStorage} from '../js/storage.js';

const VERSION_KEY = 'p2p-games-storage-version';
const roomsJson = (codes) => JSON.stringify(codes.map((code, i) => ({code, name: `Room ${code}`, myName: 'Sam', role: 'joiner', at: i})));

test('a fresh browser is stamped with the current version', () => {
  const storage = memoryStorage();
  createStore(storage);
  assert.equal(storage.getItem(VERSION_KEY), String(STORAGE_VERSION));
});

test('data from before versioning keeps its rooms but loses remembered names', () => {
  const storage = memoryStorage();
  storage.setItem('rps-rooms', roomsJson(['AAAAAA']));
  storage.setItem('rps-names', JSON.stringify(['Sam', 'Priya']));
  storage.setItem('rps-name', 'OldSam');
  const store = createStore(storage);
  assert.deepEqual(store.rooms().map((r) => r.code), ['AAAAAA']);
  assert.equal(store.rooms()[0].myName, 'Sam', 'the name used in that room is still there');
  assert.equal(storage.getItem('rps-names'), null);
  assert.equal(storage.getItem('rps-name'), null);
  assert.equal(storage.getItem(VERSION_KEY), String(STORAGE_VERSION));
});

test('version 1 is migrated the same way', () => {
  const storage = memoryStorage();
  storage.setItem(VERSION_KEY, '1');
  storage.setItem('rps-rooms', roomsJson(['AAAAAA']));
  storage.setItem('rps-names', JSON.stringify(['Sam']));
  createStore(storage);
  assert.equal(storage.getItem('rps-names'), null);
  assert.equal(JSON.parse(storage.getItem('rps-rooms')).length, 1);
});

test('data at the current version is left alone', () => {
  const storage = memoryStorage();
  storage.setItem(VERSION_KEY, String(STORAGE_VERSION));
  storage.setItem('rps-rooms', roomsJson(['AAAAAA', 'BBBBBB']));
  assert.equal(createStore(storage).rooms().length, 2);
});

test('data from an unsupported version is deleted, not half-read', () => {
  for (const version of [String(STORAGE_VERSION + 1), '99', '0', 'abc', '1.5', '', '2 ']) {
    const storage = memoryStorage();
    storage.setItem(VERSION_KEY, version);
    storage.setItem('rps-rooms', roomsJson(['AAAAAA']));
    storage.setItem('rps-names', JSON.stringify(['Sam']));
    storage.setItem('rps-name', 'OldSam');
    const store = createStore(storage);
    assert.deepEqual(store.rooms(), [], `version ${JSON.stringify(version)}`);
    assert.equal(storage.getItem('rps-names'), null);
    assert.equal(storage.getItem('rps-name'), null);
    assert.equal(storage.getItem(VERSION_KEY), String(STORAGE_VERSION), 'stamped so it is not wiped again next time');
  }
});

test('other keys in the same localStorage are never touched', () => {
  const storage = memoryStorage();
  storage.setItem(VERSION_KEY, '99');
  storage.setItem('someone-elses-key', 'keep me');
  createStore(storage);
  assert.equal(storage.getItem('someone-elses-key'), 'keep me');
});

test('the store has no memory of names across rooms', () => {
  const store = createStore(memoryStorage());
  assert.equal(store.names, undefined);
  assert.equal(store.rememberName, undefined);
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
  storage.setItem('rps-rooms', JSON.stringify([
    null, 'x', {code: 'bad'}, {code: 'ABCDEF', name: '<b>hi</b>\u0000', myName: 5, role: 'admin', at: 'soon'},
    {code: 'abcdef', name: 'duplicate'},
  ]));
  const store = createStore(storage);
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
  store.rememberRoom({code: 'AAAAAA'});
  assert.deepEqual(store.rooms(), []);
});
