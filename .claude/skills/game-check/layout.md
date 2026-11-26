# Layout check

```bash
node scripts/room-check.mjs http://localhost:8000/ test-results/room-check
```

Two headless Chrome pages join one real room over WebRTC: a laptop (1280x720) and a phone (390x844, touch). They open
every game, wait 9 s, measure, save `NN-<game>-phone.jpg` and `-laptop.jpg`, and end the game. All 14 games take
about 4 minutes. `ONLY="Light Cycles"` takes titles as the catalog shows them; `DEEP=1` also presses the first big
button (deal, ready, start) so the measurement and screenshots come from the middle of a game.

1. **Run it** for the games you changed, once as is and once with `DEEP=1`.
2. **Read every screenshot**, phone and laptop. The numbers catch overflow; only your eyes catch clipped text,
   overlapping pieces, a result shown before its animation, or a colour that differs between the two players.
3. **Judge each WARN.** Controls below the fold are fine only when the player reaches them by scrolling at a natural
   moment (after reading a question, for example); a control needed every turn must fit. Tap targets under 32 px
   need a reason.
4. **Fix**, following the Layout section of the beautify-game house rules
   ([house-rules.md](../beautify-game/house-rules.md)), and re-run.

After a deploy, run it against the live site as well: `node scripts/room-check.mjs https://sakets594.github.io/p2p-rps/`.
