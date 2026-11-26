---
name: add-game
description: Add a new two-player game to this repo end to end (rules, network match, view, bots, tests, skins, clip). Use when asked to add, build or create a new game.
---

# Add a game

A game here is pure rules, a match that keeps two browsers in step over `session`, and a view. The game API
(`createGame`, `session.send`, `session.finished`, seats, resumable) is in the README under "Adding a game"; read it
first. Pick a game whose rules differ from the 14 already in `js/games.js`.

## Steps

1. **Rules and match.** Write `js/games/<id>/rules.js` (no DOM, no network) and pick the match pattern that fits:
   - both players see everything, one moves at a time: a rules object for `js/games/turn-match.js`, as Connect Four does;
   - something is hidden (a fleet, a choice, a word): commit by hash, reveal at the end, with `js/crypto.js`, as
     `battleship/match.js` and the RPS match do;
   - real time: lockstep, where only inputs travel and both sides run the same simulation, as `tron/match.js` does.

   *Done when* `test/<id>.test.js` plays full matches over `memorySessions()` to every ending (win, loss, draw if
   possible) and rejects cheating: a move out of turn, an illegal move, a repeated message, a reveal that does not
   match its hash.
2. **Register it.** Add the entry to `GAMES` in `js/games.js` (the fields are explained at the top of that file) and
   the id to `READY_IDS` in `scripts/smoke.mjs`. *Done when* `npm test` and `npm run smoke` pass.
3. **View.** `js/games/<id>/index.js` exporting `createGame({session, container})` that returns `{destroy()}`.
   *Done when* two local tabs in one room play a full match, and leaving mid-game stops every loop and sound.
4. **Bot.** Add a bot for both seats to `BOTS` in `preview/demo-bots.js`, playing real moves through the match or
   the view. Every later step depends on it. *Done when* `preview/game-demo.html?game=<id>` with `__demo.run()` plays to
   the end unattended.
5. **Look.** Run the `beautify-game` skill for the new game: its own place, motion and sound, three skins in
   `js/skins.js` with their `skins.css` (`test/skins.test.js` enforces this), and `ownsResultSound` if it stages its own
   ending. *Done when* that skill's steps are done.
6. **Check.** Run the `game-check` skill's layout, speed and sound checks for this game. *Done when* each passes or its
   warnings are explained.
7. **Show it.** Clip and poster into `assets/gameplay/<id>.mp4` and `.jpg`, a row in the README's Gameplay table, its
   skins in the README's Skins section, then `graphify update .`. *Done when* the README shows the game, and the
   report lists what was tested and what was not.
