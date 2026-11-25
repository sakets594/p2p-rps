// Bots that play both seats of a game in preview/game-demo.html, for recording gameplay clips. Throwaway tooling:
// it reaches into views by their class names and into matches by patching their prototypes, which real code never does.

import {findGame} from '../js/games.js';
import {memorySessions} from '../js/memory-transport.js';

const id = new URLSearchParams(location.search).get('game') ?? 'tron';
const roots = [document.getElementById('a'), document.getElementById('b')];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 20000) => { const t = performance.now(); while (!fn()) { if (performance.now() - t > ms) throw new Error(`timeout: ${fn}`); await sleep(10); } };
const matches = [];

// Math.random can be fed planned values (to make the word offers drawable); otherwise it is the real one.
const realRandom = Math.random;
const rigQueue = [];
// Only calls made from a game's pickChoices are fed, so animation code that also uses Math.random does not eat them.
Math.random = () => {
  while (rigQueue.length && !rigQueue[0].length) rigQueue.shift();
  if (!rigQueue.length || !new Error().stack.includes('pickChoices')) return realRandom();
  return rigQueue[0].shift();
};

/** Patch a match class so the demo can read each seat's live snapshot. */
function hook(Match, method = 'snapshot') {
  const orig = Match.prototype[method];
  Match.prototype[method] = function (...a) { const r = orig.apply(this, a); if (r && typeof r.seat === 'number') matches[r.seat] = this; return r; };
}

async function mount() {
  const {sessions} = memorySessions({sid: `demo-${id}-${Math.floor(realRandom() * 1e6)}`, players: [{id: 'alice', name: 'Alice'}, {id: 'bob', name: 'Bob'}]});
  sessions.forEach((s) => { s.gameId = id; });
  const mod = await findGame(id).load();
  window.__games = [await mod.createGame({session: sessions[0], container: roots[0]}), await mod.createGame({session: sessions[1], container: roots[1]})];
}

const tapDown = (el) => el?.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, cancelable: true}));

// --- Light Cycles: one smart rider, one sloppy one, swapped in round 2 ---------------------------------------------
async function tron() {
  const {TronMatch} = await import('../js/games/tron/match.js');
  const {W, H} = await import('../js/games/tron/rules.js');
  hook(TronMatch);
  await mount();
  const DX = [0, 1, 0, -1]; const DY = [-1, 0, 1, 0];
  const free = (st, x, y) => x >= 0 && y >= 0 && x < W && y < H && st.grid[y * W + x] === 0;
  const run = (st, x, y, d, max) => { let n = 0; while (n < max && free(st, x + DX[d] * (n + 1), y + DY[d] * (n + 1))) n++; return n; };
  const ap = {smart: 0, on: false, last: [-1, -1], cool: [0, 0]};
  setInterval(() => {
    if (!ap.on) return;
    for (const seat of [0, 1]) {
      const snap = matches[seat].snapshot(); const st = snap.state;
      if (snap.phase !== 'playing' || st.over || st.tick === ap.last[seat]) continue;
      ap.last[seat] = st.tick;
      if (ap.cool[seat] > 0) { ap.cool[seat]--; continue; }
      const b = st.bikes[seat]; const smart = seat === ap.smart; const look = smart ? 5 : 3;
      const l = (b.d + 3) % 4; const r = (b.d + 1) % 4;
      let side = 0;
      if (run(st, b.x, b.y, b.d, look + 1) < look) {
        const rl = run(st, b.x, b.y, l, smart ? 14 : 3); const rr = run(st, b.x, b.y, r, smart ? 14 : 3);
        side = rl >= rr ? -1 : 1;
        if (!smart && st.tick > 45 && realRandom() < 0.4) side = -side;
      } else if (realRandom() < (smart ? 0.07 : 0.1) && Math.max(run(st, b.x, b.y, l, 6), run(st, b.x, b.y, r, 6)) > 4) side = realRandom() < 0.5 ? -1 : 1;
      if (side) { tapDown(roots[seat].querySelector(side < 0 ? '.lc-left' : '.lc-right')); ap.cool[seat] = 3; }
    }
  }, 12);
  return async () => {
    const phase = () => matches[0].snapshot().phase;
    const go = async (r) => { for (let i = 0; i < 2; i++) { const b = r.querySelector('.lc-go'); if (!b.hidden) { b.click(); await sleep(250); } } };
    const log = [];
    await sleep(3200); // the intro title card
    for (let round = 1; round <= 5; round++) {
      ap.smart = round === 2 ? 1 : 0; ap.last = [-1, -1]; ap.cool = [0, 0];
      if (round > 1) await sleep(1800); // the round card
      await go(roots[0]); await sleep(500); await go(roots[1]);
      while (!['over', 'finished'].includes(phase())) { ap.on = phase() === 'playing'; await sleep(30); }
      ap.on = false;
      const snap = matches[0].snapshot();
      log.push([round, snap.scores.join('-')]);
      await sleep(2600);
      if (snap.finished) { await sleep(2600); break; }
    }
    return log;
  };
}

// --- Quick Draw: Alice wins, Bob jumps the gun, Bob wins one, Alice closes it out ----------------------------------
async function quickDraw() {
  await mount();
  const [A, B] = roots;
  const tap = (root) => tapDown(root.querySelector('.qd-fire'));
  const drawShown = () => { const b = A.querySelector('.qd-banner'); return !b.hidden && b.classList.contains('draw'); };
  const go = async (root) => {
    for (let i = 0; i < 2; i++) { const b = root.querySelector('.qd-go'); if (!b.hidden) { const t = b.textContent; b.click(); if (t === 'Next duel') await sleep(80); else return; } }
  };
  return async () => {
    const log = [];
    await sleep(3300);
    const plan = [['a', 'fair'], ['a', 'bobEarly'], ['b', 'fair'], ['a', 'fair']];
    for (const [winner, kind] of plan) {
      await go(A); await sleep(500); await go(B);
      if (kind === 'bobEarly') { await sleep(2600); tap(B); }
      else {
        await waitFor(drawShown);
        if (winner === 'a') { await sleep(190); tap(A); await sleep(130); tap(B); } else { await sleep(210); tap(B); await sleep(120); tap(A); }
      }
      await waitFor(() => A.querySelector('.qd-times').textContent !== '', 8000);
      await sleep(3200);
      log.push(A.querySelector('.qd-times').textContent);
    }
    await sleep(2500);
    return log;
  };
}

// --- Draw & Guess / Blind Draw: the drawer always gets offered a word the bot can draw ------------------------------
const circ = (cx, cy, r, n = 28) => Array.from({length: n + 1}, (_, i) => [cx + r * Math.cos(i / n * 2 * Math.PI), cy + r * Math.sin(i / n * 2 * Math.PI)]);
const DRAWINGS = {
  sun: [[4, 2, circ(.5, .5, .15)], ...Array.from({length: 8}, (_, i) => { const a = i * Math.PI / 4; return [4, 1, [[.5 + .2 * Math.cos(a), .5 + .2 * Math.sin(a)], [.5 + .32 * Math.cos(a), .5 + .32 * Math.sin(a)]]]; })],
  house: [[0, 1, [[.25, .8], [.25, .5], [.75, .5], [.75, .8], [.25, .8]]], [1, 1, [[.2, .5], [.5, .22], [.8, .5]]], [2, 1, [[.45, .8], [.45, .62], [.58, .62], [.58, .8]]]],
  tree: [[0, 2, [[.47, .85], [.47, .58], [.53, .58], [.53, .85]]], [3, 2, circ(.5, .4, .2)]],
  fish: [[2, 1, [[.25, .5], [.4, .36], [.6, .36], [.72, .5], [.6, .64], [.4, .64], [.25, .5]]], [2, 1, [[.72, .5], [.86, .38], [.86, .62], [.72, .5]]], [0, 1, circ(.36, .48, .015, 6)]],
  cloud: [[2, 1, [[.25, .62], [.22, .52], [.3, .44], [.4, .44], [.46, .36], [.58, .36], [.64, .44], [.74, .46], [.8, .55], [.74, .62], [.25, .62]]]],
  car: [[1, 1, [[.15, .62], [.15, .5], [.3, .46], [.38, .34], [.62, .34], [.7, .46], [.86, .5], [.86, .62], [.15, .62]]], [0, 2, circ(.32, .66, .06, 14)], [0, 2, circ(.7, .66, .06, 14)]],
  cactus: [[3, 2, [[.47, .85], [.47, .3], [.53, .3], [.53, .85]]], [3, 2, [[.47, .62], [.32, .62], [.32, .45]]], [3, 2, [[.53, .55], [.68, .55], [.68, .4]]]],
  balloon: [[1, 2, circ(.5, .38, .2)], [0, 0, [[.5, .58], [.52, .7], [.48, .78], [.5, .88]]]],
  clock: [[0, 1, circ(.5, .5, .3)], [0, 2, [[.5, .5], [.5, .3]]], [1, 1, [[.5, .5], [.64, .56]]]],
  snowman: [[2, 1, circ(.5, .66, .17)], [2, 1, circ(.5, .4, .12)], [0, 2, [[.46, .38], [.461, .381]]], [0, 2, [[.54, .38], [.541, .381]]], [4, 1, [[.5, .42], [.62, .45]]]],
  apple: [[1, 2, circ(.5, .55, .22)], [3, 1, [[.5, .35], [.55, .22]]]],
  flower: [[3, 1, [[.5, .5], [.5, .85]]], ...Array.from({length: 6}, (_, i) => { const a = i * Math.PI / 3; return [1, 1, circ(.5 + .11 * Math.cos(a), .38 + .11 * Math.sin(a), .07, 10)]; }), [4, 2, circ(.5, .38, .04, 10)]],
  rocket: [[2, 1, [[.5, .15], [.62, .4], [.62, .68], [.38, .68], [.38, .4], [.5, .15]]], [1, 1, [[.38, .6], [.28, .75], [.38, .7]]], [1, 1, [[.62, .6], [.72, .75], [.62, .7]]], [4, 2, [[.45, .72], [.5, .88], [.55, .72]]]],
};
const WRONG = {sun: 'moon', house: 'barn', tree: 'lollipop', fish: 'bird', cloud: 'sheep', car: 'bus', cactus: 'tree', balloon: 'apple', clock: 'plate', snowman: 'ghost', apple: 'ball', flower: 'sun', rocket: 'pencil'};

async function drawGuess() {
  const {WORDS} = await import('../js/games/draw-guess/words.js');
  const {shuffled} = await import('../js/rng.js');
  const known = Object.keys(DRAWINGS);
  const offered = (vals) => { let k = 0; return shuffled(WORDS, () => vals[k++]).slice(0, 3); };
  const plan = [];
  for (let r = 0; r < 4; r++) {
    let v; let o;
    do { v = Array.from({length: WORDS.length}, () => realRandom()); o = offered(v); } while (!o.some((w) => known.includes(w)) || plan.some((p) => p.o.some((w) => o.includes(w))));
    plan.push({v, o, word: o.find((w) => known.includes(w))});
  }
  rigQueue.push([...plan[0].v]);
  await mount();
  const ev = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, {bubbles: true, cancelable: true, pointerId: 1, clientX: x, clientY: y, pointerType: 'mouse', isPrimary: true}));
  const stroke = async (root, [color, width, pts]) => {
    const canvas = root.querySelector('.dg-canvas');
    root.querySelectorAll('.dg-color')[color].click(); root.querySelectorAll('.dg-size')[width].click();
    await sleep(140);
    const r = canvas.getBoundingClientRect();
    const P = pts.map(([u, v]) => [r.left + u * r.width, r.top + v * r.height]);
    ev(canvas, 'pointerdown', ...P[0]);
    for (let i = 1; i < P.length; i++) {
      const [x0, y0] = P[i - 1]; const [x1, y1] = P[i];
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 7));
      for (let k = 1; k <= n; k++) { ev(canvas, 'pointermove', x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n); await sleep(14); }
    }
    ev(canvas, 'pointerup', ...P[P.length - 1]);
    await sleep(160);
  };
  const type = async (root, text) => {
    const input = root.querySelector('.dg-input');
    input.value = '';
    for (const ch of text) { input.value += ch; await sleep(90); }
    await sleep(250);
    root.querySelector('.dg-guess').dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
  };
  return async (rounds = 2) => {
    const log = [];
    await sleep(3400);
    for (let round = 0; round < rounds; round++) {
      await waitFor(() => roots.some((r) => !r.querySelector('.dg-choose').hidden && r.querySelector('.dg-card')));
      const di = roots.findIndex((r) => !r.querySelector('.dg-choose').hidden);
      const drawer = roots[di]; const guesser = roots[1 - di];
      const {word} = plan[round];
      await sleep(1600);
      [...drawer.querySelectorAll('.dg-card')].find((b) => b.querySelector('span').textContent === word).click();
      await sleep(1200);
      const strokes = DRAWINGS[word];
      for (let i = 0; i < strokes.length; i++) {
        await stroke(drawer, strokes[i]);
        if (i === Math.min(1, strokes.length - 1)) await type(guesser, WRONG[word]);
      }
      await sleep(1100);
      await type(guesser, word);
      await sleep(600);
      log.push([word, guesser.querySelector('.dg-status').textContent]);
      await sleep(3600);
      if (round < rounds - 1) {
        rigQueue.length = 0; rigQueue.push([...plan[round + 1].v]);
        roots.forEach((r) => { const b = r.querySelector('.dg-next'); if (!b.hidden) b.click(); });
        await sleep(600);
        rigQueue.length = 0;
        await sleep(2400); // the round card
      }
    }
    await sleep(1500);
    return log;
  };
}

// --- Emoji Charades: acts the bot knows how to perform --------------------------------------------------------------
const ACTS = {
  'lion king': {seq: ['🦁', '👑'], wrong: 'narnia'},
  'traffic jam': {seq: ['🚗', '🚗', '🚗', '🚗', '😡', '⏰'], wrong: 'car race'},
  'sleeping in': {seq: ['😴', '🛏️', '⏰', '🔇', '💤'], wrong: 'sleeping'},
  'kung fu panda': {seq: ['🐼', '🥷', '💪'], wrong: 'panda'},
  'hot dog': {seq: ['🔥', '🐶'], wrong: 'fire dog'},
  'cheese burger': {seq: ['🧀', '🍔'], wrong: 'burger king'},
  'road trip': {seq: ['🚗', '➡️', '⛰️', '➡️', '🏝️'], wrong: 'holiday'},
  'power cut': {seq: ['💡', '❌', '😱'], wrong: 'dark'},
  'fire drill': {seq: ['🔥', '🔔', '🏃', '🏫'], wrong: 'fire'},
  'birthday party': {seq: ['🎂', '🎈', '🥳'], wrong: 'birthday cake'},
  'north pole': {seq: ['❄️', '🐧', '⬆️'], wrong: 'antarctica'},
  'jurassic park': {seq: ['🦖', '🦖', '🌳'], wrong: 'dinosaur'},
  'spider man': {seq: ['🕷️', '👨'], wrong: 'spider'},
  'frozen': {seq: ['❄️', '👸', '🥶'], wrong: 'snow queen'},
  'titanic': {seq: ['🚢', '❄️', '💔', '🌊'], wrong: 'boat'},
};

async function emojiCharades() {
  const {pickChoices} = await import('../js/games/emoji-charades/rules.js');
  const {TABS} = await import('../js/games/emoji-charades/emoji.js');
  const known = Object.keys(ACTS);
  const offered = (vals) => { let k = 0; return pickChoices(() => vals[k++]).map((p) => p.text); };
  const plan = [];
  for (let r = 0; r < 4; r++) {
    let v; let o;
    do { v = Array.from({length: 200}, () => realRandom()); o = offered(v); } while (!o.some((w) => known.includes(w)) || plan.some((p) => p.o.some((w) => o.includes(w))));
    plan.push({v, o, act: o.find((w) => known.includes(w))});
  }
  rigQueue.push([...plan[0].v]);
  await mount();
  const type = async (root, text) => {
    const input = root.querySelector('.dg-input');
    input.value = '';
    for (const ch of text) { input.value += ch; await sleep(85); }
    await sleep(250);
    root.querySelector('.dg-guess').dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
  };
  const add = async (root, e) => {
    const ti = TABS.findIndex((t) => t.set.includes(e));
    const tab = root.querySelectorAll('.ec-tab')[ti];
    if (!tab.classList.contains('on')) { tab.click(); await sleep(420); }
    [...root.querySelectorAll('.ec-grid .ec-key')].find((b) => b.textContent === e).click();
    await sleep(700);
  };
  return async (rounds = 2) => {
    const log = [];
    await sleep(3400);
    for (let round = 0; round < rounds; round++) {
      await waitFor(() => roots.some((r) => !r.querySelector('.ec-choose').hidden && r.querySelector('.ec-ticket')));
      const di = roots.findIndex((r) => !r.querySelector('.ec-choose').hidden);
      const d = roots[di]; const g = roots[1 - di];
      const {act} = plan[round];
      await sleep(1700);
      [...d.querySelectorAll('.ec-ticket')].find((b) => b.querySelector('.ec-choice-text').textContent === act).click();
      await sleep(1500);
      const {seq, wrong} = ACTS[act];
      for (let i = 0; i < seq.length; i++) {
        await add(d, seq[i]);
        if (round === 0 && i === 0) { await add(d, '🤔'); await sleep(300); d.querySelector('.ec-back').click(); await sleep(600); }
        if (i === Math.min(1, seq.length - 1)) await type(g, wrong);
      }
      await sleep(1200);
      await type(g, act);
      await sleep(600);
      log.push([act, g.querySelector('.dg-status').textContent]);
      await sleep(3600);
      if (round < rounds - 1) {
        rigQueue.length = 0; rigQueue.push([...plan[round + 1].v]);
        roots.forEach((r) => { const b = r.querySelector('.dg-next'); if (!b.hidden) b.click(); });
        await sleep(600);
        rigQueue.length = 0;
        await sleep(2400);
      }
    }
    await sleep(1500);
    return log;
  };
}

// --- The original nine ------------------------------------------------------------------------------------------
/** Click `sel` in whichever screen has it enabled (the player whose turn it is). */
const clickOnTurn = (sel) => { for (const r of roots) { const el = r.querySelector(sel); if (el && !el.disabled && !el.classList.contains('off')) { el.dispatchEvent(new MouseEvent('click', {bubbles: true})); return r; } } return null; };

async function ticTacToe() {
  await mount();
  return async () => {
    await sleep(3600); // intro card and the chalk grid
    for (const i of [4, 1, 0, 8, 6, 3, 2]) { clickOnTurn(`.ttt-cell[data-cell="${i}"]`); await sleep(1100); }
    await sleep(3500);
  };
}

async function connectFour() {
  await mount();
  return async () => {
    await sleep(3400);
    for (const c of [3, 3, 4, 4, 2, 5, 5, 2, 1]) {
      const r = roots.find((x) => !x.querySelector(`.c4-col[data-col="${c}"]`).disabled);
      r?.querySelector(`.c4-col[data-col="${c}"]`).dispatchEvent(new PointerEvent('pointerenter'));
      await sleep(350);
      clickOnTurn(`.c4-col[data-col="${c}"]`);
      await sleep(950);
    }
    await sleep(3500);
  };
}

async function dotsAndBoxes() {
  const {SIZE} = await import('../js/games/dots-and-boxes/rules.js');
  await mount();
  const drawn = () => new Set([...roots[0].querySelectorAll('.db-hit')].filter((h) => h.nextElementSibling.matches('.mine, .theirs')).map((h) => h.dataset.line));
  const sides = (r, c, d) => [`h${r},${c}`, `h${r + 1},${c}`, `v${r},${c}`, `v${r},${c + 1}`].filter((k) => d.has(k)).length;
  const boxesOf = (k) => {
    const h = k[0] === 'h'; const [r, c] = k.slice(1).split(',').map(Number);
    return (h ? [[r - 1, c], [r, c]] : [[r, c - 1], [r, c]]).filter(([a, b]) => a >= 0 && b >= 0 && a < SIZE && b < SIZE);
  };
  return async () => {
    await sleep(3400);
    for (let n = 0; n < 80; n++) {
      const d = drawn();
      const open = [...roots[0].querySelectorAll('.db-hit')].map((h) => h.dataset.line).filter((k) => !d.has(k));
      if (!open.length) break;
      const closes = open.filter((k) => boxesOf(k).some(([r, c]) => sides(r, c, d) === 3));
      const safe = open.filter((k) => boxesOf(k).every(([r, c]) => sides(r, c, d) < 2));
      const pick = (closes.length ? closes : safe.length ? safe : open)[Math.floor(realRandom() * (closes.length || safe.length || open.length))];
      clickOnTurn(`.db-hit[data-line="${pick}"]`);
      await sleep(closes.length ? 650 : 380);
    }
    await sleep(3000);
  };
}

async function memoryMatch() {
  const {TurnMatch} = await import('../js/games/turn-match.js');
  hook(TurnMatch);
  await mount();
  return async () => {
    await sleep(4200); // intro and the deal
    for (let n = 0; n < 24; n++) {
      const seat = matches.findIndex((m) => m?.snapshot().myTurn);
      if (seat < 0) { await sleep(300); continue; }
      const snap = matches[seat].snapshot();
      if (snap.over) break;
      const s = snap.state;
      const open = s.cards.map((_, i) => i).filter((i) => s.matched[i] === null);
      // Sometimes it "remembers" a pair, sometimes it guesses.
      let a = open[Math.floor(realRandom() * open.length)];
      let b = realRandom() < 0.55 ? open.find((i) => i !== a && s.cards[i] === s.cards[a]) : open.filter((i) => i !== a)[Math.floor(realRandom() * (open.length - 1))];
      if (b === undefined) b = open.find((i) => i !== a);
      const root = roots[seat];
      root.querySelector(`.mm-card[data-card="${a}"]`).click(); await sleep(650);
      root.querySelector(`.mm-card[data-card="${b}"]`).click(); await sleep(2000);
    }
    await sleep(2500);
  };
}

async function battleship() {
  await mount();
  return async () => {
    await sleep(2800);
    roots[0].querySelector('.bs-shuffle').click(); await sleep(700);
    roots[0].querySelector('.bs-shuffle').click(); await sleep(700);
    roots.forEach((r) => r.querySelector('.bs-ready').click());
    await sleep(3000);
    for (let n = 0; n < 18; n++) {
      const r = roots.find((x) => [...x.querySelectorAll('.bs-enemy .bs-cell')].some((c) => !c.disabled));
      if (!r) { await sleep(300); continue; }
      const cells = [...r.querySelectorAll('.bs-enemy .bs-cell')];
      const hits = cells.map((c, i) => (c.classList.contains('hit') ? i : -1)).filter((i) => i >= 0);
      const near = hits.flatMap((i) => [i - 1, i + 1, i - 10, i + 10]).filter((i) => i >= 0 && i < 100 && !cells[i].disabled);
      // Now and then it "guesses" a real ship, so the clip shows blasts as well as splashes.
      const theirs = [...roots[1 - roots.indexOf(r)].querySelectorAll('.bs-mine .bs-cell')].map((c, i) => (c.classList.contains('ship') && !cells[i].disabled ? i : -1)).filter((i) => i >= 0);
      const pool = n % 4 < 2 && theirs.length ? theirs.slice(0, 1) : near.length ? near : cells.map((c, i) => i).filter((i) => !cells[i].disabled);
      cells[pool[Math.floor(realRandom() * pool.length)]].click();
      await sleep(1500);
    }
    await sleep(2000);
  };
}

async function hangman() {
  await mount();
  const guess = async (letters) => {
    for (const l of letters) {
      const r = roots.find((x) => !x.querySelector('.hm-keys').hidden);
      r?.querySelector(`[data-key="${l}"]`).click();
      await sleep(900);
    }
  };
  const setWord = async (word) => {
    await waitFor(() => roots.some((r) => !r.querySelector('.hm-pick').hidden));
    const r = roots.find((x) => !x.querySelector('.hm-pick').hidden);
    const input = r.querySelector('.hm-input');
    for (const ch of word) { input.value += ch; await sleep(110); }
    await sleep(300);
    r.querySelector('.hm-pick').dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    await sleep(900);
  };
  return async () => {
    await sleep(3300);
    await setWord('rocket');
    await guess(['e', 'a', 'o', 'z', 't', 'r', 'c', 'k']);
    await sleep(3200);
    roots.forEach((r) => r.querySelector('.hm-next').click());
    await sleep(2600);
    await setWord('jazz');
    await guess(['e', 'a', 'o', 'i', 'u', 's', 't', 'n']);
    await sleep(4000);
  };
}

async function triviaDuel() {
  const {QUESTIONS} = await import('../js/games/trivia-duel/questions.js');
  await mount();
  const right = (root) => {
    const q = QUESTIONS.find((x) => x.q === root.querySelector('.tv-q > span').textContent);
    const text = q?.a[q.correct];
    return [...root.querySelectorAll('.tv-opt')].find((b) => b.querySelector('span')?.textContent === text);
  };
  return async () => {
    await sleep(2600);
    for (let n = 0; n < 4; n++) {
      const [A, B] = roots;
      const q = A.querySelector('.tv-q').textContent;
      await sleep(1600);
      (right(A) ?? A.querySelector('.tv-opt')).click();
      await sleep(700 + realRandom() * 500);
      const wrong = [...B.querySelectorAll('.tv-opt')].find((b) => b !== right(B));
      (n % 2 ? right(B) : wrong)?.click();
      await waitFor(() => A.querySelector('.tv-q').textContent !== q, 15000).catch(() => {});
    }
    await sleep(1000);
  };
}

async function rps() {
  await mount();
  return async () => {
    await sleep(3400);
    for (const [a, b] of [['rock', 'scissors'], ['paper', 'paper'], ['scissors', 'rock']]) {
      roots[0].querySelector(`.move[data-move="${a}"]`).click(); await sleep(700);
      roots[1].querySelector(`.move[data-move="${b}"]`).click();
      await waitFor(() => !roots[0].querySelector('.next').hidden, 12000);
      await sleep(1800);
      roots.forEach((r) => r.querySelector('.next').click());
      await sleep(900);
    }
  };
}

async function cupPong() {
  const {CupPongMatch, PARAMS} = await import('../js/games/cup-pong/match.js');
  const {simulate} = await import('../js/games/cup-pong/physics.js');
  const seats = [];
  const orig = CupPongMatch.prototype.canThrow;
  CupPongMatch.prototype.canThrow = function () { seats[this.seat] = this; return orig.call(this); };
  await mount();
  const aim = (m) => {
    const cups = m.targetCups();
    const hits = []; const misses = [];
    for (let a = -60; a <= 60; a += 3) for (let p = 20; p <= 255; p += 3) {
      const out = simulate(a, p, cups, PARAMS);
      (out.outcome === 'in' ? hits : misses).push([a, p]);
    }
    const pool = hits.length && realRandom() < 0.6 ? hits : misses.filter(([, p]) => p > 120);
    return pool[Math.floor(realRandom() * pool.length)];
  };
  return async () => {
    await sleep(9000); // intro, START, and the spinner
    for (let n = 0; n < 7; n++) {
      await waitFor(() => seats.some((m) => m?.canThrow()), 15000).catch(() => {});
      const m = seats.find((x) => x?.canThrow());
      if (!m) break;
      await sleep(1200);
      const [a, p] = aim(m);
      m.throw(a, p);
      await sleep(3200);
    }
    await sleep(1500);
  };
}

const BOTS = {tron, 'quick-draw': quickDraw, 'draw-guess': drawGuess, 'blind-draw': drawGuess, 'emoji-charades': emojiCharades,
  'tic-tac-toe': ticTacToe, 'connect-four': connectFour, 'dots-and-boxes': dotsAndBoxes, 'memory-match': memoryMatch,
  battleship, hangman, 'trivia-duel': triviaDuel, rps, 'cup-pong': cupPong};
const runner = await BOTS[id]?.();
window.__demo = {run: runner, matches, roots, rigQueue};
if (new URLSearchParams(location.search).has('auto')) { await sleep(300); window.__demo.result = await runner(); }
