---
name: game-check
description: Check a game in this repo for layout, speed or sound problems and find the cause. Use when asked to check, test or measure a game; when a game is cut off on a phone, stutters, freezes or feels slow, or sounds too loud, clipped or silent; and after changing any game's view.
---

# Check a game

Three checks, each a script that bots or two real peers drive, so every run does the same thing. Start the site first
(`npm run serve`, or `preview_start` with `serve`). The limits live in each script's header; the files below say how
to run each check and how to find the cause when it fails.

| Problem | Check | How |
| --- | --- | --- |
| Cut off, below the fold, too small to tap, page scrolls sideways | layout, real room, laptop + phone | [layout.md](layout.md) |
| Stutter, freeze, slow | speed, Firefox, normal + retina | [speed.md](speed.md) |
| Too loud, clipping, silent | sound, every sound through a meter | [sound.md](sound.md) |

After changing a game's view, run all three for that game. Before a commit that touches several games, run all three
for every game.

*Done when* each check you ran prints PASS or a WARN you can explain, and for each FAIL you have either fixed it and
re-run the check, or named the cause.

Report one line per check: what ran, PASS/WARN/FAIL with the numbers against the limit, the cause of any failure, and
what was not covered. None of these checks covers a physical phone, a real retina screen, two separate networks, or
listening by ear, so list whichever of those applies.
