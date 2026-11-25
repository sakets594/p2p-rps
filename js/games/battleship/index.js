// Battleship as a room game. Place (shuffle) your fleet and lock it in, then take turns firing at the
// other grid. See match.js for how hidden fleets stay honest.
// The look is a naval war room: their waters are a radar screen with a sweeping beam, your fleet sits on a rolling
// sea as real hulls; every shot is a shell that whistles in before the splash or the blast, hits keep burning.

import {bake} from '../../bake.js';
import {loadCss} from '../../load-css.js';
import {BattleshipMatch} from './match.js';
import {SHIPS, SIZE, cellsOf, keyOf} from './rules.js';
import {burstAt, fxForScenario, ringAt, screenFlash, shake, vibrate} from '../../fx.js';
import {play} from '../../sound.js';
import {synth} from '../../synth.js';
import {calm, enter, gsap, stamp, titleCard} from '../../juice.js';

const LETTERS = 'ABCDEFGHIJ';
const FLIGHT_MS = 560;

const TEMPLATE = `
<div class="bs navy">
  <div class="bs-hud">
    <div class="bs-fleet me"><b class="bs-name-me"></b><span class="bs-ships bs-ships-me"></span></div>
    <div class="bs-vs">⚓</div>
    <div class="bs-fleet them"><b class="bs-name-them"></b><span class="bs-ships bs-ships-them"></span></div>
  </div>
  <p class="bs-status" aria-live="polite"></p>
  <p class="bs-error" hidden></p>
  <div class="bs-actions bs-place">
    <button class="bs-shuffle">🔀 Shuffle</button>
    <button class="bs-ready">⚓ Lock in fleet</button>
  </div>
  <div class="bs-enemy-wrap"><h3 class="bs-enemy-title"></h3>
    <div class="bs-radar"><div class="bs-sweep"></div><div class="bs-grid bs-enemy"></div></div>
  </div>
  <div class="bs-mine-wrap"><h3>Your fleet</h3><div class="bs-sea"><div class="bs-waves"></div><div class="bs-grid small bs-mine"></div></div></div>
  <div class="bs-shells"></div>
</div>`;

function buildGrid(el, tag, onClick) {
  const cells = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const b = document.createElement(tag);
      b.className = 'bs-cell';
      if (onClick) {
        b.dataset.cell = `${r},${c}`;
        b.setAttribute('aria-label', `${LETTERS[r]}${c + 1}`);
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
  const unbake = bake(container.querySelector('.bs'), container.querySelector('.bs-sweep'), container.querySelector('.bs-waves'), container.querySelector('.bs-enemy')); // paint the rich backgrounds once (js/bake.js)
  const $ = (s) => container.querySelector(s);
  const root = $('.bs');
  const landAt = new Map();   // "e:r,c" / "m:r,c" -> when the shell in flight lands
  const enemy = buildGrid($('.bs-enemy'), 'button', (r, c) => {
    synth.unlock();
    if (match.fire(r, c) !== false) launch('e', r, c);
  });
  const mine = buildGrid($('.bs-mine'), 'div', null);
  $('.bs-shuffle').addEventListener('click', () => { synth.unlock(); synth.whoosh(0.3); match.shuffle(); });
  $('.bs-ready').addEventListener('click', () => { synth.unlock(); synth.thud(); match.ready(); });

  /** A shell arcs from the bottom of the screen (mine) or the top (theirs) to the target cell. */
  function launch(side, r, c) {
    const key = `${side}:${keyOf(r, c)}`;
    if (landAt.has(key)) return;
    landAt.set(key, performance.now() + FLIGHT_MS);
    synth.incoming(FLIGHT_MS / 1000);
    const target = (side === 'e' ? enemy : mine)[r * SIZE + c];
    target.classList.add('flying');
    setTimeout(() => target.classList.remove('flying'), FLIGHT_MS);
    if (calm()) return;
    const host = $('.bs-shells').getBoundingClientRect();
    const t = target.getBoundingClientRect();
    const shell = document.createElement('i');
    shell.className = `bs-shell ${side === 'e' ? 'out' : 'in'}`;
    $('.bs-shells').append(shell);
    const x1 = t.left - host.left + t.width / 2;
    const y1 = t.top - host.top + t.height / 2;
    const x0 = side === 'e' ? host.width / 2 : x1 + 60;
    const y0 = side === 'e' ? host.height + 30 : y1 - 220;
    const peak = Math.min(y0, y1) - 90;
    const o = {t: 0};
    gsap.to(o, {t: 1, duration: FLIGHT_MS / 1000, ease: 'power1.in', onUpdate: () => {
      const k = o.t;
      const x = x0 + (x1 - x0) * k;
      const y = (1 - k) ** 2 * y0 + 2 * (1 - k) * k * peak + k * k * y1;
      gsap.set(shell, {x, y, rotate: Math.atan2(y1 - y0, x1 - x0) * 57, scale: 1.4 - k * 0.6});
    }, onComplete: () => shell.remove()});
    if (side === 'm') {
      const mark = document.createElement('i');
      mark.className = 'bs-target';
      target.append(mark);
      setTimeout(() => mark.remove(), FLIGHT_MS);
    }
  }
  /** Run `fn` when the shell for this cell lands (at once if none is in flight). */
  const onLanding = (key, fn) => {
    const wait = (landAt.get(key) ?? 0) - performance.now();
    if (wait > 0) setTimeout(fn, wait); else fn();
  };

  let seenShots = null; // keys of shots already drawn on each grid, so only a new one gets an effect
  let seenIncoming = null;
  let seenPhase = null;
  let seenFleet = '';
  let last = null;
  const render = (s) => {
    last = s;
    $('.bs-place').hidden = s.phase !== 'placing';
    $('.bs-enemy-wrap').hidden = s.phase === 'placing' || s.phase === 'waiting';
    root.classList.toggle('my-turn', s.phase === 'battle' && s.myTurn && !s.pending);

    const shotMap = new Map(s.shots.map((x) => [keyOf(x.r, x.c), x]));
    const enemyShip = new Set((s.theirFleet ?? []).flatMap((sh) => cellsOf(sh).map(([r, c]) => keyOf(r, c))));
    enemy.forEach((b, i) => {
      const r = Math.floor(i / SIZE), c = i % SIZE, k = keyOf(r, c);
      const shot = shotMap.get(k);
      const pending = s.pending && s.pending.r === r && s.pending.c === c;
      const flying = b.classList.contains('flying');
      b.className = `bs-cell${shot ? (shot.hit ? ' hit' : ' miss') : ''}${pending ? ' pending' : ''}${!shot && enemyShip.has(k) ? ' unhit' : ''}${flying ? ' flying' : ''}`;
      b.disabled = !s.myTurn || !!shot;
      if (shot && seenShots && !seenShots.has(k)) {
        onLanding(`e:${k}`, () => {
          if (!shot.hit) { burstAt(b, 'splash'); ringAt(b, '#bfe6ff', {count: 3}); synth.splash(); vibrate('tap'); play('bs.my_miss'); }
          else if (!shot.sunk) { burstAt(b, 'boom'); ringAt(b, '#ff9500', {count: 2}); synth.boom(); shake($('.bs-radar'), 0.4); vibrate('tap'); play('bs.my_hit'); }
          else { // a ship went down: big blast, smoke, a stamp over the radar
            burstAt(b, 'bigBoom'); burstAt(b, 'smoke'); ringAt(b, '#ffcc00', {count: 3, size: 1.6});
            synth.boom(); setTimeout(() => synth.boom(), 160);
            shake($('.bs-radar'), 1); screenFlash('#ff9500', 0.35, 500);
            stamp($('.bs-radar'), 'Sunk!', {cls: 'gold', rotate: -10, life: 1.4});
            vibrate('bigHit');
            if (s.phase !== 'over') play('bs.my_sunk'); // sinking the last ship is the win: the result sound covers it
          }
        });
      }
    });
    seenShots = new Set(s.shots.map((x) => keyOf(x.r, x.c)));

    const ship = new Map();
    s.fleet.forEach((sh) => cellsOf(sh).forEach(([r, c], i, all) => ship.set(keyOf(r, c), `${sh.h ? 'h' : 'v'}${i === 0 ? ' bow' : i === all.length - 1 ? ' stern' : ''}`)));
    const incoming = new Map(s.incoming.map((x) => [keyOf(x.r, x.c), x]));
    mine.forEach((d, i) => {
      const r = Math.floor(i / SIZE), c = i % SIZE, k = keyOf(r, c);
      const inc = incoming.get(k);
      const newIn = inc && seenIncoming && !seenIncoming.has(k);
      if (newIn) launch('m', r, c);
      const flying = d.classList.contains('flying');
      d.className = `bs-cell${ship.has(k) ? ` ship ${ship.get(k)}` : ''}${inc ? (inc.hit ? ' hit' : ' miss') : ''}${flying || newIn ? ' flying' : ''}`;
      if (newIn) {
        onLanding(`m:${k}`, () => {
          burstAt(d, inc.hit ? 'boom' : 'splash');
          ringAt(d, inc.hit ? '#ff3b30' : '#bfe6ff', {count: inc.hit ? 2 : 3});
          if (inc.hit) { synth.boom(); burstAt(d, 'smoke'); shake($('.bs-sea'), 0.6); screenFlash('#ff2d2d', 0.4, 450); vibrate('hit'); } else synth.splash();
          const ownShip = s.fleet.find((sh) => cellsOf(sh).some(([rr, cc]) => keyOf(rr, cc) === k));
          const sunk = inc.hit && ownShip && cellsOf(ownShip).every(([rr, cc]) => incoming.get(keyOf(rr, cc))?.hit);
          if (sunk) stamp($('.bs-sea'), 'Lost a ship', {cls: 'bad', rotate: 8, life: 1.4});
          if (!inc.hit) play('bs.their_miss');
          else if (!sunk) play('bs.their_hit');
          else if (s.phase !== 'over') play('bs.their_sunk');
        });
      }
    });
    seenIncoming = new Set(s.incoming.map((x) => keyOf(x.r, x.c)));

    // A new layout from Shuffle: the ships pop into their new places one after another.
    const fleetKey = JSON.stringify(s.fleet);
    if (seenFleet && fleetKey !== seenFleet && s.phase === 'placing') enter(mine.filter((d) => d.classList.contains('ship')), {y: -10, scale: 0.4, stagger: 0.012, duration: 0.3});
    seenFleet = fleetKey;

    if (seenPhase && seenPhase !== 'battle' && s.phase === 'battle') {
      play('bs.battle_start');
      titleCard(root, {kicker: 'All hands', title: 'Battle stations!', sub: 'Sink all five ships', theme: 'neon', hold: 0.8});
    }
    if (seenPhase === 'placing' && s.phase === 'waiting') enter(mine.filter((d) => d.classList.contains('ship')), {y: 6, scale: 0.8, stagger: 0.01, duration: 0.25});
    seenPhase = s.phase;
    clearTimeout(tellTimer);
    const wait = Math.max(0, ...landAt.values()) - performance.now();
    if (wait > 0 && !s.pending) tellTimer = setTimeout(() => tell(last), wait + 60); else tell(s);
  };

  /** Words, ship counts and the result: told only once the shell in the air has landed, so nothing spoils the hit. */
  function tell(s) {
    const them = s.opponentName;
    $('.bs-name-me').textContent = s.names?.[s.seat] ?? 'You';
    $('.bs-name-them').textContent = them;
    const status = $('.bs-status');
    const before = status.textContent;
    status.className = 'bs-status';
    if (s.phase === 'placing') status.textContent = 'Shuffle until you like your fleet, then lock it in';
    else if (s.phase === 'waiting') status.textContent = `Fleet anchored. Waiting for ${them}…`;
    else if (s.phase === 'battle') status.textContent = s.pending ? 'Shell away…' : s.myTurn ? 'Your shot: pick a square on the radar' : `${them} is taking aim…`;
    else if (s.won) { status.textContent = 'You sank their fleet!'; status.classList.add('win'); }
    else { status.textContent = `${them} sank your fleet`; status.classList.add('lose'); }
    if (status.textContent !== before) enter(status, {y: 8, duration: 0.3});
    const err = $('.bs-error');
    err.hidden = !s.error;
    err.textContent = s.error ?? '';

    $('.bs-enemy-title').textContent = `${them}’s waters${s.sunkByMe.length ? ` · ${s.sunkByMe.length} of ${SHIPS.length} sunk` : ''}`;
    // Ships left afloat on each side.
    const lost = new Map(s.incoming.map((x) => [keyOf(x.r, x.c), x]));
    const lostMine = s.fleet.filter((sh) => cellsOf(sh).every(([r, c]) => lost.get(keyOf(r, c))?.hit)).length;
    ships($('.bs-ships-me'), SHIPS.length - lostMine);
    ships($('.bs-ships-them'), SHIPS.length - s.sunkByMe.length);

    if (s.phase === 'over' && !resultTold) {
      resultTold = true;
      const id = s.won ? 'game.won' : 'game.lost';
      setTimeout(() => { if (!destroyed) { play(id); fxForScenario(id)?.(); } }, 700);
    }
  }
  let resultTold = false;
  let destroyed = false;
  let tellTimer = null;

  function ships(el, n) {
    if (el.childElementCount !== SHIPS.length) el.replaceChildren(...SHIPS.map(() => document.createElement('i')));
    [...el.children].forEach((i, k) => {
      const down = k >= n;
      if (down && !i.classList.contains('down')) gsap.fromTo(i, {rotate: 0}, {rotate: 40, y: 4, duration: 0.6, ease: 'power2.in'});
      i.classList.toggle('down', down);
    });
  }

  const match = new BattleshipMatch({session, onChange: render});
  render(match.snapshot());
  enter(container.querySelectorAll('.bs-hud > *'), {y: -14, stagger: 0.08});
  titleCard(root, {kicker: 'Naval command', title: 'Battleship', sub: 'Place your fleet', theme: 'neon', hold: 0.8});

  return {destroy() { unbake(); destroyed = true; clearTimeout(tellTimer); gsap.killTweensOf(container.querySelectorAll('*')); match.destroy(); container.replaceChildren(); }};
}
