// Remembers the names and rooms a player has used, in localStorage.
// Everything read back is re-validated, so corrupt or hand-edited data can
// never break the page, and a blocked/unavailable localStorage degrades to
// "nothing is remembered" instead of throwing.

import {normalizeRoomCode} from './game.js';
import {cleanName, MAX_ROOM_NAME_LENGTH} from './match.js';

const NAMES_KEY = 'rps-names';
const ROOMS_KEY = 'rps-rooms';
const LEGACY_NAME_KEY = 'rps-name'; // single saved name from the first version

export const MAX_NAMES = 6;
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

export function createStore(storage = browserStorage()) {
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

  const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

  /** Recent names, most recent first. */
  function names() {
    const out = [];
    const raw = read(NAMES_KEY);
    if (raw.length === 0) {
      try { raw.push(storage.getItem(LEGACY_NAME_KEY)); } catch { /* ignore */ }
    }
    for (const item of raw) {
      const name = cleanName(item, '');
      if (name && !out.some((n) => sameName(n, name))) out.push(name);
    }
    return out.slice(0, MAX_NAMES);
  }

  function rememberName(raw) {
    const name = cleanName(raw, '');
    if (!name) return;
    write(NAMES_KEY, [name, ...names().filter((n) => !sameName(n, name))].slice(0, MAX_NAMES));
  }

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

  return {names, rememberName, rooms, rememberRoom, updateRoomName, forgetRoom};
}
