import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {GAMES} from '../js/games.js';
import {SKINS, skinOf} from '../js/skins.js';

const css = (id) => new URL(`../js/games/${id === 'blind-draw' ? 'draw-guess' : id}/skins.css`, import.meta.url);

test('every playable game has three skins with unique ids, and the first is the default', () => {
  for (const g of GAMES.filter((x) => x.status === 'ready')) {
    const list = SKINS[g.id];
    assert.equal(list?.length, 3, g.id);
    assert.equal(new Set(list.map(([id]) => id)).size, 3, g.id);
    assert.equal(skinOf(g.id), list[0][0], g.id);
  }
});

test('every non-default skin is styled', () => {
  for (const [id, list] of Object.entries(SKINS)) {
    assert.ok(existsSync(css(id)), id);
    const text = readFileSync(css(id), 'utf8');
    for (const [skin] of list.slice(1)) assert.ok(text.includes(`[data-skin="${skin}"]`), `${id}: ${skin}`);
  }
});
