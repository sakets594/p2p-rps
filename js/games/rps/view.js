// Rock Paper Scissors screen: turns match state into DOM and hand animation.
// Mounted into a container the room provides; destroy() leaves it empty.

import {bake} from '../../bake.js';
import {HandStageTube} from './hands-tube.js';
import {play} from '../../sound.js';
import {synth} from '../../synth.js';
import {calm, countTo, enter, gsap, pop, pulse, quake, titleCard} from '../../juice.js';

const REVEAL_FAILSAFE_MS = 5_000;
const NUDGE_MS = 5_000; // friend locked in and I am still thinking: time for a "jaldi bol"

const TEMPLATE = `
<div class="rps arena">
  <div class="score" aria-live="polite">
    <div class="fighter me"><span class="who label-me">You</span><span class="n score-win">0</span></div>
    <div class="mid"><span class="round-label"></span><span class="draws"><b class="n score-draw">0</b> draws</span></div>
    <div class="fighter them"><span class="who label-them">Friend</span><span class="n score-lose">0</span></div>
  </div>
  <h2 class="status center" aria-live="polite"></h2>
  <div class="tug" aria-hidden="true"><i></i></div>
  <div class="ring"><div class="set" aria-hidden="true"><svg class="crowd" viewBox="0 0 400 70" preserveAspectRatio="xMidYMax slice">${Array.from({length: 17}, (_, i) => `<g class="fan" style="--d:${(i * 37) % 10}"><circle cx="${i * 25}" cy="${30 + (i * 7) % 9}" r="11"/><rect x="${i * 25 - 14}" y="${40 + (i * 7) % 9}" width="28" height="40" rx="10"/></g>`).join('')}</svg></div><div class="lines" aria-hidden="true"></div><div class="cam"><div class="hands"></div></div>
    <svg class="crack" viewBox="-100 -100 200 200" aria-hidden="true">${Array.from({length: 11}, (_, i) => { const a = i * 0.571 + (i % 3) * 0.12; const r = 60 + (i * 29) % 40; const m = r * 0.5; return `<path d="M0 0 L${(Math.cos(a + 0.14) * m).toFixed(0)} ${(Math.sin(a + 0.14) * m).toFixed(0)} L${(Math.cos(a) * r).toFixed(0)} ${(Math.sin(a) * r).toFixed(0)}"/>`; }).join('')}</svg><div class="ko" aria-hidden="true"></div><div class="vs" aria-hidden="true"><span>✊</span><b>VS</b><span>✊</span></div></div>
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
const ROUND_SOUND = {win: 'rps.round_won', lose: 'rps.round_lost', draw: 'rps.round_draw'};

/** @returns {{update(snapshot), destroy()}} */
export function mountRpsView({container, match, myName, seat = 0}) {
  container.innerHTML = TEMPLATE;
  const unbake = bake(container.querySelector('.rps'), container.querySelector('.ring'), container.querySelector('.set'), container.querySelector('.lines')); // paint the rich backgrounds once (js/bake.js)
  const $ = (sel) => container.querySelector(sel);
  const stage = new HandStageTube($('.hands'));
  const ring = $('.ring');
  const cam = $('.cam');
  // The wind-up: the camera leans in and speed lines rush past. The clash: it kicks back, the floor cracks, the crowd leaps.
  ring.addEventListener('rps:shoot', () => {
    synth.whoosh(0.35);
    if (calm()) return;
    gsap.fromTo($('.lines'), {opacity: 0, scale: 1.5}, {opacity: 1, scale: 1, duration: 0.3, ease: 'power3.in'});
    gsap.to(cam, {scale: 1.22, duration: 0.3, ease: 'power3.in'});
  });
  ring.addEventListener('rps:clash', (e) => {
    synth.boom();
    ring.classList.remove('roar'); void ring.offsetWidth; ring.classList.add('roar');
    const ko = $('.ko');
    ko.textContent = {win: 'K.O.!', lose: 'K.O.', draw: 'CLASH!'}[e.detail];
    ko.dataset.r = e.detail;
    if (calm()) return;
    gsap.to($('.lines'), {opacity: 0, duration: 0.25});
    gsap.fromTo(cam, {scale: 1.35}, {scale: 1, duration: 0.9, ease: 'elastic.out(1.1, .4)'});
    gsap.timeline().fromTo($('.crack'), {opacity: 1, scale: 0.2, rotate: gsap.utils.random(0, 90)}, {scale: 1.15, duration: 0.14, ease: 'power4.out'}).to($('.crack'), {opacity: 0, duration: 0.9, delay: 0.5});
    gsap.timeline({delay: 0.45}).fromTo(ko, {opacity: 1, scale: 4, rotate: -14}, {scale: 1, rotate: -7, duration: 0.3, ease: 'slam'}).add(() => quake(ring, 0.8)).to(ko, {opacity: 0, scale: 1.3, duration: 0.35, delay: 0.9});
  });
  let anim = null; // animation progress for the current round, see drive()
  let shownScores = {win: 0, lose: 0, draw: 0};
  let failsafe = null;

  $('.label-me').textContent = myName;
  $('.rps').dataset.seat = String(seat);
  $('.fighter.me').dataset.seat = String(seat); // seat colours, so both screens agree on who is red and who is blue
  $('.fighter.them').dataset.seat = String(1 - seat);
  for (const btn of container.querySelectorAll('.move')) {
    btn.addEventListener('click', () => { synth.unlock(); synth.zap(1200); pop(btn, {scale: 0.9}); match.pick(btn.dataset.move); });
  }
  $('.next').addEventListener('click', () => { synth.unlock(); match.nextRound(); });
  enter(container.querySelectorAll('.score > *'), {y: -16, stagger: 0.08});
  enter(container.querySelectorAll('.move'), {y: 30, stagger: 0.07, delay: 0.3});
  titleCard($('.rps'), {kicker: 'Fight night', title: 'Rock Paper Scissors', sub: 'Pick your move, then SHOOT!', theme: 'neon', hold: 0.8});
  let vsPulse = pulse($('.vs b'), {scale: 1.12, duration: 0.5});
  let shownRound = 0;

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
      if (!a.cheat) { a.cheat = true; stage.reset(); play('rps.cheat_detected'); }
      return;
    }

    if (s.phase === 'choosing' && s.theirCommitted && !a.nudge) {
      a.nudge = setTimeout(() => {
        if (anim === a && match.snapshot().phase === 'choosing') play('rps.friend_waiting');
      }, NUDGE_MS);
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
        play(ROUND_SOUND[s.outcome]);
        render(match.snapshot());
      }, REVEAL_FAILSAFE_MS);
      locked().then(async () => {
        if (anim !== a) return;
        stage.startShake();
        await stage.reveal({mine: s.myMove, theirs: s.theirMove, outcome: s.outcome});
        if (anim !== a || a.done) return; // the failsafe already showed (and sounded) this result
        a.done = true;
        play(ROUND_SOUND[s.outcome]);
        render(match.snapshot());
      });
    }
  }

  function render(s) {
    const them = s.opponentName ?? 'Friend';
    $('.label-them').textContent = them;
    const resultVisible = s.phase === 'result' && anim?.done;
    if (s.phase !== 'result' || resultVisible) shownScores = s.scores; // no spoilers mid-animation

    countTo($('.score-win'), shownScores.win);
    countTo($('.score-draw'), shownScores.draw);
    countTo($('.score-lose'), shownScores.lose);
    const played = shownScores.win + shownScores.lose; // the tug-of-war bar leans towards whoever is ahead
    $('.tug i').style.transform = `scaleX(${played ? 0.08 + 0.84 * (shownScores.win / played) : 0.5})`;
    $('.round-label').textContent = `Round ${s.round}`;
    if (s.round !== shownRound) { if (shownRound) { pop($('.round-label'), {scale: 1.8}); synth.whoosh(0.3); } shownRound = s.round; }
    // The VS sign holds the ring until the first hand comes up.
    const idle = s.phase === 'choosing' && !s.myMove && !s.theirCommitted;
    container.querySelector('.ring').classList.toggle('idle', idle);

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
    destroy() { unbake();
      vsPulse?.kill();
      gsap.killTweensOf(container.querySelectorAll('*'));
      clearTimeout(anim?.nudge);
      anim = null; // pending animation callbacks check this and stop
      clearTimeout(failsafe);
      stage.reset();
      container.replaceChildren();
    },
  };
}
