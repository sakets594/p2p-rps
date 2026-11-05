// Cup Pong, as a room game. The room loads this module when a game starts and calls
// createGame; the game returns an object with destroy().
//
//   createGame({session, container}) -> Promise<{destroy()}>
//     session    from the room: players, send, onMessage, finished (see js/room.js)
//     container  an empty element this game owns until destroy()

import {loadCss} from '../../load-css.js';
import {CupPongMatch} from './match.js';
import {mountCupPongView} from './view.js';

export async function createGame({session, container}) {
  await loadCss(new URL('./cup-pong.css', import.meta.url));
  let view = null;
  const match = new CupPongMatch({session, onEvent: (ev) => view?.onEvent(ev)});
  view = mountCupPongView({container, match});
  view.start(match.snapshot()); // events that happened before the view existed

  return {
    destroy() {
      view.destroy();
      match.destroy();
    },
  };
}
