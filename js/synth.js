// Small sound effects made on the spot with the Web Audio API, so they need no audio files: wind, a "DRAW!" whistle,
// gunshots, thuds, countdown beeps. The meme clips (sound.js) play recorded files; this plays generated ones.
// Both respect the Sound button (`isMuted`). The audio context is made on first use, which is always inside a tap.

import {isMuted} from './sound.js';

function browserContext() {
  const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  return new Ctx();
}

/** `makeContext` and `muted` are injectable so tests can run without a browser. */
export function createSynth({makeContext = browserContext, muted = isMuted} = {}) {
  let ctx = null;
  let noise = null;
  let limiter = null;

  function context() {
    if (!ctx) {
      try { ctx = makeContext(); } catch { return null; }
    }
    if (ctx.state === 'suspended') ctx.resume?.().catch(() => {});
    return ctx;
  }

  /** Where every sound ends up: a limiter, so many sounds at once get squeezed instead of crackling. */
  function output(c) {
    if (limiter?.context !== c) {
      limiter = null;
      if (!c.createDynamicsCompressor) return c.destination;
      const node = c.createDynamicsCompressor();
      node.threshold.value = -14; node.knee.value = 6; node.ratio.value = 20; node.attack.value = 0.002; node.release.value = 0.12;
      const trim = c.createGain();
      trim.gain.value = 0.6; // the browser adds make-up gain to a compressor; take it back
      node.connect(trim);
      trim.connect(c.destination);
      limiter = {context: c, node};
    }
    return limiter.node;
  }

  function noiseBuffer(c) {
    if (!noise) {
      noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return noise;
  }

  /** Run `make(c, t0)` if sound is on and audio works. Nothing a sound does may break a game. */
  function sound(make) {
    if (muted()) return null;
    const c = context();
    if (!c) return null;
    try { return make(c, c.currentTime); } catch { return null; }
  }

  /** A gain that rises quickly to `peak` and fades to silence by `t0 + secs`. */
  function envelope(c, t0, secs, peak) {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + secs);
    g.connect(output(c));
    return g;
  }

  function tone(c, t0, {from, to = from, secs, type = 'sine', peak = 0.2}) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t0);
    if (to !== from) o.frequency.exponentialRampToValueAtTime(to, t0 + secs);
    o.connect(envelope(c, t0, secs, peak));
    o.start(t0);
    o.stop(t0 + secs + 0.02);
  }

  function burst(c, t0, {secs, from, to, peak = 0.4, type = 'lowpass'}) {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(to, t0 + secs);
    src.connect(filter);
    filter.connect(envelope(c, t0, secs, peak));
    src.start(t0);
    src.stop(t0 + secs + 0.02);
  }

  return {
    /** Call from a tap, so the browser lets audio start. */
    unlock() { if (!muted()) context(); },
    beep(freq = 520, secs = 0.12, peak = 0.15) { sound((c, t) => tone(c, t, {from: freq, secs, type: 'square', peak})); },
    /** A rising two-note whistle: "DRAW!". */
    whistle() {
      sound((c, t) => {
        tone(c, t, {from: 900, to: 1500, secs: 0.28, peak: 0.22});
        tone(c, t + 0.05, {from: 1350, to: 1900, secs: 0.3, peak: 0.1});
      });
    },
    gunshot() {
      sound((c, t) => {
        burst(c, t, {secs: 0.32, from: 4200, to: 160, peak: 0.55});
        tone(c, t, {from: 160, to: 45, secs: 0.25, peak: 0.45});
      });
    },
    /** A hammer being cocked, for tension. */
    click() { sound((c, t) => burst(c, t, {secs: 0.04, from: 6000, to: 3000, peak: 0.25, type: 'highpass'})); },
    /** Someone hitting the ground. */
    thud() { sound((c, t) => { tone(c, t, {from: 110, to: 38, secs: 0.35, peak: 0.5}); burst(c, t, {secs: 0.18, from: 700, to: 90, peak: 0.25}); }); },
    /** A small bright ping (a bell, a bird) used for fake-outs and wins. */
    ping(freq = 1320) { sound((c, t) => tone(c, t, {from: freq, secs: 0.35, peak: 0.12})); },
    /** Bike crash. */
    boom() { sound((c, t) => { burst(c, t, {secs: 0.5, from: 2200, to: 80, peak: 0.5}); tone(c, t, {from: 120, to: 30, secs: 0.45, peak: 0.4}); }); },
    /** Desert wind that swells and fades until stopped. Returns stop(). */
    startWind() {
      const stop = sound((c, t) => {
        const src = c.createBufferSource();
        src.buffer = noiseBuffer(c);
        src.loop = true;
        const filter = c.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 520;
        filter.Q.value = 0.8;
        const gain = c.createGain();
        gain.gain.value = 0.035;
        const lfo = c.createOscillator();
        lfo.frequency.value = 0.18;
        const depth = c.createGain();
        depth.gain.value = 0.03;
        lfo.connect(depth);
        depth.connect(gain.gain);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(output(c));
        src.start(t);
        lfo.start(t);
        return () => {
          try {
            const now = c.currentTime;
            gain.gain.cancelScheduledValues(now);
            gain.gain.linearRampToValueAtTime(0, now + 0.3);
            src.stop(now + 0.35);
            lfo.stop(now + 0.35);
          } catch { /* already stopped */ }
        };
      });
      return stop ?? (() => {});
    },
    /** A quick electric zap: a bike turning, a tool picked. */
    zap(freq = 1400) { sound((c, t) => tone(c, t, {from: freq, to: freq / 3, secs: 0.09, type: 'sawtooth', peak: 0.06})); },
    /** Air rushing past: a screen wipe or a card flying in. */
    whoosh(secs = 0.35) { sound((c, t) => burst(c, t, {secs, from: 600, to: 3800, peak: 0.12, type: 'bandpass'})); },
    /** A short rising arpeggio for a win, a falling one for a loss. */
    arpeggio(up = true) {
      const notes = up ? [523, 659, 784, 1047] : [440, 370, 311, 262];
      sound((c, t) => notes.forEach((f, i) => tone(c, t + i * 0.09, {from: f, secs: 0.28, type: 'triangle', peak: 0.13})));
    },
    /** A shell whistling down (falls in pitch over `secs`). */
    incoming(secs = 0.55) { sound((c, t) => tone(c, t, {from: 1800, to: 500, secs, type: 'sine', peak: 0.07})); },
    /** Something hitting water. */
    splash() { sound((c, t) => { burst(c, t, {secs: 0.45, from: 3000, to: 300, peak: 0.3}); burst(c, t + 0.05, {secs: 0.3, from: 5000, to: 1500, peak: 0.08, type: 'highpass'}); }); },
    /** Pop of a bubble or an emoji landing. */
    blip(freq = 660) { sound((c, t) => tone(c, t, {from: freq, to: freq * 1.8, secs: 0.08, type: 'sine', peak: 0.12})); },
    /** A crowd clapping for a second or two. */
    applause(secs = 1.6) {
      sound((c, t) => {
        for (let i = 0; i < 36; i++) burst(c, t + Math.random() * secs, {secs: 0.05 + Math.random() * 0.04, from: 2600, to: 900, peak: 0.07 + Math.random() * 0.06, type: 'bandpass'});
      });
    },
    /** A light-cycle engine hum. Returns {speed(k), stop()}; k = 1 is cruising, higher whines. */
    startEngine() {
      const handle = sound((c, t) => {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = 62;
        const sub = c.createOscillator();
        sub.type = 'square';
        sub.frequency.value = 31;
        const filter = c.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 420;
        filter.Q.value = 6;
        const gain = c.createGain();
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.05, t + 0.4);
        o.connect(filter); sub.connect(filter); filter.connect(gain); gain.connect(output(c));
        o.start(t); sub.start(t);
        return {
          speed(k) {
            const now = c.currentTime;
            o.frequency.setTargetAtTime(62 * k, now, 0.2);
            sub.frequency.setTargetAtTime(31 * k, now, 0.2);
            filter.frequency.setTargetAtTime(420 * k, now, 0.2);
          },
          stop() {
            try {
              const now = c.currentTime;
              gain.gain.cancelScheduledValues(now);
              gain.gain.setTargetAtTime(0.0001, now, 0.08);
              o.stop(now + 0.4); sub.stop(now + 0.4);
            } catch { /* already stopped */ }
          },
        };
      });
      return handle ?? {speed() {}, stop() {}};
    },
    /**
     * A looping step sequence (background music). `steps` are frequencies or 0 for a rest, one per sixteenth note.
     * Returns stop(). Scheduling runs ahead on a timer so it stays in time when frames drop.
     */
    startLoop({steps, bass = null, bpm = 112, type = 'square', peak = 0.035}) {
      const stop = sound((c) => {
        const step = 60 / bpm / 4;
        let next = c.currentTime + 0.05;
        let i = 0;
        const out = c.createGain();
        out.gain.value = 1;
        out.connect(output(c));
        const play = (f, at, secs, kind, p) => {
          if (!f) return;
          const o = c.createOscillator();
          o.type = kind;
          o.frequency.value = f;
          const g = c.createGain();
          g.gain.setValueAtTime(0.0001, at);
          g.gain.exponentialRampToValueAtTime(p, at + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, at + secs);
          o.connect(g); g.connect(out);
          o.start(at); o.stop(at + secs + 0.02);
        };
        const timer = setInterval(() => {
          while (next < c.currentTime + 0.25) {
            play(steps[i % steps.length], next, step * 0.9, type, peak);
            if (bass && i % 2 === 0) play(bass[(i / 2) % bass.length], next, step * 1.8, 'triangle', peak * 1.6);
            next += step;
            i++;
          }
        }, 60);
        return () => {
          clearInterval(timer);
          try { out.gain.setTargetAtTime(0.0001, c.currentTime, 0.1); } catch { /* closed */ }
        };
      });
      return stop ?? (() => {});
    },
  };
}

export const synth = createSynth();
