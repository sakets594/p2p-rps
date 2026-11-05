// A game brings its own stylesheet and loads it when it starts, so the room page
// never pays for games nobody plays. Resolves once the sheet has loaded (or failed:
// unstyled is better than stuck).
//
//   await loadCss(new URL('./rps.css', import.meta.url));

const loaded = new Map();

export function loadCss(url) {
  const href = String(url);
  if (!loaded.has(href)) {
    loaded.set(href, new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = link.onerror = () => resolve();
      document.head.append(link);
    }));
  }
  return loaded.get(href);
}
