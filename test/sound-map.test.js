import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {HELD_BACK, SCENARIOS, allClips, clipsFor, pickClip, scenarioIds} from '../js/sound-map.js';

const LIBRARY = '/Users/saket/workspace/assets/meme-music';
const haveLibrary = existsSync(`${LIBRARY}/dataset.json`);

test('sound map: ids are dotted slugs and every scenario has a reason and a tier', () => {
  for (const id of scenarioIds()) {
    assert.match(id, /^[a-z]+\.[a-z_]+$/, id);
    assert.ok(SCENARIOS[id].when, id);
    assert.ok([1, 2].includes(SCENARIOS[id].tier), id);
  }
});

test('sound map: every scenario offers at least two clips, so there is something to randomize', () => {
  for (const id of scenarioIds()) assert.ok(clipsFor(id).length >= 2, id);
});

test('sound map: Hindi clips are never outnumbered by English ones', () => {
  for (const id of scenarioIds()) {
    const s = SCENARIOS[id];
    assert.ok(s.desi.length >= s.en.length, `${id}: more English than Hindi`);
  }
});

test('sound map: held-back clips are never mapped', () => {
  const used = new Set(allClips().map((c) => c.replace(/^.*\//, '').replace(/\.mp3$/, '')));
  for (const stem of Object.keys(HELD_BACK)) assert.ok(!used.has(stem), stem);
});

test('sound map: no english music is mapped', { skip: !haveLibrary }, () => {
  const dataset = JSON.parse(readFileSync(`${LIBRARY}/dataset.json`, 'utf8'));
  const music = new Set(dataset.filter((t) => t.category === 'english' && t.subcategory === 'music').map((t) => t.file_path));
  for (const clip of allClips()) assert.ok(!music.has(`audio/${clip}`), clip);
});

test('sound map: every mapped clip exists in the library', { skip: !haveLibrary }, () => {
  for (const clip of allClips()) assert.ok(existsSync(`${LIBRARY}/audio/${clip}`), clip);
});

test('pickClip: picks within the pool, never repeats the last unless forced', () => {
  const pool = clipsFor('rps.round_won');
  for (let i = 0; i < 50; i++) {
    const last = pool[i % pool.length];
    const next = pickClip('rps.round_won', {last});
    assert.ok(pool.includes(next));
    assert.notEqual(next, last);
  }
  assert.equal(pickClip('nope.nothing'), null);
});

test('pickClip: rng chooses the index', () => {
  const pool = clipsFor('cp.my_hit');
  assert.equal(pickClip('cp.my_hit', {rng: () => 0}), pool[0]);
  assert.equal(pickClip('cp.my_hit', {rng: () => 0.999}), pool[pool.length - 1]);
});

test('sound map: every mapped clip is committed under assets/sfx (run `npm run sfx` if not)', () => {
  const root = new URL('../assets/sfx/', import.meta.url);
  for (const clip of allClips()) assert.ok(existsSync(new URL(clip, root)), clip);
});
