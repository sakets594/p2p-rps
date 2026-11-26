// Sound check: bots play every game on preview/game-demo.html (both seats on one page, so it is about twice as loud as
// one player hears) while a tap in front of the speakers measures peak level, loudness, clipped samples and how long
// anything was audible. Chrome runs muted, so nothing comes out of the speakers.
//   node scripts/sound-check.mjs [base-url]      default http://localhost:8000/
//   ONLY=tron,hangman   only these game ids;  SECS=20   seconds per game
// Fails (exit 1) on any clipped sample, a peak above 0.9 or a page error. A game that made no sound is a warning.

import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {GAMES} from '../js/games.js';

const base = (process.argv[2] ?? 'http://localhost:8000/').replace(/\/?$/, '/');
const secs = Number(process.env.SECS ?? 20);
const ids = process.env.ONLY?.split(',').map((s) => s.trim()) ?? GAMES.filter((g) => g.status === 'ready').map((g) => g.id);
const chrome = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter(Boolean).find((p) => existsSync(p));
if (!chrome) { console.error('No Chrome found. Set CHROME=/path/to/chrome.'); process.exit(2); }

const child = spawn(chrome, ['--headless=new', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--no-first-run',
  `--user-data-dir=${join(process.env.TMPDIR ?? '/tmp', `sound-check-${process.pid}`)}`, '--remote-debugging-port=0', '--window-size=1280,900', 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
const wsUrl = await new Promise((res, rej) => {
  let b = '';
  child.stderr.on('data', (d) => { b += d; const m = b.match(/listening on (ws:\/\/\S+)/); if (m) res(m[1]); });
  setTimeout(() => rej(new Error('Chrome DevTools did not start')), 20000);
});
const port = new URL(wsUrl).port;
const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const waiting = new Map();
let errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id) { waiting.get(m.id)?.(m); waiting.delete(m.id); }
  else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0]);
});
const cdp = (method, params = {}) => new Promise((r) => { const n = ++id; waiting.set(n, r); ws.send(JSON.stringify({id: n, method, params})); });
const ev = async (x) => (await cdp('Runtime.evaluate', {expression: x, returnByValue: true, awaitPromise: true})).result?.result?.value;
await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Emulation.setFocusEmulationEnabled', {enabled: true});
// Every sound reaches the speakers through AudioNode.connect(destination): put an analyser in between and sample it.
await cdp('Page.addScriptToEvaluateOnNewDocument', {source: `(() => {
  window.__snd = {peak: 0, sum: 0, n: 0, clip: 0, loudMs: 0, nodes: 0, media: 0};
  const orig = AudioNode.prototype.connect, taps = new WeakMap();
  AudioNode.prototype.connect = function (dst, ...a) {
    if (!(dst instanceof AudioDestinationNode)) return orig.call(this, dst, ...a);
    __snd.nodes++;
    let an = taps.get(this.context);
    if (!an) {
      an = this.context.createAnalyser(); an.fftSize = 2048; taps.set(this.context, an); orig.call(an, dst);
      const buf = new Float32Array(2048);
      setInterval(() => {
        an.getFloatTimeDomainData(buf); let p = 0, s = 0;
        for (const v of buf) { const x = Math.abs(v); if (x > p) p = x; s += v * v; if (x >= 1) __snd.clip++; }
        if (p > __snd.peak) __snd.peak = p;
        if (p > 0.002) { __snd.sum += s / buf.length; __snd.n++; __snd.loudMs += 40; }
      }, 40);
    }
    return orig.call(this, an, ...a);
  };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { __snd.media++; return play.call(this); };
})()`});

let failed = 0, warned = 0;
console.log(`sound check, ${secs} s of bot play per game at ${base}`);
for (const g of ids) {
  errors = [];
  await cdp('Page.navigate', {url: `${base}preview/game-demo.html?game=${g}`});
  for (let i = 0; i < 60 && !(await ev('!!window.__demo?.run')); i++) await new Promise((r) => setTimeout(r, 100));
  if (!(await ev('!!window.__demo?.run'))) { failed++; console.log(`FAIL  ${g}: no bot in preview/demo-bots.js`); continue; }
  await ev(`(() => { for (const t of ['pointerdown', 'pointerup', 'click', 'keydown']) document.dispatchEvent(new Event(t, {bubbles: true})); __demo.run().catch(() => {}); return 1; })()`);
  await new Promise((r) => setTimeout(r, secs * 1000));
  const s = JSON.parse(await ev('JSON.stringify(__snd)'));
  const rms = s.n ? Math.sqrt(s.sum / s.n) : 0;
  const bad = [s.clip && `${s.clip} clipped samples`, s.peak > 0.9 && `peak ${s.peak.toFixed(2)} is near clipping`, errors.length && `page errors: ${[...new Set(errors)].join('; ')}`].filter(Boolean);
  const warn = [!s.loudMs && 'made no sound'].filter(Boolean);
  failed += bad.length ? 1 : 0; warned += warn.length ? 1 : 0;
  console.log(`${bad.length ? 'FAIL' : warn.length ? 'WARN' : 'PASS'}  ${g.padEnd(15)} peak ${s.peak.toFixed(2)}  loudness ${rms.toFixed(3)}  audible ${(s.loudMs / 1000).toFixed(1)} s  synth sounds ${s.nodes}  clips ${s.media}${[...bad, ...warn].map((x) => `\n      ${x}`).join('')}`);
}
console.log(`\n${failed ? `${failed} failed` : 'all passed'}${warned ? `, ${warned} warnings` : ''}`);
child.kill();
process.exit(failed ? 1 : 0);
