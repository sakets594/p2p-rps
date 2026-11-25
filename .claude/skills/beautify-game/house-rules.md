# House rules for game views

**Fairness and truth**
- Seats own colours: seat A coral, seat B sky, on both screens. The app reserves `data-seat` (it swaps `--me`/`--them` for
  everything inside), so mark your own elements with another attribute unless you want that.
- A shape or mark backs up every colour difference.
- A timed game starts its clock after the opening card. Results wait for the animation that shows them.
- The room shows VICTORY/DEFEAT the moment a match finishes. A game that stages its own ending sets
  `ownsResultSound: true` in `js/games.js` and calls `resultSound()` (or plays `game.won`/`lost`/`draw`) itself.
- State never depends on an animation finishing: hidden tabs pause animation. Use a timer for anything that must happen.
- Every timer and listener checks that the game still exists; `destroy()` stops loops, tweens and sounds.

**Firefox speed** (the user plays on Firefox with a retina screen)
- `bake()` any conic, repeating or layered gradient that sits under moving things.
- Animate `transform` and `opacity` only; fade a scrim's opacity, never a background colour.
- Large box-shadows (inset above all) and rounded `overflow: hidden` around a moving layer halve the frame rate: use borders
  and square clips.
- Blur, `mix-blend-mode`, SVG turbulence and SVG pattern fills belong in a bitmap painted once.

**GSAP**
- GSAP freezes CSS `scale`/`rotate`/`translate` on any element it moves: give the moving element a child for CSS motion.
- Use `fromTo` with `clearProps` when a second tween could start before the first ends.
- Wrap `SplitText` targets in a plain block, since grid and flex parents turn each word into an item.

**Layout**
- Stage plus controls fit the window: cap the stage with `100dvh`, and check 390x844 and 1280x720.
- Text fits at phone width; `titleCard` shrinks long titles itself.
- Honour reduced motion with `calm()`.
- Art, sound and fonts need a licence that allows redistribution; record it in `vendor/README.md`.
