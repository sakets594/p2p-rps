# P2P Games

Frontend-only multiplayer games. No game server, no backend, no cost. Rock Paper Scissors is the
first game; the rest of the catalog is placeholders marked "Soon".

- **Hosting:** static files on GitHub Pages (free, HTTPS, which WebRTC needs).
- **Connecting:** [Trystero](https://github.com/dmotz/trystero) uses free public Nostr relays only to
  introduce the two browsers. After that, all traffic is direct WebRTC.
- **Fairness:** no referee, so simultaneous moves use commit-reveal (each player sends a SHA-256 hash of
  their move and a secret first, reveals later, and the other side verifies it).
- **Room code:** 6 characters from `crypto.getRandomValues` XOR-mixed with `Date.now()`.

## How it fits together

A **room** is the long-lived thing two people share: the invite code, the connection, their names.
A **game** is something you start inside a room. Switching games never means re-joining.

1. **Home:** your name (random until you change it), create a room or join one by code or link, recent rooms.
2. **Room:** who is here, and a game picker (search, category chips, one card per game).
   Pick a game and the other player gets a proposal to accept or decline. If you both propose at once,
   the lower peer id wins. Either player can go back to the room at any time.
3. **Game:** runs inside the room until someone leaves it. A game that finishes gets a
   "Play again / Back to room" bar from the room.

The room is two players for now; a third person who joins is ignored.

| File | Job |
| --- | --- |
| `js/room.js` | The room: presence, names, proposals, game sessions, disconnect grace period. Owns the connection. |
| `js/net.js` | The real transport (Trystero), one channel. `js/memory-transport.js` is the in-memory one for tests. |
| `js/games.js` | The registry of games shown in the picker, plus search and tag filtering. |
| `js/games/<id>/` | One folder per game, loaded only when a game starts. |
| `js/main.js` | The two screens, the picker, and mounting whichever game is running. |
| `js/storage.js` | Recent names and rooms in `localStorage`. |
| `js/sound-map.js` | Which meme clips can play for which moment (one scenario, many clips, one picked at random). |
| `js/sound.js` | Plays them: one clip at a time, mute, loads on first tap. |
| `js/sound-events.js` | Turns room changes and Cup Pong throws into scenario ids. |

Messages on the wire are `{t: kind, ...}`: `hello`, `propose`, `accept`, `decline`, `cancel`, `end`, and
`game` (which carries a game's own message, stamped with a session id so a late message from a game you
already left is dropped). `hello` carries a protocol version (`PROTOCOL_VERSION` in `js/room.js`); a
mismatch shows "ask your friend to refresh" instead of a silent hang.

## Adding a game

1. Add an entry to `GAMES` in `js/games.js`:
   `id, title, icon, tags, blurb, status, minPlayers, maxPlayers, load`, and optionally
   `layout: 'wide'` (a big stage instead of the 460px column) and `resumable: true`.
   `status: 'soon'` shows an unplayable "Soon" card.
2. Create `js/games/<id>/index.js` exporting `createGame({session, container})`. It may be async and
   returns `{destroy()}`. See `js/games/rps/index.js`.
   - `container` is an empty element the game owns until `destroy()`. Load your own CSS with
     `loadCss(new URL('./x.css', import.meta.url))` from `js/load-css.js`.
   - `session.players` is `[{id, name}]` sorted by id, the same order on both sides, so index 0 and 1
     are stable seats. `session.selfId`, `session.roomId` and `session.sid` identify you, the room and this game.
   - `session.send(msg)` sends to the other player. Set `session.onMessage = (msg, fromId) => {}` to receive.
     Messages that arrive before you set it are held and delivered once you do.
   - Call `session.finished({winnerId})` when the game is over (`winnerId` is omitted for a draw).
   - If `resumable: true`, the room waits about 20 seconds after a disconnect and calls
     `session.onPeerLeave(id)` and then `session.onPeerJoin(id)` if the same peer returns; resyncing state
     is the game's job. Otherwise a disconnect ends the game.
3. Keep rules and match state in a pure class with no DOM, and test it with `memorySessions()` from
   `js/memory-transport.js` (see `test/rps-match.test.js`). `js/crypto.js` has `sha256Hex` and `randomNonce`
   for commit-reveal.

## Features

- Cup Pong (`js/games/cup-pong/`): swipe to throw a ball at the other player's 10 cups, 5 rounds of 2 balls, one table bounce allowed,
  both balls in earns an extra turn, clearing every cup wins at once. Only the throw inputs travel; both sides replay them with the same
  deterministic physics (`physics.js`) and a mismatch is reported as a desync. A forgiveness helper (`aim-assist.js`) nudges near-misses.
  Resumable: a short connection drop is repaired by exchanging throw logs. Throwaway tuning pages: `preview/cup-pong-proto.html` (a tuning bench),
  `preview/cup-pong-match.html` (a match against a bot) and `preview/cup-pong-two.html` (the real game, two players on one page).
- Animated hands (`js/games/rps/hands-tube.js`): open, fist, three pumps while the network exchanges reveals, then both open at once.
- Player names and an optional room name (default room name "Kali Pahadi Ke Pichhe"), shared over the same P2P handshake.
  The name box starts with a random name from `DEFAULT_NAMES` in `js/names.js`; edit that list to change the pool.
- A name belongs to a room, not to you: it is saved with the room, so reopening that room's link, typing its code, or
  tapping it under "Recent rooms" brings the same name back. Nothing remembers a name across rooms or visits.
- Remembers your recent rooms in this browser (✕ forgets one). Saved data carries a version (`STORAGE_VERSION` in
  `js/storage.js`): older data is migrated, and data from a version this code does not understand is deleted on load.
- Invite by link, code, or QR (QR library is loaded from a CDN only when the QR is shown).
- `js/games/rps/hands3d.js` + `preview/hands3d.html`: an unfinished 3D-hands experiment (Three.js, WebXR generic hand model). Not used by the game yet.
- Animation previews: `preview/hands-tube.html`, `preview/hands3d.html`.

## Run locally

```bash
npm run serve        # http://localhost:8000
```

Open it in two windows. Click **Create room** in one, then open its invite link (or type its code) in the other,
and pick a game.

## Test

```bash
npm test             # Node's built-in runner, no dependencies to install
```

Covers the room protocol (proposals, simultaneous proposals, stale-session messages, leaving, reconnect
grace period, version mismatch, malformed input), Rock Paper Scissors rules and commit-reveal (including
tampering), full two-player matches over an in-memory transport, Cup Pong's physics, aim helper and match
(replay, desync, resume), room codes, names and storage.

```bash
npm run smoke        # headless Chrome, about 30 s; needs Google Chrome or Chromium (set CHROME=/path if not found)
```

The browser smoke test (`test/browser/smoke.html`, run by `scripts/smoke.mjs`) mounts every ready game from the
registry twice over the in-memory network and plays through the real UI: Rock Paper Scissors by clicking two
rounds, Cup Pong through the intro and coin flip and a real swipe. It also fails on any uncaught page error.
After every deploy, run it against the live site: `SMOKE_BASE=https://<user>.github.io/<repo>/ npm run smoke` (it also checks the main page loads
and that the served game list has both games).
`npm run live` goes further: two Chrome pages act as two real peers on the deployed site, find each other through the public relays,
join one room and play RPS and Cup Pong over real WebRTC (`node scripts/live-p2p.mjs <url>` for another site). It runs on one machine,
so it does not prove two different networks.
You can open the same page by hand at `/test/browser/smoke.html` after `npm run serve`.
The real network path is checked by hand: two tabs locally, then two devices on different networks.

## Deploy to GitHub Pages

1. Create a **public** GitHub repo (Pages on free accounts needs a public repo) and push this folder to `main`.
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. After about a minute the site is live at `https://<user>.github.io/<repo>/`.
4. Send a friend the invite link from the in-room **Copy invite link** button.

Every later `git push` to `main` redeploys automatically.

## Known limits (free tier)

- **Strict networks:** WebRTC uses free public STUN. Some corporate networks and carriers need a
  TURN relay, which is not free. If a friend cannot connect, try a different network.
- **Public relays:** discovery depends on public Nostr relays. If they are down, swap the import in
  `js/net.js` to the torrent or MQTT strategy (one-line change).
- **Friends only:** players trust each other's browsers. Commit-reveal stops peeking, but this is not
  cheat-proof against someone modifying their own client's score display.
- **No resume after a refresh:** game state lives only in the two browsers. Refreshing mid-game ends it;
  rejoin the room from "Recent rooms" and start again. Games that opt in with `resumable` survive a
  brief connection drop, not a reload.
- **Two players per room** for now.

## Not built yet

A room of more than two people (with a computed leader), a "room is full" screen, audio and video calls,
chat, a room-wide scoreboard, and de-duplicating identical display names (two players can still draw the
same random name, about a 1 in 25 chance).

## Sound

Moments in the game play short Hindi meme clips (a few wordless English ones, no English music).
The mapping is `SCENARIOS` in `js/sound-map.js`: add or remove a clip name there and run

```bash
npm run sfx
```

to copy the clips from the meme-music library (`SFX_LIBRARY=...` if it is not at the default path) into
`assets/sfx/`. `HELD_BACK` in that file lists clips left out on purpose. Players mute with the Sound
button in the room header; the choice is remembered. Browsers keep audio off until the first tap, so
the first tap anywhere on the page turns it on.

A game plays its own moments by calling `play('<scenario id>')` from `js/sound.js`. A game that plays
its win/lose/draw sound after its animation sets `ownsResultSound: true` in `js/games.js`; otherwise the
room plays it the moment the game reports a result.
