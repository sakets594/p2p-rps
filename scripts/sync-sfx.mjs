// Copies the clips that js/sound-map.js uses from the meme-music library into assets/sfx/,
// so the site is self-contained (GitHub Pages cannot read your assets folder).
//   npm run sfx            (set SFX_LIBRARY=/path/to/meme-music if it lives elsewhere)
// Run it again after changing the mapping; clips no longer used are removed.

import {copyFileSync, existsSync, mkdirSync, readdirSync, rmSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {allClips} from '../js/sound-map.js';

const LIBRARY = process.env.SFX_LIBRARY ?? '/Users/saket/workspace/assets/meme-music';
const OUT = resolve(fileURLToPath(new URL('../assets/sfx', import.meta.url)));

if (!existsSync(join(LIBRARY, 'audio'))) {
  console.error(`No library at ${LIBRARY}. Set SFX_LIBRARY=/path/to/meme-music.`);
  process.exit(2);
}

const wanted = new Set(allClips());
let copied = 0;
for (const clip of wanted) {
  const from = join(LIBRARY, 'audio', clip);
  if (!existsSync(from)) { console.error(`Missing in library: ${clip}`); process.exit(1); }
  const to = join(OUT, clip);
  mkdirSync(dirname(to), {recursive: true});
  copyFileSync(from, to);
  copied++;
}

let removed = 0;
function sweep(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sweep(path);
    else if (!wanted.has(relative(OUT, path))) { rmSync(path); removed++; }
  }
}
sweep(OUT);
console.log(`assets/sfx: ${copied} clips copied, ${removed} stale removed.`);
