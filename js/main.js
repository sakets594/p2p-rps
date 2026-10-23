import {generateRoomCode, normalizeRoomCode} from './game.js';
import {RpsMatch} from './match.js';
import {createTransport} from './net.js';

const EMOJI = {rock: '✊', paper: '✋', scissors: '✌️'};
const $ = (id) => document.getElementById(id);
const HINT_AFTER_MS = 20_000;

let match = null;
let roomId = null;
let hintTimer = null;

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

function enterRoom(code) {
  roomId = code;
  history.replaceState(null, '', inviteLink(code));
  $('room-code').textContent = code;
  $('screen-home').hidden = true;
  $('screen-game').hidden = false;

  match = new RpsMatch({transport: createTransport(code), roomId: code, onChange: render});
  render(match.snapshot());

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
  history.replaceState(null, '', location.pathname);
  $('screen-game').hidden = true;
  $('screen-home').hidden = false;
  $('hint').hidden = true;
}

const STATUS = {
  waiting: 'Waiting for your friend to join…',
  choosing: 'Pick your move',
  committed: 'Locked in. Waiting for your friend…',
  revealing: 'Revealing…',
};
const OUTCOME = {win: ['You win! 🎉', 'win'], lose: ['You lose 😬', 'lose'], draw: ['It’s a draw', '']};

function render(s) {
  $('score-win').textContent = s.scores.win;
  $('score-draw').textContent = s.scores.draw;
  $('score-lose').textContent = s.scores.lose;
  $('round-label').textContent = s.phase === 'waiting' ? '' : `Round ${s.round}`;

  const status = $('status');
  status.className = 'center';
  if (s.phase === 'result') {
    const [text, cls] = OUTCOME[s.outcome];
    status.textContent = text;
    if (cls) status.classList.add(cls);
  } else if (s.phase === 'cheat') {
    status.textContent = s.error;
    status.classList.add('lose');
  } else {
    status.textContent = STATUS[s.phase];
  }
  if (s.phase !== 'waiting') $('hint').hidden = true;

  const showReveal = s.phase === 'result';
  $('reveal').hidden = !showReveal;
  if (showReveal) {
    $('reveal-me').textContent = EMOJI[s.myMove];
    $('reveal-them').textContent = EMOJI[s.theirMove];
  }

  for (const btn of document.querySelectorAll('.move')) {
    btn.disabled = s.phase !== 'choosing';
    btn.classList.toggle('selected', btn.dataset.move === s.myMove);
  }
  $('moves').hidden = showReveal || s.phase === 'cheat';
  $('btn-next').hidden = !(s.phase === 'result' || s.phase === 'cheat');
}

$('btn-create').addEventListener('click', () => enterRoom(generateRoomCode()));

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

// Opened via an invite link: join straight away.
const fromUrl = normalizeRoomCode(new URLSearchParams(location.search).get('room'));
if (fromUrl) enterRoom(fromUrl);
