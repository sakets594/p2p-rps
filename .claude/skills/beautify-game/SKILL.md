---
name: beautify-game
description: Give a game in this repo a full visual identity (scene, motion, sound, endings) or a new skin. Use when asked to beautify, restyle, reskin or add "wow" to a game, or when adding a new game that needs its look.
---

# Beautify a game

For a **new skin** only: add it to `SKINS` in `js/skins.js`, style it under `[data-skin="<id>"]` in the game's `skins.css` (canvas
games: add the same id to the view's theme table), then run steps 4 to 7. View all skins with `preview/skins.html?game=<id>`. A skin
changes the place (materials, light, type, backdrop), and keeps seat colours and layout.

Make the game feel like a *place*: a stage with its own light, materials, type and sound, where every rule event has a
visible consequence. Rules and match files stay untouched; only the view, its CSS and (for canvas games) its drawing change.

## Steps

1. **See it.** Play the current version with `preview/game-demo.html?game=<id>` (`await __demo.run()`); if it has no bot in
   `preview/demo-bots.js`, write one first. *Done when* you have screenshots of the opening, mid-game, a scoring moment and
   the end, and a list of every event the match emits.
2. **Pick the place.** Write one sentence naming a real-world setting that fits the rules (chalkboard, war room, quiz show),
   a palette, one display font from `css/fonts.css`, and what each event from step 1 looks and sounds like there.
   *Done when* every event has an answer and no other game uses that place.
3. **Build it.** Use `js/juice.js` for motion, `js/synth.js` for sound, `js/fx.js` for particles, `js/bake.js` for rich
   backgrounds. Follow [the house rules](house-rules.md). *Done when* every event from step 1 has its answer on screen.
4. **Look hard.** Record a bot match in Firefox and read a 12-frame contact sheet, then screenshot the opening, mid-game and
   end at full size. Fix what you see: clipped text, things that vanish mid-move, results shown before their animation,
   colours that differ between the two screens, controls below the fold. *Done when* a full pass finds nothing.
5. **Measure.** In Firefox, sample `requestAnimationFrame` over 12 s of bot *play* with the second column hidden, and compare
   with the old version the same way. *Done when* p95 is at most 18.5 ms. To find a culprit, hide one layer at a time.
6. **Prove it.** `npm test`, `npm run smoke`, then `node scripts/live-p2p.mjs http://localhost:8000/` (real room, real
   WebRTC). *Done when* all three pass; a test changed on purpose is named in the report.
7. **Show it.** Re-encode the clip and poster into `assets/gameplay/`, update the README and run `graphify update .`.
   Report what is different, what was measured, and what was not checked.
