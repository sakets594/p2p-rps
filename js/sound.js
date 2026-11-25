// Plays the meme clips from js/sound-map.js. One shared player for the page:
//
//   play('rps.round_won')   pick a clip for that scenario and play it
//   setMuted(true)          silence everything (the room's Sound button; remembered by main.js)
//   unlock()                call from a click/tap: browsers keep audio off until then
//
// Only one clip plays at a time: a new moment cuts the previous one short, so a fast
// game never turns into a pile of overlapping memes. Every failure (no audio support,
// a missing file, autoplay blocked) is swallowed: sound is a bonus, never a reason to break a game.

import {allClips, chanceFor, maxSecsFor, pickClip, scenarioIds} from './sound-map.js';

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
/** Shown in the console on load, so you can tell the page is running this version of the sound code. */
export const SOUND_BUILD = '2026-11-24.11';

/** `log` gets one line per decision (played, or why not); silent unless the page passes a logger. */
export function createPlayer({makeContext = makeBrowserContext, load = fetchBytes, rng = Math.random, now = Date.now, log = () => {}} = {}) {
  const clock = () => globalThis.performance?.now?.() ?? Date.now(); // sub-millisecond, for the timing lines
  let ctx = null;
  let muted = false;
  let current = null; // {src, gain}
  let token = 0; // bumped on every play(), so a slow load never plays over a newer moment
  const buffers = new Map(); // path -> Promise<AudioBuffer | null>
  const last = new Map(); // scenario -> the clip it played last

  function context() {
    if (!ctx) {
      try { ctx = makeContext(); } catch (err) { log('no audio support:', String(err)); }
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
        } catch (err) {
          log('could not load or decode', path, '-', String(err));
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
    if (c.state === 'suspended') { log('audio is suspended, so this may be silent: tap the page once'); c.resume?.().catch(() => {}); }
    const t = c.currentTime;
    const secs = Math.min(buf.duration, maxSecsFor(scenarioId));
    const src = c.createBufferSource();
    const gain = c.createGain();
    src.buffer = buf;
    gain.gain.setValueAtTime(VOLUME, t);
    if (secs < buf.duration) {
      gain.gain.setValueAtTime(VOLUME, t + secs - FADE_S);
      gain.gain.linearRampToValueAtTime(0, t + secs);
    }
    src.connect(gain);
    gain.connect(c.destination);
    src.onended = () => { if (current?.src === src) current = null; };
    src.start(t);
    if (secs < buf.duration) src.stop(t + secs + 0.01); // after start(): Firefox throws InvalidStateError if stop() comes first
    current = {src, gain};
  }

  return {
    /** Play one random clip for a scenario. Returns the clip path chosen, or null if nothing plays. */
    play(scenarioId) {
      if (muted) { log(scenarioId, '-> skipped: sound is off'); return null; }
      const chance = chanceFor(scenarioId);
      if (chance < 1 && rng() >= chance) { log(scenarioId, `-> skipped by chance (${chance})`); return null; } // not every time, for moments that happen a lot
      const path = pickClip(scenarioId, {last: last.get(scenarioId), rng});
      if (!path) { log(scenarioId, '-> no clips mapped for this scenario'); return null; }
      last.set(scenarioId, path);
      const mine = ++token;
      const asked = now();
      buffer(path).then((buf) => {
        if (!buf) return log(scenarioId, '-> dropped: clip not available', path);
        if (muted) return log(scenarioId, '-> dropped: muted while loading');
        if (mine !== token) return log(scenarioId, '-> dropped: a newer sound replaced it', path);
        if (now() - asked > LATE_MS) return log(scenarioId, '-> dropped: loaded too late', path);
        try {
          const t0 = clock();
          start(buf, scenarioId);
          log(scenarioId, '-> playing', path, `(audio ${ctx.state}, ${Math.min(buf.duration, maxSecsFor(scenarioId)).toFixed(1)}s, start() took ${(clock() - t0).toFixed(1)} ms on the main thread)`);
        } catch (err) { log(scenarioId, '-> failed to start:', String(err)); }
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
      const t0 = clock();
      const c = context();
      if (!c) return;
      if (c.state === 'suspended') c.resume?.().catch(() => {});
      log('unlocked by a tap; audio is', c.state, `; engine setup took ${(clock() - t0).toFixed(1)} ms on the main thread; loading`, allClips().length, 'clips');
      const queue = allClips();
      const worker = async () => { while (queue.length) await buffer(queue.shift()); };
      for (let i = 0; i < PRELOAD_PARALLEL; i++) worker();
    },
  };
}

// Add ?sounddebug to the page address to also see the log on screen, for browsers whose console hides it.
/** What the page is animating right now, e.g. "3 (fx-glow on .ttt-cell.line, waapi on DIV)", to name the culprit of a slow frame. */
function runningAnimations() {
  try {
    const all = document.getAnimations().filter((a) => a.playState === 'running');
    const names = [...new Set(all.map((a) => {
      const el = a.effect?.target;
      const where = el ? `${el.tagName}${el.classList?.length ? '.' + [...el.classList].join('.') : ''}` : '?';
      return `${a.animationName ?? 'waapi'} on ${where}`;
    }))];
    return `${all.length}${names.length ? ` (${names.slice(0, 5).join(', ')})` : ''}`;
  } catch { return 'unknown'; }
}

function mountDebugPanel() {
  if (typeof document === 'undefined' || !/[?&]sounddebug\b/.test(globalThis.location?.search ?? '')) return null;
  const pre = document.createElement('pre');
  pre.id = 'sound-debug';
  pre.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:34vh;overflow:auto;margin:0;padding:6px 8px;'
    + 'background:rgba(0,0,0,.85);color:#9f9;font:11px/1.35 ui-monospace,monospace;z-index:2000;pointer-events:none;white-space:pre-wrap';
  const lines = [];
  document.body.append(pre);
  let lastLine = '';
  let lastLineAt = 0;
  const add = (line) => {
    lines.push(`${new Date().toLocaleTimeString()} ${line}`);
    if (lines.length > 40) lines.shift();
    pre.textContent = lines.join('\n');
    pre.scrollTop = pre.scrollHeight;
  };
  // Jank detector: any frame that took over 50 ms is reported with the last sound line before it, so a
  // stall that lines up with a sound shows up here, and one that does not (effects, network) is also visible.
  let lastFrame = 0;
  const frame = (t) => {
    if (lastFrame && !document.hidden && t - lastFrame > 50) {
      add(`!! slow frame ${Math.round(t - lastFrame)} ms; last sound line was ${Math.round(t - lastLineAt)} ms earlier: ${lastLine}; running animations: ${runningAnimations()}`);
    }
    lastFrame = t;
    requestAnimationFrame(frame);
  };
  document.addEventListener('visibilitychange', () => { lastFrame = 0; });
  requestAnimationFrame(frame);
  return (line) => { lastLine = line; lastLineAt = performance.now(); add(line); };
}
const panel = mountDebugPanel();
/** One line to the console (and the on-screen panel, with ?sounddebug). The room and games use it too. */
export const soundLog = (...args) => { console.info('[sound]', ...args); panel?.(args.join(' ')); };
const say = soundLog;
const player = createPlayer({log: say});
say(`build ${SOUND_BUILD}: ${scenarioIds().length} scenarios, ${allClips().length} clips`);
export const play = (scenarioId) => player.play(scenarioId);
export const setMuted = (value) => player.setMuted(value);
export const isMuted = () => player.isMuted();
export const unlock = () => player.unlock();
