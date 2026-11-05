// Runs test/browser/smoke.html in headless Chrome and prints the result.
//   npm run smoke            (set CHROME=/path/to/chrome if it is not found)
//   SMOKE_BASE=https://user.github.io/repo/ npm run smoke    tests a deployed site instead of the local files
// No dependencies: a tiny static server plus `chrome --headless --dump-dom`.

import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {extname, join, normalize, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png'};
const CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const chrome = CANDIDATES.find((p) => existsSync(p));
if (!chrome) { console.error('No Chrome found. Set CHROME=/path/to/chrome.'); process.exit(2); }

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const file = join(root, path.endsWith('/') ? `${path}index.html` : path);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  let body;
  try { body = await readFile(file); } catch { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, {'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store'});
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = process.env.SMOKE_BASE ? process.env.SMOKE_BASE.replace(/\/?$/, '/') : `http://127.0.0.1:${server.address().port}/`;
const url = `${base}test/browser/smoke.html?nocache=${Date.now()}`;
console.log(`testing ${base}`);

// Real time (not --virtual-time-budget: that does not tick requestAnimationFrame, which the game's tweens need).
// Chrome is driven over its DevTools port; the page writes its report into #smoke-result when done.
const profile = join(process.env.TMPDIR ?? '/tmp', `smoke-profile-${process.pid}`);
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--mute-audio', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1000,900', 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  child.stderr.on('data', (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
  child.on('close', () => reject(new Error('Chrome exited before DevTools was ready')));
  setTimeout(() => reject(new Error('Chrome DevTools did not start')), 20_000);
});
const port = new URL(wsUrl).port;
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pendingCalls = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); pendingCalls.get(m.id)?.(m); pendingCalls.delete(m.id); });
const cdp = (method, params = {}) => new Promise((r) => { const n = ++id; pendingCalls.set(n, r); ws.send(JSON.stringify({id: n, method, params})); });
const read = async (expr) => (await cdp('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true})).result?.result?.value;

await cdp('Runtime.enable');
const pageErrors = [];
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); });
await cdp('Page.navigate', {url: `${base}?nocache=${Date.now()}`});
await new Promise((r) => setTimeout(r, 4000));
const mainText = await read(`document.body.innerText.slice(0, 200)`);
const mainOk = pageErrors.length === 0 && /room/i.test(mainText ?? '');
console.log(`${mainOk ? 'PASS' : 'FAIL'}  main page loads and shows the room screen${pageErrors.length ? `\n      ${pageErrors.join(' | ')}` : ''}`);
const registry = await read(`fetch('js/games.js?nocache=${Date.now()}', {cache: 'reload'}).then((r) => r.text())`);
const READY_IDS = ['rps', 'cup-pong', 'tic-tac-toe', 'connect-four', 'dots-and-boxes', 'memory-match', 'battleship', 'hangman', 'trivia-duel'];
const regOk = READY_IDS.every((id) => new RegExp(`id:\\s*'${id}'`).test(registry ?? ''));
console.log(`${regOk ? 'PASS' : 'FAIL'}  the served game list has all ${READY_IDS.length} games`);
await cdp('Page.navigate', {url});
let json = null;
for (const t0 = Date.now(); Date.now() - t0 < 150_000 && !json;) {
  await new Promise((r) => setTimeout(r, 500));
  json = await read(`document.getElementById('smoke-result')?.textContent || ''`);
}
const progress = json ? '' : await read(`document.getElementById('out')?.textContent`);
ws.close();
child.kill();
server.close();

if (!json) { console.error(`Smoke page did not finish in time. Last status:\n${progress}`); process.exit(1); }
const report = JSON.parse(json);
for (const r of report.results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.ms} ms)${r.error ? `\n      ${r.error}` : ''}`);
const allOk = report.ok && mainOk && regOk;
console.log(allOk ? `\nsmoke OK (${report.passed} checks)` : `\nsmoke FAILED (${report.failed} of ${report.results.length} browser checks${mainOk && regOk ? '' : ', and a page check above'})`);
process.exit(allOk ? 0 : 1);
