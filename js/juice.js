// Shared motion for game views: title cards between rounds, staggered entrances, number count-ups, rubber stamps,
// screen wipes and pops. Built on GSAP (vendor/gsap). Pure presentation, no game state. Everything respects
// prefers-reduced-motion by falling back to short fades.

import {gsap} from '../vendor/gsap/index.js';
import {SplitText} from '../vendor/gsap/SplitText.js';
import {CustomEase} from '../vendor/gsap/CustomEase.js';
import {loadCss} from './load-css.js';
import {play} from './sound.js';

gsap.registerPlugin(SplitText, CustomEase);
CustomEase.create('slam', 'M0,0 C0.12,0 0.2,1.22 0.4,1.1 0.56,1.01 0.68,0.99 1,1');
CustomEase.create('swoosh', 'M0,0 C0.7,0 0.2,1 1,1');
const cssReady = loadCss(new URL('../css/juice.css', import.meta.url));

export {gsap, SplitText};
export const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const ready = () => cssReady;
const wait = (s) => new Promise((r) => { gsap.delayedCall(s, r); });

/**
 * A title card over `host` (which should be position: relative): a colored band sweeps across, the title's letters
 * drop in one by one, it holds, then everything leaves to the right. Resolves when the card is gone.
 * `theme` is a class on the card (each game styles its own: .jc-card.neon, .western, ...).
 */
export async function titleCard(host, {kicker = '', title, sub = '', theme = '', hold = 0.9} = {}) {
  await cssReady;
  const card = document.createElement('div');
  card.className = `jc-card ${theme}`;
  card.innerHTML = '<div class="jc-scrim"></div><div class="jc-band"></div><div class="jc-text"><div class="jc-kicker"></div><div class="jc-title"></div><div class="jc-sub"></div></div>';
  card.querySelector('.jc-kicker').textContent = kicker;
  card.querySelector('.jc-title').textContent = title;
  card.querySelector('.jc-sub').textContent = sub;
  host.append(card);
  // Shrink a long title until it fits the card, so no name or title is ever cut off.
  const titleEl = card.querySelector('.jc-title');
  const look = getComputedStyle(titleEl);
  card.style.visibility = 'hidden'; // measure in the real font, not in the fallback shown while it loads
  await Promise.race([document.fonts?.load(`${look.fontWeight} 20px ${look.fontFamily}`, title).catch(() => {}), new Promise((r) => setTimeout(r, 500))]);
  card.style.visibility = '';
  const room = card.clientWidth - 28;
  const wide = titleEl.getBoundingClientRect().width;
  if (wide > room && room > 0) titleEl.style.fontSize = `${Math.floor(parseFloat(look.fontSize) * room / wide)}px`;
  const band = card.querySelector('.jc-band');
  const text = card.querySelector('.jc-text');
  if (calm()) {
    await gsap.fromTo(card, {opacity: 0}, {opacity: 1, duration: 0.2});
    await wait(hold + 0.4);
    await gsap.to(card, {opacity: 0, duration: 0.2});
    card.remove();
    return;
  }
  const scrim = card.querySelector('.jc-scrim'); // dims the game by its own opacity: fading a background colour repaints everything under it
  const split = new SplitText(card.querySelector('.jc-title'), {type: 'chars'});
  const tl = gsap.timeline();
  tl.fromTo(scrim, {opacity: 0}, {opacity: 1, duration: 0.25}, 0)
    .fromTo(band, {scaleX: 0, transformOrigin: '0% 50%'}, {scaleX: 1, duration: 0.38, ease: 'power4.out'}, 0)
    .from(card.querySelector('.jc-kicker'), {y: -14, opacity: 0, duration: 0.3, ease: 'power2.out'}, 0.18)
    .from(split.chars, {y: 70, rotate: () => gsap.utils.random(-25, 25), scale: 1.6, opacity: 0, duration: 0.5, ease: 'back.out(2.2)', stagger: 0.035}, 0.2)
    .from(card.querySelector('.jc-sub'), {y: 14, opacity: 0, duration: 0.3, ease: 'power2.out'}, '-=0.25')
    .to({}, {duration: hold})
    .to(text, {xPercent: 60, opacity: 0, duration: 0.3, ease: 'power3.in'})
    .to(band, {scaleX: 0, transformOrigin: '100% 50%', duration: 0.3, ease: 'power3.in'}, '<0.05')
    .to(scrim, {opacity: 0, duration: 0.25}, '<');
  await tl;
  split.revert();
  card.remove();
}

/** Bring elements in: rise, fade and settle, one after another. */
export function enter(els, {y = 18, scale = 0.94, stagger = 0.06, delay = 0, duration = 0.45} = {}) {
  const list = gsap.utils.toArray(els);
  if (!list.length) return null;
  if (calm()) return gsap.from(list, {opacity: 0, duration: 0.2, stagger: 0.02, delay, clearProps: 'opacity'});
  return gsap.from(list, {opacity: 0, y, scale, duration, ease: 'back.out(1.6)', stagger, delay, clearProps: 'opacity,transform'});
}

/** The match result's meme sound, for a game with `ownsResultSound` that shows its ending after an animation. */
export function resultSound(mine, theirs) {
  play(mine === theirs ? 'game.draw' : mine > theirs ? 'game.won' : 'game.lost');
}

/** A quick squash-and-stretch pop, for a score, a button, a stamp. */
export function pop(el, {scale = 1.25, duration = 0.45} = {}) {
  if (!el || calm()) return null;
  return gsap.fromTo(el, {scale}, {scale: 1, duration, ease: 'elastic.out(1.1, 0.45)', overwrite: 'auto', clearProps: 'scale'});
}

/** Count a number shown in `el` up (or down) to `to`, with a pop at the end. */
export function countTo(el, to, {duration = 0.7, prefix = '', suffix = ''} = {}) {
  if (!el) return null;
  const from = Number(String(el.dataset.n ?? el.textContent).replace(/[^0-9.-]/g, '')) || 0;
  el.dataset.n = String(to);
  if (from === to) { el.textContent = `${prefix}${to}${suffix}`; return null; }
  // Small steps (a round won) show at once and pop. Bigger ones count up, with a plain timer to finish the job:
  // hidden tabs pause animation, and a score must never depend on it.
  const final = () => { if (el.dataset.n === String(to)) el.textContent = `${prefix}${to}${suffix}`; };
  if (calm() || Math.abs(to - from) <= 3) { final(); pop(el, {scale: 1.35}); return null; }
  setTimeout(final, duration * 1000 + 150);
  const o = {v: from};
  counting.get(el)?.kill(); // a newer total replaces a count still running
  const tween = gsap.to(o, {v: to, duration, ease: 'power2.out', onUpdate: () => { el.textContent = `${prefix}${Math.round(o.v)}${suffix}`; },
    onComplete: () => pop(el, {scale: 1.35})});
  counting.set(el, tween);
  return tween;
}
const counting = new WeakMap();

/** A rubber stamp slammed onto `host`. Returns the element; it stays until you remove it (or pass `life`). */
export function stamp(host, text, {cls = '', rotate = -12, life = 0} = {}) {
  const el = document.createElement('div');
  el.className = `jc-stamp ${cls}`;
  el.textContent = text;
  host.append(el);
  if (!calm()) {
    gsap.fromTo(el, {scale: 3.2, rotate: rotate - 18, opacity: 0}, {scale: 1, rotate, opacity: 1, duration: 0.42, ease: 'slam'});
    gsap.fromTo(host, {x: -6}, {x: 0, duration: 0.4, ease: 'elastic.out(1.4, 0.25)', clearProps: 'x', delay: 0.18});
  } else gsap.set(el, {rotate});
  if (life) gsap.to(el, {opacity: 0, scale: 0.9, duration: 0.3, delay: life, onComplete: () => el.remove()});
  return el;
}

/** Shake an element like a camera hit. `power` 1 is a solid thump. */
export function quake(el, power = 1) {
  if (!el || calm()) return null;
  const tl = gsap.timeline({onComplete: () => gsap.set(el, {clearProps: 'x,y,rotate'})});
  for (let i = 0; i < 7; i++) {
    const k = (1 - i / 7) * power;
    tl.to(el, {x: gsap.utils.random(-10, 10) * k, y: gsap.utils.random(-7, 7) * k, rotate: gsap.utils.random(-1.2, 1.2) * k, duration: 0.045, ease: 'none'});
  }
  return tl.to(el, {x: 0, y: 0, rotate: 0, duration: 0.08});
}

/**
 * Cover `host` with a wipe, run `change` while it is covered (swap the screen), then uncover.
 * `style` is 'iris' (a circle closing and opening) or 'slide' (a band sweeping across).
 */
export async function wipe(host, change, {style = 'slide', color = 'var(--ink)'} = {}) {
  await cssReady;
  if (calm()) { change(); return; }
  const cover = document.createElement('div');
  cover.className = `jc-wipe ${style}`;
  cover.style.background = color;
  host.append(cover);
  if (style === 'iris') {
    await gsap.fromTo(cover, {clipPath: 'circle(0% at 50% 50%)'}, {clipPath: 'circle(75% at 50% 50%)', duration: 0.35, ease: 'power3.in'});
    change();
    await gsap.to(cover, {clipPath: 'circle(0% at 50% 50%)', duration: 0.4, ease: 'power3.out'});
  } else {
    await gsap.fromTo(cover, {xPercent: -101}, {xPercent: 0, duration: 0.3, ease: 'power3.in'});
    change();
    await gsap.to(cover, {xPercent: 101, duration: 0.35, ease: 'power3.out'});
  }
  cover.remove();
}

/** Letters scramble and settle into `text`: for a word reveal. */
export function scrambleTo(el, text, {duration = 0.8} = {}) {
  if (calm()) { el.textContent = text; return null; }
  const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#?!*';
  const o = {p: 0};
  return gsap.to(o, {p: 1, duration, ease: 'power1.out', onUpdate: () => {
    const fixed = Math.floor(o.p * text.length);
    el.textContent = [...text].map((c, i) => (i < fixed || c === ' ' ? c : glyphs[(Math.random() * glyphs.length) | 0])).join('');
  }, onComplete: () => { el.textContent = text; pop(el, {scale: 1.15}); }});
}

/** A soft looping pulse (a "waiting" button, a timer running low). Returns the tween so you can kill it. */
export function pulse(el, {scale = 1.06, duration = 0.6} = {}) {
  if (!el || calm()) return null;
  return gsap.to(el, {scale, duration, ease: 'sine.inOut', yoyo: true, repeat: -1});
}

/** Stop everything this module started on these elements and reset their transforms. */
export function settle(els) {
  const list = gsap.utils.toArray(els);
  gsap.killTweensOf(list);
  gsap.set(list, {clearProps: 'transform,opacity'});
}
