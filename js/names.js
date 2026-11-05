// Display names come from the network and are shown in the UI, so they are
// always passed through cleanName before use.

export const MAX_NAME_LENGTH = 16;
export const MAX_ROOM_NAME_LENGTH = 24;

// Names offered to a player who has not typed one. Each fits MAX_NAME_LENGTH.
export const DEFAULT_NAMES = [
  'Gajodhar', 'Ramkhilawan', 'Sukhlal', 'Birju', 'Jhalluram', 'Banshidhar', 'Ghasitaram',
  'Kalluram', 'Kallu Pehelwan', 'Fekuram', 'Dhaniram', 'Mithailal', 'Tota Ram', 'Kalicharan',
  'Ramcharan', 'Bhagwandas', 'Jwala Prasad', 'Deviprasad', 'Chunilal', 'Dhanpatrai', 'Chhaganlal',
  'Maganlal', 'Basantiram', 'Lallan Prasad', 'Balwant Rai',
];

/** A random default name. `random` is Math.random-shaped, injectable for tests. */
export function randomName(random = Math.random) {
  return DEFAULT_NAMES[Math.floor(random() * DEFAULT_NAMES.length)];
}

/** Strip control chars, trim, cap. Returns `fallback` for anything that is not a usable string. */
export function cleanName(raw, fallback = '', max = MAX_NAME_LENGTH) {
  if (typeof raw !== 'string') return fallback;
  const name = raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  return Array.from(name).slice(0, max).join('') || fallback;
}
