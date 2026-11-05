// Plays the meme clips from js/sound-map.js. One shared player for the page:
//
//   play('rps.round_won')   pick a clip for that scenario and play it
//   setMuted(true)          silence everything (the room's Sound button; remembered by main.js)
//   unlock()                call from a click/tap: browsers keep audio off until then
//
// Only one clip plays at a time: a new moment cuts the previous one short, so a fast
// game never turns into a pile of overlapping memes. Every failure (no audio support,
// a missing file, autoplay blocked) is swallowed: sound is a bonus, never a reason to break a game.

import {allClips, maxSecsFor, pickClip} from './sound-map.js';

const BASE = new URL('../assets/sfx/', import.meta.url);
const VOLUME = 0.8; // the clips are already loudness-matched; this just leaves headroom
const FADE_S = 0.35; // fade-out when a clip is cut to its maxSecs
const CUT_S = 0.05; // fade-out when a newer clip replaces it
const LATE_MS = 1500; // a clip that finished loading this long after its moment is not worth playing
const PRELOAD_PARALLEL = 4;

async function fetchBytes(path) {
  const res = await fetch(new URL(path, BASE));
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.arrayBuffer();
}

function makeBrowserContext() {
  const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  return new Ctx();
}

/** The injectable parts exist so tests can run without a browser. */
export function createPlayer({makeContext = makeBrowserContext, load = fetchBytes, rng = Math.random, now = Date.now} = {}) {
  let ctx = null;
  let muted = false;
  let current = null; // {src, gain}
  let token = 0; // bumped on every play(), so a slow load never plays over a newer moment
  const buffers = new Map(); // path -> Promise<AudioBuffer | null>
  const last = new Map(); // scenario -> the clip it played last

  function context() {
    if (!ctx) {
      try { ctx = makeContext(); } catch { /* no audio support */ }
    }
    return ctx;
  }

  function buffer(path) {
    if (!buffers.has(path)) {
      buffers.set(path, (async () => {
        const c = context();
        if (!c) return null;
        try {
          return await c.decodeAudioData(await load(path));
        } catch {
          buffers.delete(path); // try again next time
          return null;
        }
      })());
    }
    return buffers.get(path);
  }

  function stopCurrent() {
    if (!current) return;
    const {src, gain} = current;
    current = null;
    try {
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + CUT_S);
      src.stop(t + CUT_S + 0.01);
    } catch { /* already stopped */ }
  }

  function start(buf, scenarioId) {
    const c = ctx;
    stopCurrent();
    if (c.state === 'suspended') c.resume?.().catch(() => {});
    const t = c.currentTime;
    const secs = Math.min(buf.duration, maxSecsFor(scenarioId));
    const src = c.createBufferSource();
    const gain = c.createGain();
    src.buffer = buf;
    gain.gain.setValueAtTime(VOLUME, t);
    if (secs < buf.duration) {
      gain.gain.setValueAtTime(VOLUME, t + secs - FADE_S);
      gain.gain.linearRampToValueAtTime(0, t + secs);
      src.stop(t + secs + 0.01);
    }
    src.connect(gain);
    gain.connect(c.destination);
    src.onended = () => { if (current?.src === src) current = null; };
    src.start(t);
    current = {src, gain};
  }

  return {
    /** Play one random clip for a scenario. Returns the clip path chosen, or null if nothing plays. */
    play(scenarioId) {
      if (muted) return null;
      const path = pickClip(scenarioId, {last: last.get(scenarioId), rng});
      if (!path) return null;
      last.set(scenarioId, path);
      const mine = ++token;
      const asked = now();
      buffer(path).then((buf) => {
        if (!buf || muted || mine !== token || now() - asked > LATE_MS) return;
        try { start(buf, scenarioId); } catch { /* a broken audio stack must not break the game */ }
      });
      return path;
    },

    setMuted(value) {
      muted = !!value;
      if (muted) { token++; stopCurrent(); }
    },

    isMuted: () => muted,

    /** Call from a user gesture. Wakes the audio engine and loads every clip in the background. */
    unlock() {
      const c = context();
      if (!c) return;
      if (c.state === 'suspended') c.resume?.().catch(() => {});
      const queue = allClips();
      const worker = async () => { while (queue.length) await buffer(queue.shift()); };
      for (let i = 0; i < PRELOAD_PARALLEL; i++) worker();
    },
  };
}

const player = createPlayer();
export const play = (scenarioId) => player.play(scenarioId);
export const setMuted = (value) => player.setMuted(value);
export const isMuted = () => player.isMuted();
export const unlock = () => player.unlock();
