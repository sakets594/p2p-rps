// Real two-player test over the real network: two Chrome pages (two peers) find each other through the
// public relays, join one room and play Rock Paper Scissors and Cup Pong through the real room UI.
//   node scripts/live-p2p.mjs [base-url]        default https://sakets594.github.io/p2p-rps/
//   npm run live
// It still runs on one machine, so it does not prove two different networks, but it does use the real
// Trystero/WebRTC path (relay discovery, ICE, data channels), which the in-memory smoke test cannot.

import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {join} from 'node:path';

const base = (process.argv[2] ?? 'https://sakets594.github.io/p2p-rps/').replace(/\/?$/, '/');
const chrome = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter(Boolean).find((p) => existsSync(p));
if (!chrome) { console.error('No Chrome found. Set CHROME=/path/to/chrome.'); process.exit(2); }

const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--mute-audio', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${join(process.env.TMPDIR ?? '/tmp', `live-profile-${process.pid}`)}`, '--remote-debugging-port=0', '--window-size=1000,900', 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  child.stderr.on('data', (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
  setTimeout(() => reject(new Error('Chrome DevTools did not start')), 20_000);
});
const port = new URL(wsUrl).port;

async function openPage(url) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, {method: 'PUT'})).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const waiting = new Map();
  const errors = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id) { waiting.get(m.id)?.(m); waiting.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  });
  const cdp = (method, params = {}) => new Promise((r) => { const n = ++id; waiting.set(n, r); ws.send(JSON.stringify({id: n, method, params})); });
  await cdp('Runtime.enable');
  await cdp('Emulation.setFocusEmulationEnabled', {enabled: true}); // both peers count as focused
  await cdp('Page.navigate', {url});
  const ev = async (expr) => (await cdp('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true})).result?.result?.value;
  return {ev, errors, id: t.id, goto: (u) => cdp('Page.navigate', {url: u})};
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, ms = 60_000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = await fn(); if (v) return v; await wait(300); }
  throw new Error(`timed out waiting for: ${what}`);
}
const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({name, ok: true}); console.log(`PASS  ${name}  (${Math.round((Date.now() - t0) / 1000)} s)`); }
  catch (e) {
    results.push({name, ok: false});
    const seen = async (P) => (await P.ev(`document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300)`)) ?? '';
    console.log(`FAIL  ${name}\n      ${e.message}\n      A sees: ${await seen(A)}\n      B sees: ${await seen(B)}`);
    throw e;
  }
}

const A = await openPage(base);
const B = await openPage('about:blank');
console.log(`testing ${base} with two real peers`);
let code;
try {
  await step('A creates a room', async () => {
    await until('home screen', () => A.ev(`!!document.getElementById('btn-create')`), 30_000);
    // The button is in the HTML before the module has loaded (esm.sh import), so keep clicking until the room opens.
    code = await until('room code', async () => {
      await A.ev(`document.getElementById('screen-room').hidden && document.getElementById('btn-create').click()`);
      return A.ev(`document.getElementById('room-code')?.textContent.trim()`);
    }, 60_000);
  });
  await step(`B joins room ${code} from the invite link and both see each other`, async () => {
    await B.goto(`${base}?room=${code}`);
    // Wait for the script to fill in the invite (clicking earlier would submit the form natively and lose the code).
    await until('B shows the invite', () => B.ev(`document.getElementById('code-input')?.value === ${JSON.stringify(code)}`), 60_000);
    await until('B joined the room', async () => {
      await B.ev(`document.getElementById('screen-room').hidden && document.querySelector('#join-form button').click()`);
      await wait(1500);
      return B.ev(`!document.getElementById('screen-room').hidden`);
    }, 60_000);
    await until('both players listed and games enabled', async () => (await A.ev(`document.querySelectorAll('.game-card.ready:not([disabled])').length`)) > 0
      && (await B.ev(`document.querySelectorAll('.game-card.ready:not([disabled])').length`)) > 0, 90_000);
  });

  const start = async (title) => {
    await A.ev(`[...document.querySelectorAll('.game-card')].find((c) => c.querySelector('.title').textContent === ${JSON.stringify(title)}).click()`);
    await until('B sees the proposal', () => B.ev(`!document.getElementById('room-proposal').hidden`), 20_000);
    await B.ev(`document.getElementById('btn-accept').click()`);
    await until(`${title} on screen for both`, async () => (await A.ev(`!document.getElementById('room-game').hidden`)) && (await B.ev(`!document.getElementById('room-game').hidden`)), 30_000);
  };
  const back = async () => {
    await A.ev(`document.getElementById('btn-end-game').click()`);
    await until('both back in the room', async () => (await A.ev(`!document.getElementById('room-picker').hidden`)) && (await B.ev(`!document.getElementById('room-picker').hidden`)), 20_000);
  };

  await step('Rock Paper Scissors: pick a game, accept, play a round over WebRTC', async () => {
    await start('Rock Paper Scissors');
    await until('moves enabled', async () => (await A.ev(`document.querySelector('#game-stage .move')?.disabled === false`)) && (await B.ev(`document.querySelector('#game-stage .move')?.disabled === false`)));
    await A.ev(`document.querySelector('#game-stage .move[data-move="rock"]').click()`);
    await B.ev(`document.querySelector('#game-stage .move[data-move="scissors"]').click()`);
    const sa = await until('A sees a win', () => A.ev(`/win/i.test(document.querySelector('#game-stage .status').textContent)`), 40_000);
    await until('B sees a loss', () => B.ev(`/lose/i.test(document.querySelector('#game-stage .status').textContent)`), 20_000);
    if (!sa) throw new Error('no result');
    await back();
  });

  await step('Cup Pong: pick, accept, intro, coin flip, a real swipe seen by both', async () => {
    await start('Cup Pong');
    const hiddenBoth = async (sel) => (await A.ev(`document.querySelector('${sel}').classList.contains('hidden')`)) && (await B.ev(`document.querySelector('${sel}').classList.contains('hidden')`));
    await until('intro and spinner done', async () => (await hiddenBoth('.cp-intro')) && (await hiddenBoth('.cp-spin')), 60_000);
    const aThrows = await until('a thrower is active', async () => (await A.ev(`!!document.querySelector('[data-card="you"].active')`)) ? 'A' : (await B.ev(`!!document.querySelector('[data-card="you"].active')`)) ? 'B' : null, 30_000);
    const T = aThrows === 'A' ? A : B;
    await wait(1800);
    const swipe = `(async () => {
      const canvas = document.querySelector('#game-stage canvas'); const r = canvas.getBoundingClientRect();
      for (const fy of [0.78, 0.74, 0.82, 0.7, 0.86, 0.66, 0.9]) {
        const x0 = r.left + r.width / 2, y0 = r.top + r.height * fy, len = r.height * 0.3;
        const ev = (t, x, y) => canvas.dispatchEvent(new PointerEvent(t, {pointerId: 1, clientX: x, clientY: y, bubbles: true, isPrimary: true}));
        ev('pointerdown', x0, y0); for (let k = 1; k <= 6; k++) ev('pointermove', x0, y0 - len * k / 6); ev('pointerup', x0, y0 - len);
        await new Promise((s) => setTimeout(s, 250));
        if (document.querySelectorAll('.cp-dots i.used').length >= 1) return true;
      }
      return false; })()`;
    if (!(await T.ev(swipe))) throw new Error('the swipe did not produce a throw');
    await until('both screens show the ball used', async () => (await A.ev(`document.querySelectorAll('.cp-dots i.used').length`)) >= 1 && (await B.ev(`document.querySelectorAll('.cp-dots i.used').length`)) >= 1, 20_000);
    await wait(7000);
    const sc = (P) => P.ev(`[...document.querySelectorAll('[data-sc]')].map((e) => e.dataset.sc + '=' + e.textContent).join(',')`);
    const [a, b] = [await sc(A), await sc(B)];
    const m = (s) => Object.fromEntries(s.split(',').map((x) => x.split('=')));
    if (m(a).you !== m(b).rival || m(a).rival !== m(b).you) throw new Error(`scores differ: A ${a} B ${b}`);
    if (await A.ev(`!document.querySelector('.cp-notice').classList.contains('hidden')`) || await B.ev(`!document.querySelector('.cp-notice').classList.contains('hidden')`)) throw new Error('a desync/version notice is showing');
    await back();
  });
} catch { /* reported above */ }

const errs = [...A.errors, ...B.errors];
if (errs.length) { results.push({name: 'no uncaught page errors', ok: false}); console.log(`FAIL  uncaught page errors\n      ${errs.join('\n      ')}`); }
else console.log('PASS  no uncaught page errors');
child.kill();
const ok = results.length === 4 && results.every((r) => r.ok) && !errs.length;
console.log(ok ? '\nlive P2P OK' : '\nlive P2P FAILED');
process.exit(ok ? 0 : 1);
