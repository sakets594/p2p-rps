// Rock Paper Scissors screen: turns match state into DOM and hand animation.
// Mounted into a container the room provides; destroy() leaves it empty.

import {HandStageTube} from './hands-tube.js';

const REVEAL_FAILSAFE_MS = 5_000;

const TEMPLATE = `
<div class="rps">
  <div class="score" aria-live="polite">
    <div><span class="n score-win">0</span><span class="muted small who me label-me">You</span></div>
    <div><span class="n score-draw">0</span><span class="muted small">Draws</span></div>
    <div><span class="n score-lose">0</span><span class="muted small who them label-them">Friend</span></div>
  </div>
  <p class="muted small center round-label"></p>
  <h2 class="status center" aria-live="polite"></h2>
  <div class="hands"></div>
  <div class="moves">
    <button class="move" data-move="rock"><span class="emoji">✊</span>Rock</button>
    <button class="move" data-move="paper"><span class="emoji">✋</span>Paper</button>
    <button class="move" data-move="scissors"><span class="emoji">✌️</span>Scissors</button>
  </div>
  <button class="primary next" hidden>Next round</button>
</div>`;

const STATUS = {
  choosing: 'Pick your move',
  committed: 'Locked in. Waiting for your friend…',
  revealing: 'Revealing…',
};
const OUTCOME = {win: ['You win! 🎉', 'win'], lose: ['You lose 😬', 'lose'], draw: ['It’s a draw', '']};

/** @returns {{update(snapshot), destroy()}} */
export function mountRpsView({container, match, myName}) {
  container.innerHTML = TEMPLATE;
  const $ = (sel) => container.querySelector(sel);
  const stage = new HandStageTube($('.hands'));
  let anim = null; // animation progress for the current round, see drive()
  let shownScores = {win: 0, lose: 0, draw: 0};
  let failsafe = null;

  $('.label-me').textContent = myName;
  for (const btn of container.querySelectorAll('.move')) {
    btn.addEventListener('click', () => match.pick(btn.dataset.move));
  }
  $('.next').addEventListener('click', () => match.nextRound());

  // Turns match state into hand animation. Called on every state change and is
  // idempotent: each step happens once per round (keyed by session + round).
  //   my pick       -> my hand rises and makes a fist
  //   friend's pick -> their hand rises and makes a fist
  //   both hashes   -> fists pump while the reveals cross the network
  //   result        -> pump finishes, both hands open at once, result shown
  function drive(s) {
    const key = `${s.session}:${s.round}`;
    if (!anim || anim.key !== key) {
      stage.reset();
      anim = {key, me: null, them: null, shaking: false, revealing: false, done: false};
    }
    const a = anim;

    if (s.phase === 'cheat') {
      if (!a.cheat) { a.cheat = true; stage.reset(); }
      return;
    }

    if (s.myMove && !a.me) a.me = stage.lockIn('me');
    if (s.theirCommitted && !a.them) a.them = stage.lockIn('them');
    const locked = () => Promise.all([a.me, a.them]);

    if ((s.phase === 'revealing' || s.phase === 'result') && !a.shaking) {
      a.shaking = true;
      locked().then(() => { if (anim === a) stage.startShake(); });
    }
    if (s.phase === 'result' && !a.revealing) {
      a.revealing = true;
      // Failsafe: browsers pause animation in hidden tabs, so never let the result
      // depend on the animation finishing.
      failsafe = setTimeout(() => {
        if (anim !== a || a.done) return;
        a.done = true;
        render(match.snapshot());
      }, REVEAL_FAILSAFE_MS);
      locked().then(async () => {
        if (anim !== a) return;
        stage.startShake();
        await stage.reveal({mine: s.myMove, theirs: s.theirMove, outcome: s.outcome});
        if (anim !== a) return;
        a.done = true;
        render(match.snapshot());
      });
    }
  }

  function render(s) {
    const them = s.opponentName ?? 'Friend';
    $('.label-them').textContent = them;
    const resultVisible = s.phase === 'result' && anim?.done;
    if (s.phase !== 'result' || resultVisible) shownScores = s.scores; // no spoilers mid-animation

    $('.score-win').textContent = shownScores.win;
    $('.score-draw').textContent = shownScores.draw;
    $('.score-lose').textContent = shownScores.lose;
    $('.round-label').textContent = `Round ${s.round}`;

    const status = $('.status');
    status.className = 'status center';
    if (resultVisible) {
      const [text, cls] = OUTCOME[s.outcome];
      status.textContent = text;
      if (cls) status.classList.add(cls);
    } else if (s.phase === 'cheat') {
      status.textContent = s.error;
      status.classList.add('lose');
    } else if (s.phase === 'result') {
      status.textContent = STATUS.revealing;
    } else {
      status.textContent = s.phase === 'choosing' && s.theirCommitted
        ? `${them} has locked in. Your move!`
        : s.phase === 'committed' ? `Locked in. Waiting for ${them}…` : STATUS[s.phase];
    }

    for (const btn of container.querySelectorAll('.move')) {
      btn.disabled = s.phase !== 'choosing';
      btn.classList.toggle('selected', btn.dataset.move === s.myMove);
    }
    $('.moves').hidden = s.phase !== 'choosing';
    $('.next').hidden = !(resultVisible || s.phase === 'cheat');
  }

  return {
    update(s) { drive(s); render(s); },
    destroy() {
      anim = null; // pending animation callbacks check this and stop
      clearTimeout(failsafe);
      stage.reset();
      container.replaceChildren();
    },
  };
}
