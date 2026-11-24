// Battleship as a room game. Place (shuffle) your fleet and lock it in, then take turns firing at the
// other grid. See match.js for how hidden fleets stay honest.

import {loadCss} from '../../load-css.js';
import {BattleshipMatch} from './match.js';
import {SIZE, cellsOf, keyOf} from './rules.js';
import {burstAt, floatText, ringAt, screenFlash, shake, vibrate} from '../../fx.js';

const TEMPLATE = `
<div class="bs">
  <p class="bs-status" aria-live="polite"></p>
  <p class="bs-error" hidden></p>
  <div class="bs-actions bs-place">
    <button class="bs-shuffle">🔀 Shuffle</button>
    <button class="primary bs-ready">Lock in fleet</button>
  </div>
  <div class="bs-enemy-wrap"><h3 class="bs-enemy-title"></h3><div class="bs-grid bs-enemy"></div></div>
  <div><h3>Your fleet</h3><div class="bs-grid small bs-mine"></div></div>
</div>`;

function buildGrid(el, tag, onClick) {
  const cells = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const b = document.createElement(tag);
      b.className = 'bs-cell';
      if (onClick) {
        b.dataset.cell = `${r},${c}`;
        b.setAttribute('aria-label', `Row ${r + 1}, column ${c + 1}`);
        b.addEventListener('click', () => onClick(r, c));
      }
      el.append(b);
      cells.push(b);
    }
  }
  return cells;
}

export async function createGame({session, container}) {
  await loadCss(new URL('./battleship.css', import.meta.url));
  container.innerHTML = TEMPLATE;
  const $ = (s) => container.querySelector(s);
  const enemy = buildGrid($('.bs-enemy'), 'button', (r, c) => match.fire(r, c));
  const mine = buildGrid($('.bs-mine'), 'div', null);
  $('.bs-shuffle').addEventListener('click', () => match.shuffle());
  $('.bs-ready').addEventListener('click', () => match.ready());

  let seenShots = null; // keys of shots already drawn on each grid, so only a new one gets an effect
  let seenIncoming = null;
  const render = (s) => {
    const them = s.opponentName;
    const status = $('.bs-status');
    status.className = 'bs-status';
    if (s.phase === 'placing') status.textContent = 'Shuffle until you like your fleet, then lock it in';
    else if (s.phase === 'waiting') status.textContent = `Fleet locked in. Waiting for ${them}…`;
    else if (s.phase === 'battle') status.textContent = s.pending ? 'Fire!…' : s.myTurn ? 'Your shot: tap their waters' : `${them} is aiming…`;
    else if (s.won) { status.textContent = 'You sank their fleet! 🎉'; status.classList.add('win'); }
    else { status.textContent = `${them} sank your fleet 😬`; status.classList.add('lose'); }
    const err = $('.bs-error');
    err.hidden = !s.error;
    err.textContent = s.error ?? '';

    $('.bs-place').hidden = s.phase !== 'placing';
    $('.bs-enemy-wrap').hidden = s.phase === 'placing' || s.phase === 'waiting';
    $('.bs-enemy-title').textContent = `${them}’s waters${s.sunkByMe.length ? ` · ${s.sunkByMe.length} of 5 ships sunk` : ''}`;

    const shotMap = new Map(s.shots.map((x) => [keyOf(x.r, x.c), x]));
    const enemyShip = new Set((s.theirFleet ?? []).flatMap((sh) => cellsOf(sh).map(([r, c]) => keyOf(r, c))));
    enemy.forEach((b, i) => {
      const r = Math.floor(i / SIZE), c = i % SIZE, k = keyOf(r, c);
      const shot = shotMap.get(k);
      const pending = s.pending && s.pending.r === r && s.pending.c === c;
      b.className = `bs-cell${shot ? (shot.hit ? ' hit' : ' miss') : ''}${pending ? ' pending' : ''}${!shot && enemyShip.has(k) ? ' unhit' : ''}`;
      b.disabled = !s.myTurn || !!shot;
      if (shot && seenShots && !seenShots.has(k)) {
        if (!shot.hit) { burstAt(b, 'splash'); ringAt(b, '#bfe6ff', {count: 3}); vibrate('tap'); }
        else if (!shot.sunk) { burstAt(b, 'boom'); ringAt(b, '#ff9500', {count: 2}); shake($('.bs-enemy'), 0.4); vibrate('tap'); }
        else { // a ship went down: big blast, smoke, a banner over the water
          burstAt(b, 'bigBoom'); burstAt(b, 'smoke'); ringAt(b, '#ffcc00', {count: 3, size: 1.6});
          shake($('.bs-enemy'), 1); screenFlash('#ff9500', 0.35, 500);
          floatText($('.bs-enemy'), 'SHIP SUNK!', {color: '#ffcc00', size: 34});
          vibrate('bigHit');
        }
      }
    });
    seenShots = new Set(s.shots.map((x) => keyOf(x.r, x.c)));

    const ship = new Set(s.fleet.flatMap((sh) => cellsOf(sh).map(([r, c]) => keyOf(r, c))));
    const incoming = new Map(s.incoming.map((x) => [keyOf(x.r, x.c), x]));
    mine.forEach((d, i) => {
      const k = keyOf(Math.floor(i / SIZE), i % SIZE);
      const inc = incoming.get(k);
      d.className = `bs-cell${ship.has(k) ? ' ship' : ''}${inc ? (inc.hit ? ' hit' : ' miss') : ''}`;
      if (inc && seenIncoming && !seenIncoming.has(k)) {
        burstAt(d, inc.hit ? 'boom' : 'splash');
        ringAt(d, inc.hit ? '#ff3b30' : '#bfe6ff', {count: inc.hit ? 2 : 3});
        if (inc.hit) { burstAt(d, 'smoke'); shake($('.bs-mine'), 0.6); screenFlash('#ff2d2d', 0.4, 450); vibrate('hit'); }
      }
    });
    seenIncoming = new Set(s.incoming.map((x) => keyOf(x.r, x.c)));
  };

  const match = new BattleshipMatch({session, onChange: render});
  render(match.snapshot());

  return {destroy() { match.destroy(); container.replaceChildren(); }};
}
