// Remembers the rooms a player has used (and the name they used in each), in
// localStorage. A name belongs to a room: nothing remembers "your name" across
// rooms or visits.
//
// Everything read back is re-validated, so corrupt or hand-edited data can
// never break the page, and a blocked/unavailable localStorage degrades to
// "nothing is remembered" instead of throwing. The data carries a version; on
// load, data from a version this code does not understand is deleted rather than
// half-read (see migrate).

import {normalizeRoomCode} from './room-code.js';
import {cleanName, MAX_ROOM_NAME_LENGTH} from './names.js';

const ROOMS_KEY = 'rps-rooms';
const VERSION_KEY = 'p2p-games-storage-version';
const MUTED_KEY = 'p2p-games-sound-muted';
// Keys this app has ever used. Old names lists are listed so they get cleaned up.
const OLD_NAME_KEYS = ['rps-names', 'rps-name'];

/** Bump when the saved format changes, and teach migrate() what to do with the old one. */
export const STORAGE_VERSION = 2;
export const MAX_ROOMS = 6;

export function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
}

function browserStorage() {
  try {
    return globalThis.localStorage ?? memoryStorage();
  } catch {
    return memoryStorage(); // accessing localStorage can throw (blocked site data)
  }
}

/**
 * Bring saved data to STORAGE_VERSION, or delete it if it cannot be understood.
 *   current version  nothing to do
 *   none, or 1       data from before versioning: the room list is still valid, but
 *                    remembered names are gone (a name belongs to a room now), so drop them
 *   anything else    a newer app wrote it, or it is garbled: unsupported, delete it all
 */
export function migrate(storage) {
  const remove = (key) => { try { storage.removeItem(key); } catch { /* nothing to clean */ } };
  let stored;
  try {
    stored = storage.getItem(VERSION_KEY);
  } catch {
    return; // storage is unusable; the store will simply remember nothing
  }
  if (stored === String(STORAGE_VERSION)) return;

  if (stored === null || stored === '1') {
    OLD_NAME_KEYS.forEach(remove);
  } else {
    [ROOMS_KEY, ...OLD_NAME_KEYS].forEach(remove);
  }
  try {
    storage.setItem(VERSION_KEY, String(STORAGE_VERSION));
  } catch { /* quota or private mode */ }
}

export function createStore(storage = browserStorage()) {
  migrate(storage);
  const read = (key) => {
    try {
      const value = JSON.parse(storage.getItem(key));
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };
  const write = (key, value) => {
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch {
      /* quota or private mode: remembering is a convenience, not a requirement */
    }
  };

  /** Recent rooms, most recently played first. */
  function rooms() {
    const out = [];
    for (const item of read(ROOMS_KEY)) {
      const code = normalizeRoomCode(item?.code);
      if (!code || out.some((r) => r.code === code)) continue;
      out.push({
        code,
        name: cleanName(item.name, '', MAX_ROOM_NAME_LENGTH) || null,
        myName: cleanName(item.myName, ''),
        role: item.role === 'creator' ? 'creator' : 'joiner',
        at: Number.isFinite(item.at) ? item.at : 0,
      });
    }
    return out.sort((a, b) => b.at - a.at).slice(0, MAX_ROOMS);
  }

  /** Add or refresh a room; moves it to the front. A missing name keeps the old one. */
  function rememberRoom({code, name = null, myName = '', role = 'joiner'}, now = Date.now()) {
    const normalized = normalizeRoomCode(code);
    if (!normalized) return;
    const existing = rooms().find((r) => r.code === normalized);
    const entry = {
      code: normalized,
      name: cleanName(name, '', MAX_ROOM_NAME_LENGTH) || existing?.name || null,
      myName: cleanName(myName, '') || existing?.myName || '',
      role: role === 'creator' ? 'creator' : 'joiner',
      at: now,
    };
    write(ROOMS_KEY, [entry, ...rooms().filter((r) => r.code !== normalized)].slice(0, MAX_ROOMS));
  }

  /** Learn a room's name later (a joiner only hears it once connected) without reordering. */
  function updateRoomName(code, name) {
    const normalized = normalizeRoomCode(code);
    const clean = cleanName(name, '', MAX_ROOM_NAME_LENGTH);
    if (!normalized || !clean) return;
    const all = rooms();
    const entry = all.find((r) => r.code === normalized);
    if (!entry || entry.name === clean) return;
    entry.name = clean;
    write(ROOMS_KEY, all);
  }

  function forgetRoom(code) {
    write(ROOMS_KEY, rooms().filter((r) => r.code !== normalizeRoomCode(code)));
  }

  /** Whether the player turned the meme sounds off. Sound is on until they do. */
  function soundMuted() {
    try {
      return storage.getItem(MUTED_KEY) === '1';
    } catch {
      return false;
    }
  }

  function setSoundMuted(muted) {
    try {
      if (muted) storage.setItem(MUTED_KEY, '1');
      else storage.removeItem(MUTED_KEY);
    } catch { /* private mode: the choice just lasts until the page closes */ }
  }

  return {rooms, rememberRoom, updateRoomName, forgetRoom, soundMuted, setSoundMuted};
}
