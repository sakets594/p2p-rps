// Paint an element's rich CSS background once into a bitmap and use that instead. Firefox repaints gradients (conic and
// repeating ones above all) every time something on top of them moves; a bitmap is just copied. The look is unchanged.
//
//   const unbake = bake(el, ...)   re-bakes when the element's size changes; call unbake() when the game ends.
//
// Anything unexpected (no canvas, a blocked image) simply leaves the CSS background in place.

const PROPS = ['background-color', 'background-image', 'background-size', 'background-position', 'background-repeat'];

async function paint(el, style) {
  const w = Math.round(el.clientWidth); const h = Math.round(el.clientHeight);
  if (!w || !h) return null;
  const css = PROPS.map((p, i) => `${p}:${style[i]}`).join(';').replace(/&/g, '&amp;').replace(/"/g, "'").replace(/</g, '&lt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;${css}"></div></foreignObject></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const c = document.createElement('canvas');
  c.width = w * dpr; c.height = h * dpr;
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r));
  return blob && URL.createObjectURL(blob);
}

export function bake(...els) {
  if (typeof ResizeObserver !== 'function') return () => {};
  const state = new Map();
  let stopped = false;
  async function run(el) {
    const s = state.get(el);
    const size = `${el.clientWidth}x${el.clientHeight}`;
    if (stopped || s.busy || s.size === size || !el.clientWidth) return;
    s.busy = true;
    const ver = s.ver;
    try {
      // Read the CSS now, not when bake() was called: a theme class or a skin may have arrived since.
      el.style.background = '';
      const cs = getComputedStyle(el);
      const style = PROPS.map((p) => cs.getPropertyValue(p));
      const url = style[1].includes('url(') ? null : await paint(el, style); // images are already bitmaps
      if (!url) s.size = size;
      if (url && !stopped && ver === s.ver) {
        el.style.background = `url("${url}") 0 0 / 100% 100% no-repeat`;
        if (s.url) URL.revokeObjectURL(s.url);
        s.url = url; s.size = size;
      }
    } catch { s.size = size; /* keep the CSS background */ }
    s.busy = false;
    if (!stopped && (ver !== s.ver || s.size !== `${el.clientWidth}x${el.clientHeight}`)) run(el); // its size or skin changed meanwhile
  }
  const ro = new ResizeObserver((entries) => { for (const e of entries) run(e.target); });
  for (const el of els.flat().filter(Boolean)) {
    state.set(el, {size: '', ver: 0, url: null, busy: false});
    ro.observe(el);
  }
  // A new skin: drop the bitmap, read the new CSS background, paint again.
  const onSkin = () => requestAnimationFrame(() => {
    for (const [el, s] of state) {
      if (stopped) return;
      s.size = '';
      s.ver++;
      run(el);
    }
  });
  document.addEventListener('skinchange', onSkin);
  return () => {
    stopped = true;
    document.removeEventListener('skinchange', onSkin);
    ro.disconnect();
    for (const [el, s] of state) { el.style.background = ''; if (s.url) URL.revokeObjectURL(s.url); }
  };
}
