// Connect Four as a room game: TurnMatch with the rules in rules.js. Tap a column to drop a disc.

import {loadCss} from '../../load-css.js';
import {TurnMatch} from '../turn-match.js';
import {HEADER, ownerClass, renderTurnHeader} from '../turn-ui.js';
import {COLS, ROWS, connectFourRules} from './rules.js';
import {burstAt, playerColors, ringAt, shake, vibrate} from '../../fx.js';

export async function createGame({session, container}) {
  await loadCss(new URL('../board.css', import.meta.url));
  container.innerHTML = `<div class="tg">${HEADER}<div class="c4-board"></div></div>`;
  const boardEl = container.querySelector('.c4-board');
  const cols = Array.from({length: COLS}, (_, c) => {
    const b = document.createElement('button');
    b.className = 'c4-col';
    b.dataset.col = c;
    b.setAttribute('aria-label', `Column ${c + 1}`);
    b.addEventListener('click', () => match.play(c));
    const discs = Array.from({length: ROWS}, () => {
      const d = document.createElement('span');
      d.className = 'c4-disc';
      b.append(d);
      return d;
    });
    boardEl.append(b);
    return {b, discs};
  });

  let lastMoves = -1;
  let wonShown = false;
  const render = (snap) => {
    renderTurnHeader(container, snap);
    const {grid, line, last} = snap.state;
    const fresh = snap.moves !== lastMoves;
    lastMoves = snap.moves;
    cols.forEach(({b, discs}, c) => {
      discs.forEach((d, r) => {
        const isLine = line?.some(([lr, lc]) => lr === r && lc === c);
        const isLast = fresh && last && last[0] === r && last[1] === c;
        d.className = `c4-disc ${ownerClass(grid[r][c], snap)}${isLine ? ' line' : ''}${isLast ? ' last' : ''}`;
        if (isLine) d.style.setProperty('--i', String(line.findIndex(([lr, lc]) => lr === r && lc === c)));
        if (isLast) {
          d.style.setProperty('--drop', `calc(-109% * ${r + 1})`);
          const mine = grid[r][c] === snap.seat;
          setTimeout(() => { // it lands at about 55% of the drop
            const color = playerColors()[mine ? 0 : 1];
            burstAt(d, 'pop', [color]);
            ringAt(d, '#ffffff', {size: 0.8});
            boardEl.animate([{transform: 'translateY(0)'}, {transform: 'translateY(4px)'}, {transform: 'translateY(0)'}], {duration: 220, easing: 'ease-out'});
            if (!mine) vibrate('tap');
          }, 385);
        }
      });
      b.disabled = !snap.myTurn || grid[0][c] !== null || !!snap.over;
    });
    if (line && !wonShown) { // the four light up one after another once the last disc has landed
      wonShown = true;
      line.forEach(([lr, lc], k) => setTimeout(() => { burstAt(cols[lc].discs[lr], 'sparkle'); ringAt(cols[lc].discs[lr], '#ffe27a'); }, 750 + k * 110));
      setTimeout(() => shake(boardEl, 0.5), 750);
    }
  };
  const match = new TurnMatch({session, rules: connectFourRules, onChange: render});
  render(match.snapshot());

  return {destroy() { match.destroy(); container.replaceChildren(); }};
}
