// Real transport: Trystero over free public infrastructure (Nostr relays by
// default). Peers find each other through the room code; after that the game
// traffic goes straight browser-to-browser over WebRTC.
//
// To switch discovery network, change the import to e.g.
//   https://esm.sh/@trystero-p2p/torrent@0.26.0   (BitTorrent trackers)
//   https://esm.sh/@trystero-p2p/mqtt@0.26.0      (public MQTT brokers)
import {joinRoom, selfId} from 'https://esm.sh/trystero@0.26.0';

// Namespaces our rooms so we never meet other Trystero apps.
const APP_ID = 'saket-p2p-rps-v1';

export function createTransport(roomId) {
  const room = joinRoom({appId: APP_ID}, roomId);
  const action = room.makeAction('rps');

  const transport = {
    selfId,
    onMessage: () => {},
    onPeerJoin: () => {},
    onPeerLeave: () => {},
    send: (msg, peerId) => action.send(msg, {target: peerId}),
    leave: () => room.leave(),
  };

  action.onMessage = (data, {peerId}) => transport.onMessage(data, peerId);
  room.onPeerJoin = (peerId) => transport.onPeerJoin(peerId);
  room.onPeerLeave = (peerId) => transport.onPeerLeave(peerId);
  return transport;
}
