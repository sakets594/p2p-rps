import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_GAME_ID, GAMES, allTags, filterGames, findGame, playersLabel} from '../js/games.js';

test('registry: ids are unique slugs and the default game is playable', () => {
  const ids = GAMES.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9-]{1,32}$/, 'ids end up in URLs and storage');
  assert.equal(findGame(DEFAULT_GAME_ID)?.status, 'ready');
});

test('registry: every entry has what the card needs', () => {
  for (const g of GAMES) {
    assert.ok(g.title && g.icon && g.blurb, g.id);
    assert.ok(g.tags.length > 0, g.id);
    assert.ok(['ready', 'soon'].includes(g.status), g.id);
    assert.ok(Number.isInteger(g.minPlayers) && g.minPlayers >= 2 && g.maxPlayers >= g.minPlayers, g.id);
    assert.ok(g.layout === undefined || ['column', 'wide'].includes(g.layout), g.id);
  }
});

test('registry: every playable game can be loaded', () => {
  for (const g of GAMES.filter((x) => x.status === 'ready')) assert.equal(typeof g.load, 'function', g.id);
});

test('playersLabel: a fixed count or a range', () => {
  assert.equal(playersLabel({minPlayers: 2, maxPlayers: 2}), '2 players');
  assert.equal(playersLabel({minPlayers: 2, maxPlayers: 6}), '2\u20136 players');
});

test('findGame: unknown or missing ids give null', () => {
  assert.equal(findGame('nope'), null);
  assert.equal(findGame(null), null);
  assert.equal(findGame('rps').title, 'Rock Paper Scissors');
});

test('allTags: unique and sorted', () => {
  const tags = allTags();
  assert.deepEqual(tags, [...new Set(tags)].sort((a, b) => a.localeCompare(b)));
  assert.ok(tags.includes('Board') && tags.includes('Party'));
});

test('filterGames: no filter returns everything, playable games first', () => {
  const all = filterGames();
  assert.equal(all.length, GAMES.length);
  const firstSoon = all.findIndex((g) => g.status === 'soon');
  assert.ok(all.slice(firstSoon).every((g) => g.status === 'soon'));
});

test('filterGames: search matches title, blurb and tags, ignoring case', () => {
  assert.deepEqual(filterGames({query: 'ROCK'}).map((g) => g.id), ['rps']);
  assert.ok(filterGames({query: 'strategy'}).every((g) => g.tags.includes('Strategy')));
  assert.ok(filterGames({query: 'fleet'}).some((g) => g.id === 'battleship'), 'blurb text is searchable');
});

test('filterGames: every word must match, so extra words narrow the result', () => {
  const board = filterGames({query: 'board'});
  const boardQuick = filterGames({query: 'board quick'});
  assert.ok(boardQuick.length < board.length);
  assert.ok(boardQuick.every((g) => g.tags.includes('Board') && g.tags.includes('Quick')));
  assert.deepEqual(filterGames({query: 'zzzz'}), []);
});

test('filterGames: tag filter combines with search; blank search is ignored', () => {
  assert.ok(filterGames({tag: 'Word'}).every((g) => g.tags.includes('Word')));
  assert.deepEqual(filterGames({tag: 'Word', query: 'rock'}), []);
  assert.equal(filterGames({query: '   '}).length, GAMES.length);
});
