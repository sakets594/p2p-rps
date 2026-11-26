# Speed check

Measure in **Firefox** (the Firefox MCP tools): it stalls where Chrome does not, and headless Chrome has no real
display, so its frame times mean nothing. Measure one page at a time: two measurements, or a build, running at once
share the CPU and graphics card and both read slow.

`preview/speed.html` lets the bots play each game for 3 s and then records every frame for 12 s, with only Alice's
screen showing, as one player sees it. It shows a table and fills `window.__speed = {done, now, idle, results}`.

1. **Normal screen.** Viewport 1440x900, open `http://localhost:8000/preview/speed.html?runs=3&games=<ids>` (leave out
   `games` for all 14). Wait with `evaluate_script` and a long timeout, repeated until done:
   `async () => { for (let i = 0; i < 110 && !__speed.done; i++) await new Promise(r => setTimeout(r, 1000)); return __speed.done ? __speed : __speed.now }`
   with `timeout: 120000`. Each game takes about 16 s per run.
2. **Retina.** Viewport 2880x1800 and add `&zoom=2`. A retina screen paints four times the pixels, so costly effects
   show up here first.
3. **Read it.** Compare each game with the empty page (`idle`): that is this machine's floor. `late` is the share of
   frames over 25 ms (visible stutter), `longest` the worst freeze, `perSecond` the worst frame in each second.
   p95 sits at about 18.3 ms even on an empty page, so it hides most problems; judge by late frames and freezes.
4. **Compare** with the version before your change, measured the same way in the same session: numbers from another
   day or machine are not comparable. Run-to-run noise is about 1 point of late frames.

## Finding the cause

- **When:** a freeze at the same second in every run is one event (a round starting, cards dealt, a font or a big
  texture loading). Late frames spread across every second are a cost paid every frame.
- **Which layer:** re-run the one game with `&hide=<selector>` (for example `&hide=.bs-sweep`), hiding one layer at a
  time. The layer whose hiding brings it back to the floor is the cause.
- **Which function:** `profiler_start`, play the bad moment, `profiler_stop`; the profile names the slow function or
  paint.

Fixes follow the Speed and GSAP sections of the beautify-game house rules ([house-rules.md](../beautify-game/house-rules.md)).
A game that cannot be made cheap enough can switch to a lighter look when frames run late, as Battleship and Light
Cycles do (`watchPace` in `js/juice.js`).
