// Connect Four as a room game: TurnMatch with the rules in rules.js. Tap a column to drop a disc.

import {bake} from '../../bake.js';
import {loadCss} from '../../load-css.js';
import {TurnMatch} from '../turn-match.js';
import {HEADER, introduce, renderTurnHeader} from '../turn-ui.js';
import {COLS, ROWS, connectFourRules} from './rules.js';
import {burstAt, ringAt, seatColors, shake, vibrate} from '../../fx.js';
import {play} from '../../sound.js';
import {synth} from '../../synth.js';
import {gsap} from '../../juice.js';

export async function createGame({session, container}) {
  await loadCss(new URL('../board.css', import.meta.url));
  await loadCss(new URL('./c4.css', import.meta.url));
  container.innerHTML = `<div class="tg">${HEADER}<div class="c4-rig"><div class="c4-rail"><span class="c4-ghost"><i></i></span></div><div class="c4-board"></div><svg class="c4-win" aria-hidden="true"></svg><div class="c4-legs"><i></i><i></i></div></div></div>`;
  const root = container.querySelector('.tg');
  const boardEl = container.querySelector('.c4-board');
  const ghost = container.querySelector('.c4-ghost');
  let lastSnap = null;
  // A ghost disc rides the rail above the columns, following the pointer, so you see where yours will drop.
  const aimAt = (c) => {
    if (!lastSnap?.myTurn || lastSnap.over) { ghost.classList.remove('on'); return; }
    const col = cols[c].b.getBoundingClientRect();
    const rail = ghost.parentElement.getBoundingClientRect();
    ghost.classList.add('on');
    ghost.dataset.seat = String(lastSnap.seat);
    gsap.to(ghost, {x: col.left - rail.left + col.width / 2, duration: 0.18, ease: 'power3.out'});
  };
  const cols = Array.from({length: COLS}, (_, c) => {
    const b = document.createElement('button');
    b.className = 'c4-col';
    b.dataset.col = c;
    b.setAttribute('aria-label', `Column ${c + 1}`);
    b.addEventListener('click', () => { synth.unlock(); ghost.classList.remove('on'); match.play(c); });
    b.addEventListener('pointerenter', () => aimAt(c));
    const discs = Array.from({length: ROWS}, () => {
      const hole = document.createElement('span'); // the hole stays put while the disc moves
      hole.className = 'c4-hole';
      const d = document.createElement('span');
      d.className = 'c4-disc';
      hole.append(d);
      b.append(hole);
      return d;
    });
    boardEl.append(b);
    return {b, discs};
  });

  let lastMoves = -1;
  let wonShown = false;
  boardEl.addEventListener('pointerleave', () => ghost.classList.remove('on'));
  const render = (snap) => {
    lastSnap = snap;
    if (!snap.myTurn || snap.over) ghost.classList.remove('on');
    renderTurnHeader(container, snap);
    const {grid, line, last} = snap.state;
    const fresh = snap.moves !== lastMoves;
    lastMoves = snap.moves;
    cols.forEach(({b, discs}, c) => {
      discs.forEach((d, r) => {
        const isLine = line?.some(([lr, lc]) => lr === r && lc === c);
        const isLast = fresh && last && last[0] === r && last[1] === c;
        d.className = `c4-disc${grid[r][c] === null ? '' : ` seat-${grid[r][c]}`}${isLine ? ' line' : ''}${isLast ? ' last' : ''}`;
        if (isLine) d.style.setProperty('--i', String(line.findIndex(([lr, lc]) => lr === r && lc === c)));
        if (isLast) {
          d.style.setProperty('--drop', `calc(-109% * ${r + 1})`);
          const mine = grid[r][c] === snap.seat;
          setTimeout(() => { // it lands at about 55% of the drop
            const color = seatColors(boardEl)[grid[r][c]];
            burstAt(d, 'pop', [color]);
            ringAt(d, '#ffffff', {size: 0.8});
            boardEl.animate([{transform: 'translateY(0)'}, {transform: 'translateY(4px)'}, {transform: 'translateY(0)'}], {duration: 220, easing: 'ease-out'});
            synth.thud();
            if (!mine) vibrate('tap');
            if (!snap.over) play(mine ? 'board.my_move' : 'board.their_move');
          }, 385);
        }
      });
      b.disabled = !snap.myTurn || grid[0][c] !== null || !!snap.over;
    });
    if (line && !wonShown) { // the four light up one after another once the last disc has landed
      wonShown = true;
      line.forEach(([lr, lc], k) => setTimeout(() => { burstAt(cols[lc].discs[lr], 'sparkle'); ringAt(cols[lc].discs[lr], '#ffe27a'); }, 750 + k * 110));
      setTimeout(() => shake(boardEl, 0.5), 750);
      setTimeout(() => winLine(line), 700);
    }
  };
  /** A glowing stroke through the four winning discs, drawn from end to end. */
  function winLine(line) {
    const svg = container.querySelector('.c4-win');
    if (!svg) return; // left the game before the line was drawn
    const box = svg.getBoundingClientRect();
    const pts = [line[0], line[line.length - 1]].map(([r, c]) => {
      const d = cols[c].discs[r].parentElement.getBoundingClientRect();
      return [d.left - box.left + d.width / 2, d.top - box.top + d.height / 2];
    });
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    svg.innerHTML = `<line pathLength="1" x1="${pts[0][0]}" y1="${pts[0][1]}" x2="${pts[1][0]}" y2="${pts[1][1]}"/>`;
    synth.whoosh(0.4);
  }

  const match = new TurnMatch({session, rules: connectFourRules, onChange: render});
  render(match.snapshot());
  introduce(root, {theme: 'toy', title: 'Connect Four', kicker: 'Drop it like it’s hot', sub: 'Four in a row wins', card: 'stage'});
  const unbake = bake(container.querySelector('.c4-board')); // paint the rich backgrounds once (js/bake.js)

  return {destroy() { unbake(); match.destroy(); container.replaceChildren(); }};
}
