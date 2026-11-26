// Layout check in the real room over real WebRTC: page A is a laptop (1280x720), page B a phone (390x844, DPR 3, touch).
// A creates a room, B joins by link, then they open every ready game in turn, wait for it to settle, measure what each
// player can see and reach, and save a screenshot of both screens.
//   node scripts/room-check.mjs [base-url] [out-dir]     default http://localhost:8000/ and test-results/room-check
//   ONLY="Light Cycles,Hangman"   only these game titles
//   DEEP=1                        also press the first big button (deal, ready, start) before measuring
// Fails (exit 1) when a page scrolls sideways, a control sits off screen to the side, a game does not open or a page
// throws. Controls below the fold and small tap targets are printed as warnings: some games scroll on purpose.

import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {join} from 'node:path';

const base = (process.argv[2] ?? 'http://localhost:8000/').replace(/\/?$/, '/');
const out = process.argv[3] ?? 'test-results/room-check';
mkdirSync(out, {recursive: true});
const chrome = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter(Boolean).find((p) => existsSync(p));
if (!chrome) { console.error('No Chrome found. Set CHROME=/path/to/chrome.'); process.exit(2); }

const child = spawn(chrome, ['--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${join(process.env.TMPDIR ?? '/tmp', `room-check-${process.pid}`)}`, '--remote-debugging-port=0', '--window-size=1280,720', 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
const wsUrl = await new Promise((res, rej) => {
  let b = '';
  child.stderr.on('data', (d) => { b += d; const m = b.match(/DevTools listening on (ws:\/\/\S+)/); if (m) res(m[1]); });
  setTimeout(() => rej(new Error('Chrome DevTools did not start')), 20000);
});
const port = new URL(wsUrl).port;

async function open(url, phone) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {method: 'PUT'})).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const waiting = new Map(), errors = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id) { waiting.get(m.id)?.(m); waiting.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  });
  const cdp = (method, params = {}) => new Promise((r) => { const n = ++id; waiting.set(n, r); ws.send(JSON.stringify({id: n, method, params})); });
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setFocusEmulationEnabled', {enabled: true});
  if (phone) {
    await cdp('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 3, mobile: true});
    await cdp('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 5});
    await cdp('Emulation.setUserAgentOverride', {userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'});
  } else await cdp('Emulation.setDeviceMetricsOverride', {width: 1280, height: 720, deviceScaleFactor: 1, mobile: false});
  await cdp('Page.navigate', {url});
  const ev = async (x) => {
    const r = (await cdp('Runtime.evaluate', {expression: x, returnByValue: true, awaitPromise: true})).result;
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description);
    return r?.result?.value;
  };
  const shot = async (f) => { const r = await cdp('Page.captureScreenshot', {format: 'jpeg', quality: 60}); writeFileSync(f, Buffer.from(r.result.data, 'base64')); };
  return {ev, errors, shot, goto: (u) => cdp('Page.navigate', {url: u})};
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (what, fn, ms = 60000) => {
  for (const t = Date.now(); Date.now() - t < ms;) { const v = await fn(); if (v) return v; await wait(300); }
  throw new Error('timeout: ' + what);
};

// What a player can see and reach, measured on the page.
const AUDIT = `(() => {
  const vw = innerWidth, vh = innerHeight, stage = document.getElementById('game-stage');
  const name = (e) => (e.className?.baseVal ?? e.className) || e.tagName;
  const ctl = [...stage.querySelectorAll('button, input, select, [role=button], canvas')].filter((e) => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none' && !e.closest('[hidden]');
  });
  const off = ctl.filter((e) => { const r = e.getBoundingClientRect(); return r.right > vw + 2 || r.left < -2; }).map(name);
  const small = ctl.filter((e) => { const q = e.getBoundingClientRect(); return e.tagName !== 'CANVAS' && !e.disabled && Math.min(q.width, q.height) < 32; })
    .map((e) => name(e) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height));
  return {
    sideways: document.documentElement.scrollWidth - vw,
    scroll: Math.max(0, document.documentElement.scrollHeight - vh),
    off: [...new Set(off)],
    below: [...new Set(ctl.filter((e) => e.getBoundingClientRect().bottom > vh + 2).map(name))].slice(0, 4),
    small: [...new Set(small)].slice(0, 4),
  };
})()`;

let failed = 0, warned = 0;
const verdict = (who, t, a) => {
  const bad = [a.sideways > 0 && `page scrolls sideways by ${a.sideways}px`, a.off.length && `off screen: ${a.off.join(', ')}`].filter(Boolean);
  const warn = [a.below.length && `below the fold (${a.scroll}px scroll): ${a.below.join(', ')}`, a.small.length && `small tap targets: ${a.small.join(', ')}`].filter(Boolean);
  failed += bad.length ? 1 : 0; warned += warn.length ? 1 : 0;
  console.log(`${bad.length ? 'FAIL' : warn.length ? 'WARN' : 'PASS'}  ${t} on the ${who}${[...bad, ...warn].map((x) => `\n      ${x}`).join('')}`);
};
try {
  const A = await open(base, false), B = await open('about:blank', true);
  const code = await until('room created', async () => {
    await A.ev(`document.getElementById('screen-room')?.hidden && document.getElementById('btn-create').click()`);
    return A.ev(`document.getElementById('room-code')?.textContent.trim()`);
  });
  await B.goto(`${base}?room=${code}`);
  await until('invite link filled in', () => B.ev(`document.getElementById('code-input')?.value === ${JSON.stringify(code)}`));
  await until('phone joined', async () => {
    await B.ev(`document.getElementById('screen-room').hidden && document.querySelector('#join-form button').click()`);
    await wait(1500);
    return B.ev(`!document.getElementById('screen-room').hidden`);
  });
  await until('both see the games', async () => (await A.ev(`document.querySelectorAll('.game-card.ready:not([disabled])').length`)) > 0
    && (await B.ev(`document.querySelectorAll('.game-card.ready:not([disabled])').length`)) > 0, 90000);
  await B.shot(join(out, '00-room-phone.jpg'));
  const only = process.env.ONLY?.split(',').map((s) => s.trim());
  const titles = (await A.ev(`[...document.querySelectorAll('.game-card.ready .title')].map((e) => e.textContent)`)).filter((t) => !only || only.includes(t));
  console.log(`checking ${titles.length} games at ${base}`);
  for (const [i, t] of titles.entries()) {
    try {
      await A.ev(`[...document.querySelectorAll('.game-card')].find((c) => c.querySelector('.title').textContent === ${JSON.stringify(t)}).click()`);
      await until('proposal on the phone', () => B.ev(`!document.getElementById('room-proposal').hidden`), 20000);
      await B.ev(`document.getElementById('btn-accept').click()`);
      await until('game open on both', async () => (await A.ev(`!document.getElementById('room-game').hidden`)) && (await B.ev(`!document.getElementById('room-game').hidden`)), 30000);
      await wait(9000);
      await B.ev(`scrollTo(0,0)`);
      if (process.env.DEEP) {
        for (const P of [A, B]) await P.ev(`[...document.querySelectorAll('#game-stage .dg-card, #game-stage .ec-ticket, #game-stage .primary:not([disabled]), #game-stage button.bs-ready')].find((e) => e.offsetParent)?.click()`);
        await wait(7000);
      }
      const f = `${String(i + 1).padStart(2, '0')}-${t.replace(/\W+/g, '-').toLowerCase()}`;
      verdict('phone', t, await B.ev(AUDIT));
      verdict('laptop', t, await A.ev(AUDIT));
      await B.shot(join(out, `${f}-phone.jpg`)); await A.shot(join(out, `${f}-laptop.jpg`));
      await A.ev(`document.getElementById('btn-end-game').click()`);
      await until('back to the game list', async () => (await A.ev(`!document.getElementById('room-picker').hidden`)) && (await B.ev(`!document.getElementById('room-picker').hidden`)), 20000);
    } catch (e) { failed++; console.log(`FAIL  ${t}: ${e.message}`); break; }
  }
  for (const [who, P] of [['laptop', A], ['phone', B]]) if (P.errors.length) { failed++; console.log(`FAIL  page errors on the ${who}:\n      ${[...new Set(P.errors)].join('\n      ')}`); }
} catch (e) { failed++; console.log(`FAIL  ${e.message}`); }
console.log(`\n${failed ? `${failed} failed` : 'all passed'}${warned ? `, ${warned} warnings` : ''}. Screenshots in ${out}/`);
child.kill();
process.exit(failed ? 1 : 0);
