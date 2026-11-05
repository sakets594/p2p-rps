// Connect Four as a room game: TurnMatch with the rules in rules.js. Tap a column to drop a disc.

import {loadCss} from '../../load-css.js';
import {TurnMatch} from '../turn-match.js';
import {HEADER, ownerClass, renderTurnHeader} from '../turn-ui.js';
import {COLS, ROWS, connectFourRules} from './rules.js';

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
      });
      b.disabled = !snap.myTurn || grid[0][c] !== null || !!snap.over;
    });
  };
  const match = new TurnMatch({session, rules: connectFourRules, onChange: render});
  render(match.snapshot());

  return {destroy() { match.destroy(); container.replaceChildren(); }};
}
