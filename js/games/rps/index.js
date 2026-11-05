// Rock Paper Scissors, as a room game. The room loads this module when a game
// starts and calls createGame; the game returns an object with destroy().
//
//   createGame({session, container}) -> Promise<{destroy()}>
//     session    from the room: players, send, onMessage, finished (see js/room.js)
//     container  an empty element this game owns until destroy()

import {loadCss} from '../../load-css.js';
import {RpsMatch} from './match.js';
import {mountRpsView} from './view.js';

export async function createGame({session, container}) {
  await loadCss(new URL('./rps.css', import.meta.url));
  const myName = session.players.find((p) => p.id === session.selfId)?.name ?? 'You';

  let view = null;
  const match = new RpsMatch({session, onChange: (s) => view?.update(s)});
  view = mountRpsView({container, match, myName});
  view.update(match.snapshot());

  return {
    destroy() {
      view.destroy();
      match.destroy();
    },
  };
}
