// Dots and Boxes as a room game: TurnMatch with the rules in rules.js, drawn as an SVG board.
// Tap between two dots to draw a line; closing a box claims it and gives you another move.

import {bake} from '../../bake.js';
import {loadCss} from '../../load-css.js';
import {TurnMatch} from '../turn-match.js';
import {HEADER, introduce, renderTurnHeader} from '../turn-ui.js';
import {SIZE, dotsRules} from './rules.js';
import {burstAt, floatText, playerColors, ringAt, vibrate} from '../../fx.js';
import {play} from '../../sound.js';
import {synth} from '../../synth.js';

const GAP = 60; // distance between dots in SVG units
const PAD = 22;
const NS = 'http://www.w3.org/2000/svg';
const svgEl = (name, attrs = {}) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

export async function createGame({session, container}) {
  await loadCss(new URL('../board.css', import.meta.url));
  await loadCss(new URL('./db.css', import.meta.url));
  container.innerHTML = `<div class="tg">${HEADER}<div class="db-page"></div></div>`;
  const side = SIZE * GAP + PAD * 2;
  const svg = svgEl('svg', {viewBox: `0 0 ${side} ${side}`, class: 'db-svg'});
  container.querySelector('.db-page').append(svg);
  const unbake = bake(container.querySelector('.db-page')); // paint the rich backgrounds once (js/bake.js)
  let chain = 0; // boxes closed in a row by the same player
  const at = (i) => PAD + i * GAP;

  const boxes = [];
  const initials = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      boxes.push(svgEl('rect', {x: at(c) + 3, y: at(r) + 3, width: GAP - 6, height: GAP - 6, rx: 6, class: 'db-box', fill: 'transparent'}));
      initials.push(svgEl('text', {x: at(c) + GAP / 2, y: at(r) + GAP / 2, class: 'db-initial'}));
    }
  }
  svg.append(...boxes, ...initials);

  const lines = [];
  const addLine = (h, r, c) => {
    const [x1, y1, x2, y2] = h ? [at(c), at(r), at(c + 1), at(r)] : [at(c), at(r), at(c), at(r + 1)];
    const hit = svgEl('line', {x1, y1, x2, y2, class: 'db-hit'});
    const line = svgEl('line', {x1, y1, x2, y2, class: 'db-line'});
    hit.dataset.line = `${h ? 'h' : 'v'}${r},${c}`;
    hit.addEventListener('click', () => match.play({h, r, c}));
    svg.append(hit, line);
    lines.push({h, r, c, hit, line});
  };
  for (let r = 0; r <= SIZE; r++) for (let c = 0; c < SIZE; c++) addLine(true, r, c);
  for (let r = 0; r < SIZE; r++) for (let c = 0; c <= SIZE; c++) addLine(false, r, c);
  for (let r = 0; r <= SIZE; r++) for (let c = 0; c <= SIZE; c++) svg.append(svgEl('circle', {cx: at(c), cy: at(r), r: 5, class: 'db-dot'}));

  let seenMoves = -1;
  let seenOwner = null; // box owners as last drawn, to spot a box that just closed
  let seenLines = new Set();
  const render = (snap) => {
    renderTurnHeader(container, snap, snap.state.scores, {myTurn: 'Your move (a closed box gives you another)'});
    const {h, v, owner} = snap.state;
    const fresh = snap.moves !== seenMoves;
    seenMoves = snap.moves;
    let drawnBy = null; // who drew the line that just appeared
    let closedBox = false;
    for (const l of lines) {
      const who = (l.h ? h : v)[l.r][l.c];
      const key = `${l.h}${l.r},${l.c}`;
      const isNew = who !== null && !seenLines.has(key);
      if (who !== null) seenLines.add(key);
      l.line.setAttribute('class', `db-line${who === null ? '' : who === snap.seat ? ' mine' : ' theirs'}${isNew && fresh && seenOwner ? ' fresh' : ''}`);
      if (isNew && fresh && seenOwner) { burstAt(l.line, 'pop', [playerColors()[who === snap.seat ? 0 : 1]]); drawnBy = who; }
      l.hit.classList.toggle('off', who !== null || !snap.myTurn || !!snap.over);
    }
    boxes.forEach((b, i) => {
      const who = owner[Math.floor(i / SIZE)][i % SIZE];
      const closed = seenOwner && seenOwner[i] === null && who !== null;
      const winner = snap.over && snap.over.winner !== null && snap.over.winner === who;
      b.setAttribute('class', `db-box${who === null ? '' : who === snap.seat ? ' mine' : ' theirs'}${who === null ? '' : ` seat-${who}`}${closed ? ' pop' : ''}${winner ? ' glow' : ''}`);
      b.style.setProperty('--i', String(Math.floor(i / SIZE) + (i % SIZE)));
      if (closed) {
        closedBox = true;
        const color = playerColors()[who === snap.seat ? 0 : 1];
        burstAt(b, 'sparkle', [color, '#ffffff']);
        ringAt(b, color);
        chain += 1;
        floatText(b, chain > 1 ? `CHAIN x${chain}!` : '+1', {color, size: 18 + Math.min(chain, 5) * 3});
        synth.arpeggio(true);
        if (who !== snap.seat) vibrate('tap');
      }
      initials[i].textContent = who === null ? '' : snap.names[who].trim().charAt(0).toUpperCase();
      initials[i].setAttribute('class', `db-initial${who === null ? '' : who === snap.seat ? ' mine' : ' theirs'}${who === null ? '' : ` seat-${who}`}${closed ? ' pop' : ''}`);
    });
    seenOwner = owner.flat();
    if (drawnBy !== null) { synth.whoosh(0.14); if (!closedBox) chain = 0; }
    if (drawnBy !== null && !snap.over) { // a box that closed is the bigger moment; the last move gets the result sound only
      const mine = drawnBy === snap.seat;
      play(closedBox ? (mine ? 'db.my_box' : 'db.their_box') : (mine ? 'board.my_move' : 'board.their_move'));
    }
  };
  const match = new TurnMatch({session, rules: dotsRules, onChange: render});
  render(match.snapshot());
  introduce(container.querySelector('.tg'), {theme: 'graph', title: 'Dots & Boxes', kicker: 'Mind the gap', sub: 'Close a box, go again', card: 'marker'});

  return {destroy() { unbake(); match.destroy(); container.replaceChildren(); }};
}
