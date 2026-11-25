// Skins: several looks per game. The first in each list is the default; the choice is per device and purely cosmetic
// (the two players may use different skins). A skin is CSS under `[data-skin="<id>"]` in js/games/<folder>/skins.css,
// plus, for games drawn on a canvas, a theme the view looks up by the same id.
//
// The dropdown appears in debug mode: open the site with ?debug (it stays on for this browser; ?debug=off ends it).

import {loadCss} from './load-css.js';

export const SKINS = {
  rps: [['arena', 'Fight night'], ['dojo', 'Dojo at sunrise'], ['cyber', 'Cyber fists']],
  'cup-pong': [['bar', 'Neon bar'], ['beach', 'Sunset beach'], ['space', 'Space station']],
  'tic-tac-toe': [['chalk', 'Chalkboard'], ['neon', 'Neon on brick'], ['sand', 'Beach sand']],
  'connect-four': [['toy', 'Toy box'], ['neon', 'Neon arcade'], ['royal', 'Royal coins']],
  'dots-and-boxes': [['graph', 'Graph paper'], ['blueprint', 'Blueprint'], ['stars', 'Constellations']],
  'memory-match': [['felt', 'Card table'], ['arcane', 'Arcane tarot'], ['ocean', 'Deep ocean']],
  battleship: [['navy', 'War room'], ['pirate', 'Pirate map'], ['amber', 'Amber submarine']],
  hangman: [['sky', 'Balloon ride'], ['night', 'Night flight'], ['candy', 'Candy sunset']],
  'trivia-duel': [['studio', 'Quiz studio'], ['retro', 'Retro arcade'], ['gold', 'Gala night']],
  'draw-guess': [['desk', 'Sketchbook'], ['board', 'Blackboard'], ['gallery', 'Art gallery']],
  'blind-draw': [['desk', 'Sketchbook'], ['board', 'Blackboard'], ['gallery', 'Art gallery']],
  'emoji-charades': [['theatre', 'Theatre'], ['circus', 'Circus tent'], ['drivein', 'Drive-in']],
  tron: [['grid', 'Neon grid'], ['arctic', 'Arctic night'], ['inferno', 'Inferno']],
  'quick-draw': [['western', 'High noon'], ['noir', 'Blood-sun noir'], ['comic', 'Pop-art comic']],
};

const store = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const folderOf = (gameId) => (gameId === 'blind-draw' ? 'draw-guess' : gameId);

/** The skin to use for a game: the saved choice if it still exists, otherwise the default. */
export function skinOf(gameId) {
  const list = SKINS[gameId] ?? [];
  const saved = store()?.getItem(`skin:${gameId}`);
  return list.some(([id]) => id === saved) ? saved : list[0]?.[0] ?? null;
}

/** Put the game's skin on its container; call before the game mounts. */
export async function dress(gameId, container, skin = skinOf(gameId)) {
  if (!skin) return;
  container.dataset.skin = skin;
  await loadCss(new URL(`./games/${folderOf(gameId)}/skins.css`, import.meta.url)).catch(() => {});
}

/** Change the skin of a running game. Canvas views and js/bake.js listen for `skinchange` on the document. */
export function setSkin(gameId, skin, containers) {
  store()?.setItem(`skin:${gameId}`, skin);
  for (const c of containers) c.dataset.skin = skin;
  document.dispatchEvent(new CustomEvent('skinchange', {detail: {gameId, skin}}));
}

/** Debug mode, remembered for this browser. */
export function debugOn() {
  const q = new URLSearchParams(globalThis.location?.search ?? '').get('debug');
  if (q !== null) store()?.setItem('debug', q === 'off' ? '' : '1');
  return Boolean(store()?.getItem('debug'));
}

/** The debug dropdown. `containers` is a function, so it finds whatever is mounted when the choice is made. */
export function skinPicker(gameId, containers) {
  const label = document.createElement('label');
  label.className = 'skin-picker';
  label.textContent = 'Skin ';
  const select = document.createElement('select');
  for (const [id, name] of SKINS[gameId] ?? []) select.append(new Option(name, id, false, id === skinOf(gameId)));
  select.addEventListener('change', () => setSkin(gameId, select.value, containers()));
  label.append(select);
  return label;
}
