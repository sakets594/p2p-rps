// Blind Draw: Draw & Guess where the drawer cannot see their own lines until the round is over.
import {mountGame} from './index.js';

export function createGame(args) { return mountGame({...args, mode: 'blind'}); }
