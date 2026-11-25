// Tic-Tac-Toe as a room game: TurnMatch with the rules in rules.js and a 3x3 grid of buttons, drawn as a chalkboard:
// the grid is chalked in when the game opens, each X and O is written stroke by stroke with a puff of chalk dust, and
// the winning line is struck through. Look: ttt.css.

import {bake} from '../../bake.js';
import {loadCss} from '../../load-css.js';
import {TurnMatch} from '../turn-match.js';
import {HEADER, introduce, ownerClass, renderTurnHeader} from '../turn-ui.js';
import {tttRules} from './rules.js';
import {burstAt, vibrate} from '../../fx.js';
import {play} from '../../sound.js';
import {synth} from '../../synth.js';
import {gsap, quake} from '../../juice.js';

const X = '<svg class="ttt-mark DRAW" viewBox="0 0 100 100" aria-hidden="true"><path pathLength="1" d="M26 23 Q50 48 76 77"/><path pathLength="1" d="M75 24 Q48 52 24 76"/></svg>';
const O = '<svg class="ttt-mark DRAW" viewBox="0 0 100 100" aria-hidden="true"><path pathLength="1" d="M50 22 C72 22 79 40 78 52 C77 70 62 79 49 78 C31 77 22 63 22 49 C23 34 34 23 53 25"/></svg>';
const CHALK = ['#ffb3c6', '#a8dcff']; // seat A, seat B: X is always seat A

export async function createGame({session, container}) {
  await loadCss(new URL('../board.css', import.meta.url));
  await loadCss(new URL('./ttt.css', import.meta.url));
  container.innerHTML = `<div class="tg">${HEADER}<div class="ttt-slate"><div class="ttt-board"></div>
    <svg class="ttt-grid" viewBox="0 0 300 300" aria-hidden="true">
      <path pathLength="1" d="M101 12 Q99 150 102 288"/><path pathLength="1" d="M199 10 Q202 150 198 290"/>
      <path pathLength="1" d="M12 100 Q150 103 288 99"/><path pathLength="1" d="M10 201 Q150 197 290 202"/>
    </svg><div class="ttt-tray"><i></i><i></i></div></div>
    <svg width="0" height="0" style="position:absolute"><filter id="ttt-chalk"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="4"/></filter></svg></div>`;
  const root = container.querySelector('.tg');
  const unbake = bake(container.querySelector('.ttt-slate')); // paint the rich backgrounds once (js/bake.js)
  const boardEl = container.querySelector('.ttt-board');
  const cells = Array.from({length: 9}, (_, i) => {
    const b = document.createElement('button');
    b.className = 'ttt-cell';
    b.dataset.cell = i;
    b.setAttribute('aria-label', `Cell ${i + 1}`);
    b.addEventListener('click', () => { synth.unlock(); match.play(i); });
    boardEl.append(b);
    return b;
  });

  let seen = null; // the board as last drawn, to spot the cell that just changed
  let strike = null; // the slash drawn through a winning line
  const slash = (line) => {
    const box = boardEl.getBoundingClientRect();
    const [a, b] = [cells[line[0]], cells[line[2]]].map((c) => { const r = c.getBoundingClientRect(); return [r.left - box.left + r.width / 2, r.top - box.top + r.height / 2]; });
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]], len = Math.hypot(dx, dy) || 1, pad = 30;
    const [ux, uy] = [(dx / len) * pad, (dy / len) * pad];
    strike = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    strike.setAttribute('class', 'ttt-strike');
    strike.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    strike.innerHTML = `<line pathLength="1" x1="${a[0] - ux}" y1="${a[1] - uy}" x2="${b[0] + ux}" y2="${b[1] + uy}"/>`;
    boardEl.append(strike);
    setTimeout(() => { synth.whoosh(0.4); quake(container.querySelector('.ttt-slate'), 0.6); }, 200);
    line.forEach((c, k) => setTimeout(() => {
      burstAt(cells[c], 'sparkle', ['#fffbe8', '#ffe27a']);
      gsap.fromTo(cells[c].querySelector('svg'), {scale: 1}, {scale: 1.25, duration: 0.18, yoyo: true, repeat: 1, ease: 'power2.out'});
    }, 300 + k * 160));
  };
  const render = (snap) => {
    renderTurnHeader(container, snap);
    cells.forEach((b, i) => {
      const owner = snap.state.board[i];
      const fresh = seen && seen[i] === null && owner !== null;
      if (!seen || seen[i] !== owner) {
        // marks already on the board (a rejoin) are drawn at once; a new one is chalked stroke by stroke
        b.innerHTML = owner === null ? '' : (owner === 0 ? X : O).replace('DRAW', fresh ? 'draw' : '');
        b.style.setProperty('--chalk', owner === null ? '' : CHALK[owner]);
        b.setAttribute('aria-label', `Cell ${i + 1}${owner === null ? '' : owner === 0 ? ', X' : ', O'}`);
      }
      b.className = `ttt-cell ${owner === null ? '' : `s${owner} `}${ownerClass(owner, snap)}${fresh ? ' fresh' : ''}${snap.state.line?.includes(i) ? ' line' : ''}${snap.myTurn && owner === null ? ' canplay' : ''}`;
      b.disabled = !snap.myTurn || owner !== null || !!snap.over;
      if (fresh) {
        synth.whoosh(0.16);
        setTimeout(() => synth.whoosh(0.14), owner === 0 ? 200 : 0);
        setTimeout(() => burstAt(b, 'pop', ['#ffffff', CHALK[owner]]), 220);
        if (owner !== snap.seat) vibrate('tap');
        if (!snap.over) play(owner === snap.seat ? 'board.my_move' : 'board.their_move'); // the last move gets the result sound only
      }
    });
    seen = [...snap.state.board];
    if (snap.state.line && !strike) slash(snap.state.line);
    if (snap.over && snap.over.winner === null && !root.classList.contains('drawn')) {
      root.classList.add('drawn'); // a draw: the board gets a tired little wobble
      quake(container.querySelector('.ttt-slate'), 0.4);
    }
  };
  const match = new TurnMatch({session, rules: tttRules, onChange: render});
  render(match.snapshot());
  introduce(root, {theme: 'chalk', title: 'Tic-Tac-Toe', kicker: 'Chalk it up', sub: 'Three in a row wins', card: 'marker'});

  return {destroy() { unbake(); gsap.killTweensOf(container.querySelectorAll('*')); match.destroy(); container.replaceChildren(); }};
}
