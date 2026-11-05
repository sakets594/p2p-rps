// Tic-Tac-Toe as a room game: TurnMatch with the rules in rules.js and a 3x3 grid of buttons.

import {loadCss} from '../../load-css.js';
import {TurnMatch} from '../turn-match.js';
import {HEADER, ownerClass, renderTurnHeader} from '../turn-ui.js';
import {tttRules} from './rules.js';

export async function createGame({session, container}) {
  await loadCss(new URL('../board.css', import.meta.url));
  container.innerHTML = `<div class="tg">${HEADER}<div class="ttt-board"></div></div>`;
  const boardEl = container.querySelector('.ttt-board');
  const cells = Array.from({length: 9}, (_, i) => {
    const b = document.createElement('button');
    b.className = 'ttt-cell';
    b.dataset.cell = i;
    b.setAttribute('aria-label', `Cell ${i + 1}`);
    b.addEventListener('click', () => match.play(i));
    boardEl.append(b);
    return b;
  });

  const render = (snap) => {
    renderTurnHeader(container, snap);
    cells.forEach((b, i) => {
      const owner = snap.state.board[i];
      b.textContent = owner === null ? '' : owner === 0 ? '✕' : '◯';
      b.className = `ttt-cell ${ownerClass(owner, snap)}${snap.state.line?.includes(i) ? ' line' : ''}${snap.myTurn && owner === null ? ' canplay' : ''}`;
      b.disabled = !snap.myTurn || owner !== null || !!snap.over;
    });
  };
  const match = new TurnMatch({session, rules: tttRules, onChange: render});
  render(match.snapshot());

  return {destroy() { match.destroy(); container.replaceChildren(); }};
}
