// The catalog of games. Adding a game = adding one entry here (plus its module).
// Pure data and filtering: no DOM, so it runs in the browser and in Node tests.
//
//   id      stable slug, used in the room's messages (a proposal names the game by id)
//   icon    emoji shown on the card, no image assets to host
//   tags    categories shown as pills and used by the tag filter
//   status  'ready' is playable; 'soon' shows a "Coming soon" card that cannot be opened
//   minPlayers / maxPlayers   how many people it takes (the room is two people for now)
//   layout  'column' (default, the 460px column) or 'wide' (a big stage, e.g. a 3D table)
//   resumable  true if the game can carry on after a short disconnect (it keeps its own log)
//   load    () => import(...) of the game module, only called when a game starts; it exports
//           createGame({session, container}) -> {destroy()}   (see js/games/rps/index.js)

export const GAMES = [
  {
    id: 'rps',
    title: 'Rock Paper Scissors',
    icon: '✊',
    tags: ['Classic', 'Quick', 'Party'],
    minPlayers: 2,
    maxPlayers: 2,
    blurb: 'Animated hands, provably fair moves. Best played out loud.',
    status: 'ready',
    load: () => import('./games/rps/index.js'),
  },
  {
    id: 'cup-pong',
    title: 'Cup Pong',
    icon: '🥤',
    tags: ['Arcade', 'Sports', 'Party'],
    minPlayers: 2,
    maxPlayers: 2,
    blurb: 'Swipe to throw, bounce it in, clear their cups. Five rounds, two balls a turn.',
    status: 'ready',
    resumable: true,
    load: () => import('./games/cup-pong/index.js'),
  },
  {
    id: 'tic-tac-toe',
    title: 'Tic-Tac-Toe',
    icon: '⭕',
    tags: ['Classic', 'Board', 'Quick'],
    minPlayers: 2,
    maxPlayers: 2,
    blurb: 'Three in a row. The warm-up everyone knows.',
    status: 'soon',
  },
  {
    id: 'connect-four',
    title: 'Connect Four',
    icon: '🔴',
    tags: ['Board', 'Strategy'],
    minPlayers: 2,
    maxPlayers: 2,
    blurb: 'Drop discs, line up four before your friend does.',
    status: 'soon',
  },
  {
    id: 'battleship',
    title: 'Battleship',
    icon: '🚢',
    tags: ['Board', 'Strategy'],
    minPlayers: 2,
    maxPlayers: 2,
    blurb: 'Hide your fleet, guess theirs.',
    status: 'soon',
  },
  {
    id: 'memory-match',
    title: 'Memory Match',
    icon: '🧠',
    tags: ['Puzzle', 'Quick'],
    minPlayers: 2,
    maxPlayers: 2,
    blurb: 'Flip cards, find pairs, remember where they were.',
    status: 'soon',
  },
  {
    id: 'dots-and-boxes',
    title: 'Dots and Boxes',
    icon: '🔲',
    tags: ['Board', 'Puzzle', 'Strategy'],
    minPlayers: 2,
    maxPlayers: 2,
    blurb: 'Close the boxes, steal the chains.',
    status: 'soon',
  },
  {
    id: 'hangman',
    title: 'Hangman',
    icon: '🔤',
    tags: ['Word', 'Party'],
    minPlayers: 2,
    maxPlayers: 2,
    blurb: 'One picks a word, the other guesses letters.',
    status: 'soon',
  },
  {
    id: 'trivia-duel',
    title: 'Trivia Duel',
    icon: '❓',
    tags: ['Party', 'Quick'],
    minPlayers: 2,
    maxPlayers: 2,
    blurb: 'Same questions, fastest right answer wins.',
    status: 'soon',
  },
];

export const DEFAULT_GAME_ID = 'rps';

export function playersLabel({minPlayers, maxPlayers}) {
  return minPlayers === maxPlayers ? `${minPlayers} players` : `${minPlayers}\u2013${maxPlayers} players`;
}

export function findGame(id, games = GAMES) {
  return games.find((g) => g.id === id) ?? null;
}

/** Every tag in use, alphabetical, for the filter chips. */
export function allTags(games = GAMES) {
  return [...new Set(games.flatMap((g) => g.tags))].sort((a, b) => a.localeCompare(b));
}

/**
 * Games matching a search box and an optional tag.
 * Every word typed must appear in the title, blurb or a tag (case-insensitive),
 * so "board quick" finds quick board games. Playable games come before upcoming ones.
 */
export function filterGames({query = '', tag = null} = {}, games = GAMES) {
  const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  return games
    .filter((g) => !tag || g.tags.includes(tag))
    .filter((g) => {
      const haystack = [g.title, g.blurb, ...g.tags].join(' ').toLowerCase();
      return terms.every((t) => haystack.includes(t));
    })
    .sort((a, b) => (a.status === 'ready' ? 0 : 1) - (b.status === 'ready' ? 0 : 1));
}
