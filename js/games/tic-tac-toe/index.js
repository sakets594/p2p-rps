// Tic-Tac-Toe as a room game: TurnMatch with the rules in rules.js and a 3x3 grid of buttons.

import {loadCss} from '../../load-css.js';
import {TurnMatch} from '../turn-match.js';
import {HEADER, ownerClass, renderTurnHeader} from '../turn-ui.js';
import {tttRules} from './rules.js';
import {burstAt, playerColors, ringAt, vibrate} from '../../fx.js';

const X = '<svg class="ttt-mark DRAW" viewBox="0 0 100 100" aria-hidden="true"><path pathLength="1" d="M24 24 L76 76"/><path pathLength="1" d="M76 24 L24 76"/></svg>';
const O = '<svg class="ttt-mark DRAW" viewBox="0 0 100 100" aria-hidden="true"><circle pathLength="1" cx="50" cy="50" r="28"/></svg>';

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

  let seen = null; // the board as last drawn, to spot the cell that just changed
  let strike = null; // the slash drawn through a winning line
  const slash = (line) => {
    const box = boardEl.getBoundingClientRect();
    const [a, b] = [cells[line[0]], cells[line[2]]].map((c) => { const r = c.getBoundingClientRect(); return [r.left - box.left + r.width / 2, r.top - box.top + r.height / 2]; });
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]], len = Math.hypot(dx, dy) || 1, pad = 26;
    const [ux, uy] = [(dx / len) * pad, (dy / len) * pad];
    strike = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    strike.setAttribute('class', 'ttt-strike');
    strike.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    strike.innerHTML = `<line pathLength="1" x1="${a[0] - ux}" y1="${a[1] - uy}" x2="${b[0] + ux}" y2="${b[1] + uy}"/>`;
    boardEl.append(strike);
    line.forEach((c, k) => setTimeout(() => { burstAt(cells[c], 'sparkle'); ringAt(cells[c], '#ffd84a'); }, 180 + k * 160));
  };
  const render = (snap) => {
    renderTurnHeader(container, snap);
    const colors = playerColors();
    cells.forEach((b, i) => {
      const owner = snap.state.board[i];
      const fresh = seen && seen[i] === null && owner !== null;
      if (!seen || seen[i] !== owner) {
        // marks already on the board (a rejoin) are drawn at once; a new one draws itself stroke by stroke
        b.innerHTML = owner === null ? '' : (owner === 0 ? X : O).replace('DRAW', fresh ? 'draw' : '');
        b.setAttribute('aria-label', `Cell ${i + 1}${owner === null ? '' : owner === 0 ? ', X' : ', O'}`);
      }
      b.className = `ttt-cell ${ownerClass(owner, snap)}${fresh ? ' fresh' : ''}${snap.state.line?.includes(i) ? ' line' : ''}${snap.myTurn && owner === null ? ' canplay' : ''}`;
      b.disabled = !snap.myTurn || owner !== null || !!snap.over;
      if (fresh) {
        burstAt(b, 'pop', [colors[owner === snap.seat ? 0 : 1]]);
        ringAt(b, colors[owner === snap.seat ? 0 : 1]);
        if (owner !== snap.seat) vibrate('tap');
      }
    });
    seen = [...snap.state.board];
    if (snap.state.line && !strike) slash(snap.state.line);
  };
  const match = new TurnMatch({session, rules: tttRules, onChange: render});
  render(match.snapshot());

  return {destroy() { match.destroy(); container.replaceChildren(); }};
}
