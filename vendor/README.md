# Vendored libraries

Copied from npm so the site works with no build step and no CDN at play time. Game views load them only when needed
(`import('../../vendor/...')`), so the room page does not pay for them.

| Folder | Package | Version | License |
|---|---|---|---|
| `gsap/` | [gsap](https://gsap.com) (core, CSSPlugin, SplitText, CustomEase and `utils/paths.js`, unmodified) | 3.15.1 | GSAP standard no-charge license, https://gsap.com/standard-license (all plugins, including SplitText, are free) |
| `pixi/pixi.min.js` | [pixi.js](https://pixijs.com) `dist/pixi.min.mjs` | 8.23.0 | MIT |
| `pixi/pixi-filters.js` | [pixi-filters](https://github.com/pixijs/filters) `dist/pixi-filters.mjs`, with its `from"pixi.js"` import rewritten to `./pixi.min.js` (renamed from `.mjs`, which some static servers send with the wrong type) | 6.1.5 | MIT |

To update: `npm install --no-save gsap@X pixi.js@Y pixi-filters@Z`, copy the same files again, and redo the one-line
import rewrite in `pixi-filters.js`.

Fonts in `assets/fonts/` come from Fontsource (latin subset, woff2): Bungee, Orbitron and Rye (OFL-1.1), Permanent Marker
and Luckiest Guy (Apache-2.0).
