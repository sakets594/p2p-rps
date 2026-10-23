# P2P Rock Paper Scissors

Frontend-only multiplayer game. No game server, no backend, no cost.

- **Hosting:** static files on GitHub Pages (free, HTTPS, which WebRTC needs).
- **Connecting:** [Trystero](https://github.com/dmotz/trystero) uses free public Nostr relays only to
  introduce the two browsers. After that, all game traffic is direct WebRTC.
- **Fairness:** no referee, so moves use commit-reveal (each player sends a SHA-256 hash of
  `room|round|move|nonce` first, reveals later, and the other side verifies it).
- **Room code:** 6 characters from `crypto.getRandomValues` XOR-mixed with `Date.now()`.

## Features

- Animated hands (`js/hands-tube.js`): open, fist, three pumps while the network exchanges reveals, then both open at once.
- Player names and an optional room name (defaults: Ramcharan when creating, Kalicharan when joining, room "Kali Pahadi Ke Pichhe"), shared over the same P2P handshake.
- Invite by link, code, or QR (QR library is loaded from a CDN only when the QR is shown).
- `js/hands3d.js` + `preview/hands3d.html`: an unfinished 3D-hands experiment (Three.js, WebXR generic hand model). Not used by the game yet.
- Animation previews: `preview/hands-tube.html`, `preview/hands3d.html`.

## Run locally

```bash
npm run serve        # http://localhost:8000
```

Open it in two windows. Click **Create game** in one, then open its invite link (or type its code) in the other.

## Test

```bash
npm test             # Node's built-in runner, no dependencies to install
```

Covers game rules, commit-reveal (including tampering), room codes, and full two-player
matches over an in-memory transport (cheating, disconnects, third players, malformed input).
The real network path is checked by hand: two tabs locally, then two devices on different networks.

## Deploy to GitHub Pages

1. Create a **public** GitHub repo (Pages on free accounts needs a public repo) and push this folder to `main`.
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. After about a minute the game is live at `https://<user>.github.io/<repo>/`.
4. Send a friend the invite link from the in-game **Copy invite link** button.

Every later `git push` to `main` redeploys automatically.

## Known limits (free tier)

- **Strict networks:** WebRTC uses free public STUN. Some corporate networks and carriers need a
  TURN relay, which is not free. If a friend cannot connect, try a different network.
- **Public relays:** discovery depends on public Nostr relays. If they are down, swap the import in
  `js/net.js` to the torrent or MQTT strategy (one-line change).
- **Friends only:** two players trust each other's browsers. Commit-reveal stops peeking, but this is not
  cheat-proof against someone modifying their own client's score display.
