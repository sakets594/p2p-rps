// The Quick Draw scene, drawn as inline SVG: layered sky, a glowing sun, mesas with lit edges, a little town (saloon,
// water tower, fence), cactus and bones in the foreground, and two shaded cowboys rigged for poses. The view moves a
// camera over it by tweening the viewBox (wide shot, push-in, close-ups on the eyes and the gun hands).
// Look: classes and custom properties in quick-draw.css (`data-time` sets the time of day). Poses: s-idle, s-ready,
// s-draw, s-fire, s-hit, s-misfire, s-win, plus `twitch` and `squint`.

export const VIEW = {w: 400, h: 240};
const SCALE = 1.25;
export const COWBOY = {left: {x: 104, y: 204}, right: {x: 296, y: 204}};
/** Camera shots in scene units: [x, y, width] (height follows the 5:3 frame). */
export function shot(name, side = 'left') {
  const c = COWBOY[side];
  const dir = side === 'left' ? 1 : -1;
  const at = (x, y, w) => [x - w / 2, y - (w * 0.6) / 2, w];
  switch (name) {
    case 'wide': return [0, 0, 400];
    case 'push': return [28, 30, 344];
    case 'eyes': return at(c.x + dir * 4 * SCALE, c.y - 74 * SCALE, 92);
    case 'down': return at(c.x - dir * 40, c.y - 22, 190);
    case 'hand': return at(c.x + dir * 14 * SCALE, c.y - 40 * SCALE, 96);
    case 'medium': return at(c.x, c.y - 52 * SCALE, 150);
    default: return [0, 0, 400];
  }
}
export const viewBox = ([x, y, w]) => `${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${(w * 0.6).toFixed(1)}`;

function cowboy(side) {
  const flip = side === 'right';
  const {x, y} = COWBOY[side];
  return `
  <g transform="translate(${x} ${y}) scale(${flip ? -SCALE : SCALE} ${SCALE})">
    <ellipse class="qd-shadow" cx="4" cy="1" rx="26" ry="4.5"/>
    <g class="qd-cow qd-${side} s-idle" data-side="${side}">
      <g class="qd-fall"><g class="qd-sway">
        <path class="qd-leg" d="M-10 -31 h8 l1 31 h-9 z"/>
        <path class="qd-leg qd-leg-b" d="M2 -31 h8 l1 31 h-9 z"/>
        <path class="qd-chap" d="M-11 -30 h9 l-1 18 h-7 z"/>
        <rect class="qd-boot" x="-13" y="-6" width="13" height="6" rx="2"/>
        <rect class="qd-boot" x="2" y="-6" width="15" height="6" rx="2"/>
        <circle class="qd-spur" cx="-13" cy="-3" r="2.4"/>
        <path class="qd-torso" d="M-13 -58 q13 -6 26 0 l1 28 h-28 z"/>
        <path class="qd-vest" d="M-13 -58 q6 -3 9 -2 l2 30 h-12 z M13 -58 q-6 -3 -9 -2 l-2 30 h12 z"/>
        <path class="qd-torso-shade" d="M4 -59 q6 0 9 1 l1 28 h-10 z"/>
        <rect class="qd-belt" x="-14" y="-33" width="28" height="5" rx="1"/>
        <rect class="qd-buckle" x="-3" y="-34" width="6" height="7" rx="1"/>
        <path class="qd-holster" d="M8 -31 h8 l-1 14 q-3 3 -6 0 z"/>
        <path class="qd-bandana" d="M-11 -59 L11 -59 L2 -47 Z"/>
        <rect class="qd-neck" x="-4" y="-63" width="8" height="5"/>
        <circle class="qd-head" cx="0" cy="-71" r="11"/>
        <path class="qd-stubble" d="M-6 -66 q6 7 13 1 l-1 4 q-6 4 -11 -1 z"/>
        <path class="qd-brow" d="M2 -76 l8 1"/>
        <ellipse class="qd-eye" cx="6" cy="-72" rx="1.9" ry="1.9"/>
        <path class="qd-stache" d="M2 -66 q5 3 10 0"/>
        <path class="qd-ear" d="M-7 -73 q-4 2 0 5"/>
        <g class="qd-hat">
          <path class="qd-brim" d="M-22 -79 q22 -7 44 0 q-22 6 -44 0 z"/>
          <path class="qd-crown" d="M-12 -80 q-1 -15 6 -17 q6 3 12 0 q7 2 6 17 z"/>
          <path class="qd-band" d="M-12 -84 q12 3 24 0 v4 q-12 3 -24 0 z"/>
          <path class="qd-hat-shine" d="M-7 -94 q2 -2 4 -1"/>
        </g>
        <g transform="translate(9 -53)"><g class="qd-arm">
          <rect class="qd-sleeve" x="0" y="-4" width="24" height="8" rx="4"/>
          <circle class="qd-hand" cx="25" cy="0" r="5"/>
          <g class="qd-gun" transform="translate(27 -2)">
            <rect class="qd-barrel" x="0" y="-4" width="19" height="5.5" rx="1.5"/>
            <rect class="qd-cyl" x="1" y="-5" width="7" height="7.5" rx="2"/>
            <path class="qd-grip" d="M-3 0 h7 l2 10 h-7 z"/>
          </g>
          <g class="qd-flash" transform="translate(48 -1)"><path d="M0 -14 L5 -5 L16 -9 L9 0 L17 8 L5 5 L0 14 L-4 5 L-14 8 L-8 0 L-14 -9 L-4 -5 Z"/><circle r="5"/></g>
        </g></g>
      </g></g>
    </g>
  </g>`;
}

export function sceneSVG() {
  return `
<svg class="qd-svg" viewBox="0 0 400 240" role="img" aria-label="A desert showdown at the edge of town: two cowboys face each other">
  <defs>
    <linearGradient id="qd-sky" x1="0" y1="0" x2="0" y2="1">
      <stop class="qd-s1" offset="0"/><stop class="qd-s2" offset=".55"/><stop class="qd-s3" offset="1"/>
    </linearGradient>
    <radialGradient id="qd-glow"><stop class="qd-glow-in" offset="0"/><stop class="qd-glow-out" offset="1"/></radialGradient>
    <linearGradient id="qd-dirt" x1="0" y1="0" x2="0" y2="1"><stop class="qd-d1" offset="0"/><stop class="qd-d2" offset="1"/></linearGradient>
  </defs>
  <rect class="qd-sky" x="-50" y="-50" width="500" height="215" fill="url(#qd-sky)"/>
  <g class="qd-stars"><circle cx="40" cy="22" r="1.6"/><circle cx="110" cy="48" r="1.2"/><circle cx="170" cy="16" r="1.8"/><circle cx="250" cy="40" r="1.3"/><circle cx="330" cy="20" r="1.7"/><circle cx="372" cy="58" r="1.2"/><circle cx="290" cy="70" r="1.1"/><circle cx="205" cy="62" r="1"/><circle cx="72" cy="70" r="1.1"/></g>
  <g class="qd-sunwrap">
    <circle class="qd-sunglow" r="58" fill="url(#qd-glow)"/>
    <g class="qd-rays">${Array.from({length: 12}, (_, i) => `<path d="M0 0 L${(Math.cos((i * 30 - 4) * Math.PI / 180) * 90).toFixed(1)} ${(Math.sin((i * 30 - 4) * Math.PI / 180) * 90).toFixed(1)} L${(Math.cos((i * 30 + 4) * Math.PI / 180) * 90).toFixed(1)} ${(Math.sin((i * 30 + 4) * Math.PI / 180) * 90).toFixed(1)} Z"/>`).join('')}</g>
    <circle class="qd-sun" r="17"/>
  </g>
  <g class="qd-cloud qd-cloud1"><ellipse cx="0" cy="0" rx="28" ry="8"/><ellipse cx="14" cy="-6" rx="16" ry="8"/><ellipse cx="-12" cy="-4" rx="14" ry="6"/></g>
  <g class="qd-cloud qd-cloud2"><ellipse cx="0" cy="0" rx="22" ry="6"/><ellipse cx="10" cy="-5" rx="12" ry="6"/></g>
  <g class="qd-birds"><path d="M0 0 q4 -4 8 0 q4 -4 8 0"/><path d="M14 8 q3 -3 6 0 q3 -3 6 0"/></g>
  <!-- far range -->
  <path class="qd-mesa qd-mesa-far" d="M-10 160 L-10 120 L20 120 L30 104 L78 104 L88 122 L130 122 L140 160 Z"/>
  <path class="qd-mesa qd-mesa-far" d="M140 160 L150 134 L186 134 L194 122 L230 122 L238 138 L262 138 L270 160 Z"/>
  <!-- near butte with a lit top edge -->
  <path class="qd-mesa" d="M240 162 L254 120 L276 120 L286 92 L340 92 L350 120 L380 120 L410 162 Z"/>
  <path class="qd-mesa-lit" d="M286 92 L340 92 L343 99 L289 99 Z M254 120 L276 120 L274 125 L252 126 Z"/>
  <path class="qd-mesa-crease" d="M300 100 l-6 60 M326 100 l4 60 M362 122 l6 38"/>
  <!-- town: saloon front, water tower, fence -->
  <g class="qd-town">
    <rect class="qd-wood" x="14" y="118" width="62" height="42"/>
    <path class="qd-wood" d="M10 118 h70 v-12 h-14 v-4 h-42 v4 h-14 z"/>
    <text class="qd-sign" x="45" y="113" text-anchor="middle">SALOON</text>
    <rect class="qd-door" x="38" y="136" width="14" height="24"/>
    <path class="qd-door-line" d="M45 138 v20"/>
    <rect class="qd-win" x="20" y="128" width="11" height="12"/><rect class="qd-win" x="59" y="128" width="11" height="12"/>
    <path class="qd-porch" d="M8 160 h74 v-3 h-74 z M14 140 v20 M76 140 v20"/>
    <g class="qd-tower"><path class="qd-wood" d="M214 122 h30 v-16 q-15 -7 -30 0 z"/><path class="qd-leg-wood" d="M218 122 l-4 38 M240 122 l4 38 M216 140 h26"/></g>
    <path class="qd-fence" d="M100 160 v-10 M114 160 v-10 M128 160 v-10 M142 160 v-10 M98 152 h46 M98 157 h46"/>
  </g>
  <rect class="qd-ground" x="-50" y="158" width="500" height="132" fill="url(#qd-dirt)"/>
  <path class="qd-horizon" d="M-50 158.5 H450"/>
  <path class="qd-road" d="M-50 192 Q200 186 450 192 L450 214 Q200 208 -50 214 Z"/>
  <path class="qd-ruts" d="M-50 199 Q200 194 450 199 M-50 207 Q200 202 450 207"/>
  <g class="qd-cactus" transform="translate(26 170)"><path d="M-5 4 v-34 q5 -6 10 0 v34 z"/><path d="M-5 -10 h-6 q-4 0 -4 -4 v-10 q3 -3 6 0 v7 h4 z"/><path d="M5 -16 h6 q4 0 4 -4 v-8 q-3 -3 -6 0 v5 h-4 z"/><path class="qd-rib" d="M0 2 v-30"/></g>
  <g class="qd-cactus" transform="translate(374 176) scale(.8)"><path d="M-5 4 v-34 q5 -6 10 0 v34 z"/><path d="M-5 -10 h-6 q-4 0 -4 -4 v-10 q3 -3 6 0 v7 h4 z"/><path class="qd-rib" d="M0 2 v-30"/></g>
  <g class="qd-rocks"><ellipse cx="60" cy="230" rx="11" ry="4.5"/><ellipse cx="206" cy="226" rx="7" ry="3"/><ellipse cx="350" cy="232" rx="12" ry="4.5"/></g>
  <g class="qd-skull" transform="translate(176 230)"><path d="M-9 -2 q0 -9 9 -9 q9 0 9 9 l-2 4 h-14 z"/><circle class="qd-socket" cx="-3.5" cy="-3" r="2"/><circle class="qd-socket" cx="3.5" cy="-3" r="2"/><path d="M-14 -6 q-6 -6 -12 -3 M14 -6 q6 -6 12 -3"/></g>
  <g class="qd-weed"><g class="qd-weed-spin"><circle r="9"/><path d="M-9 0 H9 M0 -9 V9 M-6 -6 L6 6 M6 -6 L-6 6"/><circle r="5"/></g></g>
  ${cowboy('left')}
  ${cowboy('right')}
  <path class="qd-tracer" d="M0 0 L1 0"/>
  <g class="qd-dust"></g>
  <g class="qd-crow"><path d="M0 0 q6 -9 12 0 q6 -9 12 0" /></g>
  <g class="qd-gust"><ellipse cx="0" cy="0" rx="26" ry="5"/><ellipse cx="22" cy="10" rx="20" ry="4"/><ellipse cx="-12" cy="-10" rx="16" ry="3"/></g>
  <g class="qd-tufts"><path d="M90 240 q2 -10 4 0 q2 -12 4 0 q2 -9 4 0 z"/><path d="M250 240 q2 -9 4 0 q2 -11 4 0 z"/><path d="M318 240 q2 -12 4 0 q2 -8 4 0 q2 -10 4 0 z"/></g>
</svg>`;
}
