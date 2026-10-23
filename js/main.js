import {generateRoomCode, normalizeRoomCode} from './game.js';
import {RpsMatch, cleanName, MAX_ROOM_NAME_LENGTH} from './match.js';
import {createTransport} from './net.js';
import {HandStageTube} from './hands-tube.js';
import {createStore} from './storage.js';

const $ = (id) => document.getElementById(id);
const HINT_AFTER_MS = 20_000;
const REVEAL_FAILSAFE_MS = 5_000;

const stage = new HandStageTube($('hands'));

let match = null;
let roomId = null;
let hintTimer = null;
let anim = null; // animation progress for the current round, see drive()
let shownScores = {win: 0, lose: 0, draw: 0};
let myName = 'Player';
let qrAutoOpened = false;

const DEFAULT_CREATOR_NAME = 'Ramcharan';
const DEFAULT_JOINER_NAME = 'Kalicharan';
const DEFAULT_ROOM_NAME = 'Kali Pahadi Ke Pichhe';
const store = createStore();

// The name box holds a real value the player erases and retypes, not a hint.
// It is always prefilled by role: Ramcharan when creating, Kalicharan when joining
// (so two players never both start as the same name). Names used before are kept
// and offered as chips under the box; tapping one (or typing) overrides the default.
let nameEdited = false;

function syncDefaultName() {
  if (nameEdited) return;
  const joining = $('code-input').value.trim() !== '' || !$('invite-note').hidden;
  $('name-input').value = joining ? DEFAULT_JOINER_NAME : DEFAULT_CREATOR_NAME;
}
$('name-input').addEventListener('input', () => { nameEdited = true; });
syncDefaultName();
$('code-input').addEventListener('input', syncDefaultName);

// --- Remembered names and rooms ------------------------------------------------
function renderRecents() {
  const names = store.names();
  const chips = $('recent-names');
  chips.replaceChildren(...names.map((name) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = name;
    b.addEventListener('click', () => { $('name-input').value = name; nameEdited = true; });
    return b;
  }));
  chips.hidden = names.length === 0;

  const rooms = store.rooms();
  $('recent-rooms').hidden = rooms.length === 0 || !$('invite-note').hidden;
  $('recent-rooms-list').replaceChildren(...rooms.map((room) => {
    const li = document.createElement('li');

    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'room-btn';
    const label = document.createElement('span');
    label.className = 'room-label';
    label.textContent = room.name ?? 'Room';
    const code = document.createElement('span');
    code.className = 'room-code-text';
    code.textContent = room.code;
    go.append(label, code);
    go.title = `Rejoin as ${room.myName || 'a new name'}`;
    go.addEventListener('click', () => enterRoom(room.code, {
      creator: room.role === 'creator',
      name: nameEdited ? null : room.myName || null, // a name typed this visit wins
      roomName: room.name,
    }));

    const forget = document.createElement('button');
    forget.type = 'button';
    forget.className = 'forget ghost';
    forget.textContent = '\u2715';
    forget.setAttribute('aria-label', `Forget room ${room.code}`);
    forget.addEventListener('click', () => { store.forgetRoom(room.code); renderRecents(); });

    li.append(go, forget);
    return li;
  }));
}

function inviteLink(code) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', code);
  return url.toString();
}

function showHomeError(text) {
  $('home-error').textContent = text;
  $('home-error').hidden = !text;
}

// name / roomName override the form (used when rejoining a remembered room).
function enterRoom(code, {creator = false, name = null, roomName = null} = {}) {
  roomId = code;
  myName = cleanName(name ?? $('name-input').value, creator ? DEFAULT_CREATOR_NAME : DEFAULT_JOINER_NAME);
  const hostedRoomName = creator
    ? cleanName(roomName ?? $('room-name-input').value, DEFAULT_ROOM_NAME, MAX_ROOM_NAME_LENGTH)
    : '';
  if (name === null && nameEdited) store.rememberName(myName); // never remember the defaults
  store.rememberRoom({code, name: hostedRoomName || null, myName, role: creator ? 'creator' : 'joiner'});
  $('label-me').textContent = myName;
  $('label-them').textContent = 'Friend';
  history.replaceState(null, '', inviteLink(code));
  $('room-code').textContent = code;
  $('screen-home').hidden = true;
  $('screen-game').hidden = false;

  shownScores = {win: 0, lose: 0, draw: 0};
  qrAutoOpened = creator;
  setQr(creator);
  match = new RpsMatch({
    transport: createTransport(code),
    roomId: code,
    name: myName,
    roomName: hostedRoomName,
    onChange: (s) => { drive(s); render(s); },
  });
  const s = match.snapshot();
  drive(s);
  render(s);

  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    if (match?.snapshot().phase === 'waiting') {
      $('hint').hidden = false;
      $('hint').textContent =
        'Still waiting. Make sure your friend opened the link or typed the code. ' +
        'If it never connects, try another network (some corporate Wi-Fi blocks peer-to-peer).';
    }
  }, HINT_AFTER_MS);
}

function leaveRoom() {
  clearTimeout(hintTimer);
  match?.leave();
  match = null;
  stage.reset();
  anim = null;
  setQr(false);
  history.replaceState(null, '', location.pathname);
  $('screen-game').hidden = true;
  $('screen-home').hidden = false;
  $('hint').hidden = true;
  renderRecents();
}

// --- QR code -------------------------------------------------------------------
// qrcode-generator is loaded only when the QR is first shown, so a CDN hiccup
// can never break the game itself; the link and copy button always work.
let qrModule = null;
let qrFor = null;

async function renderQr(link) {
  if (qrFor === link) return;
  const box = $('qr');
  try {
    qrModule ??= (await import('https://esm.sh/qrcode-generator@1.4.4')).default;
    const qr = qrModule(0, 'M');
    qr.addData(link);
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 4;
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${n + quiet * 2} ${n + quiet * 2}`);
    svg.setAttribute('shape-rendering', 'crispEdges');
    const bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', '#fff');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d); path.setAttribute('fill', '#000');
    svg.append(bg, path);
    box.replaceChildren(svg);
    qrFor = link;
  } catch {
    const p = document.createElement('p');
    p.className = 'qr-error';
    p.textContent = 'Could not load the QR code (offline?). Use the invite link instead.';
    box.replaceChildren(p);
  }
}

function setQr(open) {
  $('qr-panel').hidden = !open;
  $('btn-qr').setAttribute('aria-expanded', String(open));
  $('btn-qr').textContent = open ? 'Hide QR' : 'QR code';
  if (open && roomId) renderQr(inviteLink(roomId));
}

// --- Animation driver --------------------------------------------------------
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

  if (s.phase === 'waiting') return;
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
    setTimeout(() => {
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

// --- Text / controls -----------------------------------------------------------
const STATUS = {
  waiting: 'Waiting for your friend to join…',
  choosing: 'Pick your move',
  committed: 'Locked in. Waiting for your friend…',
  revealing: 'Revealing…',
};
const OUTCOME = {win: ['You win! 🎉', 'win'], lose: ['You lose 😬', 'lose'], draw: ['It’s a draw', '']};

function render(s) {
  const them = s.opponentName ?? 'Friend';
  $('room-title').textContent = s.roomName ?? 'Room';
  if (s.roomName && roomId) store.updateRoomName(roomId, s.roomName);
  $('label-them').textContent = them;
  if (s.phase !== 'waiting' && qrAutoOpened) { qrAutoOpened = false; setQr(false); }
  const resultVisible = s.phase === 'result' && anim?.done;
  if (s.phase !== 'result' || resultVisible) shownScores = s.scores; // no spoilers mid-animation

  $('score-win').textContent = shownScores.win;
  $('score-draw').textContent = shownScores.draw;
  $('score-lose').textContent = shownScores.lose;
  $('round-label').textContent = s.phase === 'waiting' ? '' : `Round ${s.round}`;

  const status = $('status');
  status.className = 'center';
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
  if (s.phase !== 'waiting') $('hint').hidden = true;

  for (const btn of document.querySelectorAll('.move')) {
    btn.disabled = s.phase !== 'choosing';
    btn.classList.toggle('selected', btn.dataset.move === s.myMove);
  }
  $('moves').hidden = !(s.phase === 'waiting' || s.phase === 'choosing');
  $('btn-next').hidden = !(resultVisible || s.phase === 'cheat');
}

$('btn-create').addEventListener('click', () => enterRoom(generateRoomCode(), {creator: true}));
$('btn-qr').addEventListener('click', () => setQr($('qr-panel').hidden));

$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = normalizeRoomCode($('code-input').value);
  if (!code) return showHomeError('That does not look like a room code (6 letters/digits).');
  showHomeError('');
  enterRoom(code);
});

for (const btn of document.querySelectorAll('.move')) {
  btn.addEventListener('click', () => match?.pick(btn.dataset.move));
}
$('btn-next').addEventListener('click', () => match?.nextRound());
$('btn-leave').addEventListener('click', leaveRoom);

$('btn-copy').addEventListener('click', async () => {
  const link = inviteLink(roomId);
  try {
    await navigator.clipboard.writeText(link);
    $('btn-copy').textContent = 'Copied!';
    setTimeout(() => ($('btn-copy').textContent = 'Copy invite link'), 1500);
  } catch {
    prompt('Copy this link:', link);
  }
});

// Opened via an invite link or QR code: show the join form with the code filled
// in, so the friend can pick a name first, then tap Join.
const fromUrl = normalizeRoomCode(new URLSearchParams(location.search).get('room'));
if (fromUrl) {
  $('code-input').value = fromUrl;
  $('create-block').hidden = true;
  $('invite-note').hidden = false;
  $('invite-note').textContent = `You\u2019ve been invited to room ${fromUrl}. Enter your name and tap Join.`;
  syncDefaultName();
  $('name-input').focus();
}
renderRecents();
