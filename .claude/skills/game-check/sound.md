# Sound check

```bash
node scripts/sound-check.mjs http://localhost:8000/
```

Bots play each game for 20 s in muted headless Chrome while a meter sits in front of the speakers: peak level,
loudness, clipped samples, seconds audible, how many synth sounds and meme clips played. `ONLY=tron,hangman` takes
game ids; `SECS=40` plays longer to reach the ending sounds. All 14 games take about 5 minutes.

Both players' screens run on one page, so the meter hears both at once: about twice as loud as one player hears.
A peak under 0.9 there leaves room for one player.

- **Clipping or a high peak:** a sound bypasses the limiter. Every synth sound must reach the speakers through
  `output(c)` in `js/synth.js`, never `ctx.destination` directly. Several loud sounds starting in the same moment add
  up; stagger them or lower the quieter one.
- **Silent:** the bot never reached a moment that makes sound, or the sound waits for a tap that the bot does not make.
  Check by playing the moment in `preview/game-demo.html?game=<id>` with the console open; each sound decision logs a
  `console.info` line.

The meter cannot tell whether a sound fits its moment or is pleasant; say that it was not checked by ear.
