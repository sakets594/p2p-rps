import {generateRoomCode, normalizeRoomCode} from './room-code.js';
import {cleanName, randomName, MAX_ROOM_NAME_LENGTH} from './names.js';
import {Room} from './room.js';
import {createTransport} from './net.js';
import {createStore} from './storage.js';
import {allTags, filterGames, findGame, playersLabel} from './games.js';

const $ = (id) => document.getElementById(id);
const HINT_AFTER_MS = 20_000;

let room = null;
let roomId = null;
let hintTimer = null;
let hintVisible = false;
let myName = 'Player';
let qrAutoOpened = false;
let catalogTag = null; // category filter in the room's game picker
let catalogEnabled = null; // whether picker cards can be clicked; re-render only when it changes
let hosted = null; // the running game: {session, container, instance}

const DEFAULT_ROOM_NAME = 'Kali Pahadi Ke Pichhe';
const store = createStore();

// Two screens: Home (name, create or join) and the Room you are in.
function showScreen(id) {
  $('screen-home').hidden = id !== 'screen-home';
  $('screen-room').hidden = id !== 'screen-room';
}

// The name box holds a real value the player erases and retypes, not a hint.
// Each visit starts with a random name from the list in js/names.js. A name belongs
// to a room, not to the player: it is saved with the room, and coming back to that
// room (its link, its code, or "Recent rooms") brings the same name back. Nothing
// remembers a name across rooms or visits.
let nameEdited = false; // the player typed in the box this visit
$('name-input').value = randomName();
$('name-input').addEventListener('input', () => { nameEdited = true; });

/** If this room was visited before, show the name used there (unless one was typed now). */
function prefillNameForRoom(code) {
  if (nameEdited || !code) return;
  const known = store.rooms().find((r) => r.code === code);
  if (known?.myName) $('name-input').value = known.myName;
}
$('code-input').addEventListener('input', () => prefillNameForRoom(normalizeRoomCode($('code-input').value)));

// --- Remembered rooms ------------------------------------------------------------
function renderRecents() {
  const rooms = store.rooms();
  $('recent-rooms').hidden = rooms.length === 0 || !$('invite-note').hidden;
  $('recent-rooms-list').replaceChildren(...rooms.map((entry) => {
    const li = document.createElement('li');

    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'room-btn';
    const label = document.createElement('span');
    label.className = 'room-label';
    label.textContent = entry.name ?? 'Room';
    const code = document.createElement('span');
    code.className = 'room-code-text';
    code.textContent = entry.code;
    go.append(label, code);
    go.title = `Rejoin as ${entry.myName || 'a new name'}`;
    go.addEventListener('click', () => enterRoom(entry.code, {
      creator: entry.role === 'creator',
      name: nameEdited ? null : entry.myName || null, // a name typed this visit wins
      roomName: entry.name,
    }));

    const forget = document.createElement('button');
    forget.type = 'button';
    forget.className = 'forget ghost';
    forget.textContent = '✕';
    forget.setAttribute('aria-label', `Forget room ${entry.code}`);
    forget.addEventListener('click', () => { store.forgetRoom(entry.code); renderRecents(); });

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

/** Undo the invite-link layout (hidden create block, join-only note). */
function clearInvite() {
  $('invite-note').hidden = true;
  $('create-block').hidden = false;
  $('code-input').value = '';
  showHomeError('');
}

// --- Entering and leaving a room ---------------------------------------------
// name / roomName override the form (used when rejoining a remembered room).
function enterRoom(code, {creator = false, name = null, roomName = null} = {}) {
  roomId = code;
  myName = cleanName(name ?? $('name-input').value, randomName());
  const hostedRoomName = creator
    ? cleanName(roomName ?? $('room-name-input').value, DEFAULT_ROOM_NAME, MAX_ROOM_NAME_LENGTH)
    : '';
  store.rememberRoom({code, name: hostedRoomName || null, myName, role: creator ? 'creator' : 'joiner'});
  history.replaceState(null, '', inviteLink(code));
  $('room-code').textContent = code;
  showScreen('screen-room');

  qrAutoOpened = creator;
  setQr(creator);
  catalogEnabled = null;
  hintVisible = false;
  room = new Room({
    transport: createTransport(code),
    roomId: code,
    name: myName,
    roomName: hostedRoomName,
    onChange: render,
  });
  render(room.snapshot());

  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    if (room?.snapshot().phase === 'waiting') {
      hintVisible = true;
      render(room.snapshot());
    }
  }, HINT_AFTER_MS);
}

function leaveRoom() {
  clearTimeout(hintTimer);
  unmountGame();
  room?.leave();
  room = null;
  setQr(false);
  clearInvite();
  document.querySelector('main').classList.remove('wide');
  history.replaceState(null, '', location.pathname);
  showScreen('screen-home');
  renderRecents();
}

// --- QR code -------------------------------------------------------------------
// qrcode-generator is loaded only when the QR is first shown, so a CDN hiccup
// can never break the room itself; the link and copy button always work.
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

// --- The room screen -----------------------------------------------------------
const INCOMPATIBLE = 'Your friend is using a different version of the app. Ask them to refresh the page, and refresh yours too.';

function render(s) {
  const them = s.opponentName ?? 'Friend';
  $('room-title').textContent = s.roomName ?? 'Room';
  if (s.roomName && roomId) store.updateRoomName(roomId, s.roomName);
  if (s.phase !== 'waiting' && qrAutoOpened) { qrAutoOpened = false; setQr(false); }

  const people = [['me', myName]];
  if (s.phase !== 'waiting') people.push(['them', them]);
  $('room-people').replaceChildren(...people.map(([who, name]) => {
    const span = document.createElement('span');
    span.className = `who ${who}`;
    span.textContent = name;
    return span;
  }));

  const waiting = s.phase === 'waiting';
  $('room-waiting').hidden = !waiting;
  $('room-waiting').textContent = 'Waiting for your friend to join…';
  $('room-hint').hidden = !(waiting && hintVisible);
  $('room-hint').textContent =
    'Still waiting. Make sure your friend opened the link or typed the code. ' +
    'If it never connects, try another network (some corporate Wi-Fi blocks peer-to-peer).';

  const notice = s.phase === 'incompatible' ? INCOMPATIBLE : s.notice;
  $('room-notice').hidden = !notice;
  $('room-notice').textContent = notice ?? '';

  // Picker while nobody has proposed anything; clickable only once a friend is here.
  $('room-picker').hidden = !(waiting || s.phase === 'idle');
  const enabled = s.phase === 'idle';
  if (enabled !== catalogEnabled) { catalogEnabled = enabled; renderCatalog(); }

  const proposing = s.phase === 'proposing';
  const invited = s.phase === 'invited';
  $('room-proposal').hidden = !(proposing || invited);
  if (proposing || invited) {
    const title = findGame(s.pending.gameId)?.title ?? 'a game';
    $('proposal-text').textContent = invited
      ? `${them} wants to play ${title}.`
      : `Waiting for ${them} to accept ${title}…`;
  }
  $('btn-accept').hidden = !invited;
  $('btn-decline').hidden = !invited;
  $('btn-cancel').hidden = !proposing;

  const playing = s.phase === 'playing';
  $('room-game').hidden = !playing;
  const game = playing ? findGame(s.session.gameId) : null;
  $('game-title').textContent = game?.title ?? '';
  $('game-away').hidden = !(playing && s.away);
  $('btn-again').hidden = !(playing && s.session.result);
  document.querySelector('main').classList.toggle('wide', game?.layout === 'wide');

  syncGame(s);
}

// --- Hosting a game --------------------------------------------------------------
// The room says which session is running; this loads that game's module and mounts
// it into its own container, and tears it down when the session ends.
function syncGame(s) {
  const session = s.phase === 'playing' ? s.session : null;
  if (hosted && hosted.session !== session) unmountGame();
  if (session && !hosted) mountGame(session);
}

async function mountGame(session) {
  const container = document.createElement('div');
  const entry = {session, container, instance: null};
  hosted = entry;
  $('game-stage').append(container);
  const game = findGame(session.gameId);
  try {
    const mod = await game.load();
    const instance = await mod.createGame({session, container});
    if (hosted !== entry) { instance?.destroy?.(); return; } // ended while loading
    entry.instance = instance;
  } catch (err) {
    console.error(err);
    if (hosted === entry) {
      const p = document.createElement('p');
      p.className = 'error';
      p.textContent = `Could not load ${game.title}. Go back to the room and try again.`;
      container.replaceChildren(p);
    }
  }
}

function unmountGame() {
  const entry = hosted;
  hosted = null;
  if (!entry) return;
  entry.instance?.destroy?.();
  entry.container.remove();
}

// --- The game picker -------------------------------------------------------------
function renderCatalog() {
  const games = filterGames({query: $('game-search').value, tag: catalogTag});

  $('game-tags').replaceChildren(...[null, ...allTags()].map((tag) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = tag ?? 'All';
    b.setAttribute('aria-pressed', String(tag === catalogTag));
    b.addEventListener('click', () => { catalogTag = tag; renderCatalog(); });
    return b;
  }));

  $('game-grid').replaceChildren(...games.map((game) => {
    const ready = game.status === 'ready';
    const li = document.createElement('li');
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `game-card ${ready ? 'ready' : 'soon'}`;
    card.disabled = !ready || !catalogEnabled;
    if (ready && !catalogEnabled) card.title = 'Waiting for your friend to join';

    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = game.icon;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = ready ? 'Play' : 'Soon';
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = game.title;
    const blurb = document.createElement('span');
    blurb.className = 'blurb';
    blurb.textContent = game.blurb;
    const tags = document.createElement('span');
    tags.className = 'tags';
    tags.append(...game.tags.map((t) => {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = t;
      return tag;
    }));
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = ready ? playersLabel(game) : `${playersLabel(game)} · coming soon`;

    card.append(icon, badge, title, blurb, tags, meta);
    if (ready) card.addEventListener('click', () => room?.propose(game.id));
    li.append(card);
    return li;
  }));

  $('game-count').textContent = `${games.length} ${games.length === 1 ? 'game' : 'games'}`;
  $('game-empty').hidden = games.length > 0;
}

// --- Wiring ----------------------------------------------------------------------
$('btn-create').addEventListener('click', () => enterRoom(generateRoomCode(), {creator: true}));
$('btn-qr').addEventListener('click', () => setQr($('qr-panel').hidden));
$('btn-leave').addEventListener('click', leaveRoom);
$('game-search').addEventListener('input', renderCatalog);

$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = normalizeRoomCode($('code-input').value);
  if (!code) return showHomeError('That does not look like a room code (6 letters/digits).');
  showHomeError('');
  enterRoom(code);
});

$('btn-accept').addEventListener('click', () => room?.accept());
$('btn-decline').addEventListener('click', () => room?.decline());
$('btn-cancel').addEventListener('click', () => room?.cancel());
$('btn-end-game').addEventListener('click', () => room?.endGame());
$('btn-again').addEventListener('click', () => {
  const gameId = room?.snapshot().session?.gameId;
  if (!gameId) return;
  room.endGame();
  room.propose(gameId); // the other player has to accept again
});

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
  $('invite-note').textContent = `You’ve been invited to room ${fromUrl}. Enter your name and tap Join.`;
  prefillNameForRoom(fromUrl); // been here before: the same name as last time
  $('name-input').focus();
}
renderCatalog();
renderRecents();
