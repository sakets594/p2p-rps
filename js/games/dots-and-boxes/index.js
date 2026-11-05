// Dots and Boxes as a room game: TurnMatch with the rules in rules.js, drawn as an SVG board.
// Tap between two dots to draw a line; closing a box claims it and gives you another move.

import {loadCss} from '../../load-css.js';
import {TurnMatch} from '../turn-match.js';
import {HEADER, renderTurnHeader} from '../turn-ui.js';
import {SIZE, dotsRules} from './rules.js';

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
  container.innerHTML = `<div class="tg">${HEADER}</div>`;
  const side = SIZE * GAP + PAD * 2;
  const svg = svgEl('svg', {viewBox: `0 0 ${side} ${side}`, class: 'db-svg'});
  container.querySelector('.tg').append(svg);
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
  const render = (snap) => {
    renderTurnHeader(container, snap, snap.state.scores, {myTurn: 'Your move (a closed box gives you another)'});
    const {h, v, owner} = snap.state;
    const fresh = snap.moves !== seenMoves;
    seenMoves = snap.moves;
    for (const l of lines) {
      const who = (l.h ? h : v)[l.r][l.c];
      l.line.setAttribute('class', `db-line${who === null ? '' : who === snap.seat ? ' mine' : ' theirs'}`);
      l.hit.classList.toggle('off', who !== null || !snap.myTurn || !!snap.over);
    }
    void fresh;
    boxes.forEach((b, i) => {
      const who = owner[Math.floor(i / SIZE)][i % SIZE];
      b.setAttribute('class', `db-box${who === null ? '' : who === snap.seat ? ' mine' : ' theirs'}`);
      initials[i].textContent = who === null ? '' : snap.names[who].trim().charAt(0).toUpperCase();
      initials[i].setAttribute('class', `db-initial${who === null ? '' : who === snap.seat ? ' mine' : ' theirs'}`);
    });
  };
  const match = new TurnMatch({session, rules: dotsRules, onChange: render});
  render(match.snapshot());

  return {destroy() { match.destroy(); container.replaceChildren(); }};
}
