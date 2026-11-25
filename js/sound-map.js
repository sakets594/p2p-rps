// Which meme clips can play for which moment in the game. Pure data and picking: no DOM,
// no audio, so it runs in the browser and in Node tests. Playing the clip is a later step.
//
// One scenario -> many clips; one is picked at random each time.
//
//   desi   file stems under audio/desi/ (Hindi / Bollywood). The default for every scenario.
//   en     file stems under audio/english/. Only wordless effects or one-word reactions whose
//          emotion needs no cultural context (oof, bruh, sad trombone). No English music, no
//          Hollywood references.
//   when   the moment, in words, and where the game can detect it
//   tier   1 = ship first, 2 = nice to have once tier 1 feels right
//   chance   optional, 0..1 (default 1): how often the moment makes a sound at all. Frequent moments
//          (an ordinary move) use a low chance so the memes stay a treat, not noise.
//   maxSecs  optional: play at most this long, then fade out (default DEFAULT_MAX_SECS).
//          Short reactions fire often; only the big moments get a long clip.
//
// Source library: /Users/saket/workspace/assets/meme-music (dataset.json has duration and mood).
// Scenario ids are '<scope>.<moment>': 'game.*' fires from the room for any game (it only needs
// session.finished); every other scope fires from that game's own module: rps, cp (cup pong),
// board (the turn-based board games), mm (memory match), db (dots and boxes), bs (battleship),
// hm (hangman), tv (trivia duel). A final move plays only the room's game.won/lost/draw, never both.

export const SCENARIOS = {
  // --- Room ---------------------------------------------------------------------------
  'room.friend_joined': {
    when: 'The other player shows up in the room',
    tier: 1,
    maxSecs: 6,
    desi: ['welcome_majnubhai', 'jalwa_hai_hamara', 'miracle_miracle'],
    en: [],
  },
  'room.friend_left': {
    when: 'The other player leaves the room',
    tier: 1,
    maxSecs: 6,
    desi: ['moye_moye_chorus', 'tmkoc_game_over'],
    en: ['sad_trombone_fail'],
  },
  'room.invite_received': {
    when: 'The friend proposes a game and the accept/decline bar appears',
    tier: 2,
    desi: ['systumm_faad_denge', 'jalwa_hai_hamara'],
    en: ['lil_jon_okay'],
  },
  'room.invite_declined': {
    when: 'The friend declines my proposal',
    tier: 2,
    desi: ['kehna_kya_chahte_ho', 'kya_gunda_banega_re_tu'],
    en: ['bruh_sound_effect'],
  },

  // --- Any game (fired from the room) -------------------------------------------------
  'game.start': {
    when: 'A game session begins',
    tier: 1,
    maxSecs: 5,
    desi: ['kgf_theme_bgm', 'systumm_faad_denge', 'khopdi_tod_saale_ka'],
    en: ['airhorn_rap'],
  },
  'game.won': {
    when: 'session.finished with me as the winner',
    tier: 1,
    maxSecs: 8,
    desi: ['moj_kardi_waah_bete', 'paisa_hi_paisa_hoga', 'jalwa_hai_hamara', 'kgf_theme_bgm', 'miracle_miracle'],
    en: ['airhorn_rap'],
  },
  'game.lost': {
    when: 'session.finished with my friend as the winner',
    tier: 1,
    maxSecs: 8,
    desi: ['moye_moye_chorus', 'tmkoc_game_over', 'maro_mujhe_maro', 'ekdum_se_waqt_badal_diya'],
    en: ['sad_trombone_fail', 'emotional_damage'],
  },
  'game.draw': {
    when: 'session.finished with no winner',
    tier: 1,
    maxSecs: 6,
    desi: ['kehna_kya_chahte_ho', 'kya_kar_raha_hai_tu', 'phir_hera_pheri_theme'],
    en: ['bruh_sound_effect'],
  },
  'game.friend_away': {
    when: 'The friend dropped mid-game and we are waiting for them to come back',
    tier: 2,
    desi: ['jaldi_bol_panvel', 'kehna_kya_chahte_ho'],
    en: [],
  },
  'game.friend_back': {
    when: 'The friend reconnected',
    tier: 2,
    desi: ['miracle_miracle', 'shabaash_beta'],
    en: [],
  },
  'game.error': {
    when: 'The game stopped on a protocol problem (desync, incompatible version)',
    tier: 2,
    desi: ['kya_kar_raha_hai_tu', 'kehna_kya_chahte_ho'],
    en: ['windows_xp_error', 'metal_pipe_falling'],
  },

  // --- Rock Paper Scissors ------------------------------------------------------------
  'rps.round_won': {
    when: 'Round result: I win',
    tier: 1,
    desi: ['shabaash_beta', 'jalwa_hai_hamara', 'moj_kardi_waah_bete', 'kaisa_laga_mera_mazaak', 'paisa_hi_paisa_hoga'],
    en: ['lil_jon_okay'],
  },
  'rps.round_lost': {
    when: 'Round result: I lose',
    tier: 1,
    desi: ['tmkoc_game_over', 'kya_gunda_banega_re_tu', 'ekdum_se_waqt_badal_diya', 'maro_mujhe_maro'],
    en: ['sad_trombone_fail', 'bruh_sound_effect'],
  },
  'rps.round_draw': {
    when: 'Round result: same move',
    tier: 1,
    desi: ['kehna_kya_chahte_ho', 'kya_kar_raha_hai_tu'],
    en: ['bruh_sound_effect', 'vine_boom_sound'],
  },
  'rps.friend_waiting': {
    when: 'The friend locked in and I have not picked after ~5 seconds',
    tier: 2,
    desi: ['jaldi_bol_panvel', 'kehna_kya_chahte_ho', 'kya_kar_raha_hai_tu'],
    en: [],
  },
  'rps.cheat_detected': {
    when: 'Their revealed move did not match their commit; round voided',
    tier: 2,
    desi: ['overacting_50_rupaye_kat', 'kya_kar_raha_hai_tu'],
    en: ['windows_xp_error'],
  },

  // --- Cup Pong (all from the throw event: hit, sim.rimHits, sim.bounces, extra) ------
  'cp.my_hit': {
    when: 'My ball drops into one of their cups',
    tier: 1,
    desi: ['jalwa_hai_hamara', 'moj_kardi_waah_bete', 'shabaash_beta', 'kaisa_laga_mera_mazaak'],
    en: ['lil_jon_okay', 'noice_click'],
  },
  'cp.their_hit': {
    when: 'The friend sinks one of my cups',
    tier: 1,
    desi: ['maro_mujhe_maro', 'ekdum_se_waqt_badal_diya', 'khopdi_tod_saale_ka'],
    en: ['roblox_oof', 'emotional_damage'],
  },
  'cp.my_miss': {
    when: 'My ball misses',
    tier: 1,
    desi: ['tmkoc_game_over', 'kehna_kya_chahte_ho', 'kya_gunda_banega_re_tu'],
    en: ['bruh_sound_effect', 'sad_trombone_fail'],
  },
  'cp.their_miss': {
    when: 'The friend misses',
    tier: 1,
    desi: ['nana_patekar_laugh', 'shabaash_beta', 'overacting_50_rupaye_kat', 'kaisa_laga_mera_mazaak'],
    en: [],
  },
  'cp.bounce_hit': {
    when: 'My bounce shot goes in (hit and sim.bounces > 0)',
    tier: 2,
    desi: ['miracle_miracle', 'systumm_faad_denge', 'jalwa_hai_hamara'],
    en: ['airhorn_rap'],
  },
  'cp.near_miss': {
    when: 'My ball hit the rim and still missed (miss and sim.rimHits > 0)',
    tier: 2,
    desi: ['maro_mujhe_maro', 'kehna_kya_chahte_ho'],
    en: ['bruh_sound_effect'],
  },
  'cp.extra_turn': {
    when: 'Both balls went in, so the thrower goes again',
    tier: 1,
    desi: ['paisa_hi_paisa_hoga', 'miracle_miracle', 'moj_kardi_waah_bete'],
    en: ['airhorn_rap'],
  },
  'cp.all_cups': {
    when: 'I cleared every cup (over.reason is "cups"); the loser hears game.lost',
    tier: 1,
    maxSecs: 7,
    desi: ['kgf_theme_bgm', 'systumm_faad_denge', 'jalwa_hai_hamara'],
    en: ['airhorn_rap'],
  },
  // --- Turn-based board games: tic-tac-toe, connect four, dots and boxes, memory match -------
  'board.my_move': {
    when: 'I place a mark, drop a disc or draw a line (not the move that ends the game)',
    tier: 2,
    chance: 0.2,
    maxSecs: 2,
    desi: ['jalwa_hai_hamara', 'kaisa_laga_mera_mazaak', 'shabaash_beta'],
    en: ['lil_jon_okay'],
  },
  'board.their_move': {
    when: 'The friend makes a move (not the one that ends the game)',
    tier: 2,
    chance: 0.2,
    maxSecs: 2,
    desi: ['kya_gunda_banega_re_tu', 'kehna_kya_chahte_ho', 'overacting_50_rupaye_kat'],
    en: ['bruh_sound_effect'],
  },
  'board.slow_move': {
    when: 'It has been my turn for 25 seconds and I have not moved',
    tier: 1,
    desi: ['jaldi_bol_panvel', 'kya_kar_raha_hai_tu', 'kehna_kya_chahte_ho'],
    en: [],
  },

  // --- Memory Match -------------------------------------------------------------------
  'mm.my_match': {
    when: 'I flip a matching pair',
    tier: 1,
    maxSecs: 3,
    desi: ['moj_kardi_waah_bete', 'shabaash_beta', 'miracle_miracle', 'jalwa_hai_hamara'],
    en: ['noice_click'],
  },
  'mm.their_match': {
    when: 'The friend finds a pair',
    tier: 1,
    maxSecs: 3,
    desi: ['maro_mujhe_maro', 'khopdi_tod_saale_ka', 'ekdum_se_waqt_badal_diya'],
    en: ['roblox_oof'],
  },
  'mm.combo': {
    when: 'I find two or more pairs in a row (plays instead of mm.my_match)',
    tier: 1,
    maxSecs: 4,
    desi: ['paisa_hi_paisa_hoga', 'systumm_faad_denge', 'jalwa_hai_hamara'],
    en: ['airhorn_rap'],
  },
  'mm.my_miss': {
    when: 'My two cards do not match',
    tier: 1,
    chance: 0.7,
    maxSecs: 2.5,
    desi: ['kehna_kya_chahte_ho', 'tmkoc_game_over', 'kya_gunda_banega_re_tu'],
    en: ['bruh_sound_effect'],
  },
  'mm.their_miss': {
    when: 'The friend\'s two cards do not match',
    tier: 2,
    chance: 0.5,
    maxSecs: 2.5,
    desi: ['nana_patekar_laugh', 'shabaash_beta', 'kaisa_laga_mera_mazaak'],
    en: [],
  },

  // --- Dots and Boxes -----------------------------------------------------------------
  'db.my_box': {
    when: 'I close a box (and move again)',
    tier: 1,
    maxSecs: 2.5,
    desi: ['jalwa_hai_hamara', 'moj_kardi_waah_bete', 'shabaash_beta', 'kaisa_laga_mera_mazaak'],
    en: ['lil_jon_okay'],
  },
  'db.their_box': {
    when: 'The friend closes a box',
    tier: 1,
    maxSecs: 2.5,
    desi: ['maro_mujhe_maro', 'khopdi_tod_saale_ka', 'ekdum_se_waqt_badal_diya'],
    en: ['roblox_oof'],
  },

  // --- Battleship ---------------------------------------------------------------------
  'bs.battle_start': {
    when: 'Both fleets are locked in and the shooting begins',
    tier: 1,
    maxSecs: 4,
    desi: ['systumm_faad_denge', 'khopdi_tod_saale_ka', 'kgf_theme_bgm'],
    en: ['airhorn_rap'],
  },
  'bs.my_miss': {
    when: 'My shot hits only water',
    tier: 1,
    maxSecs: 2.5,
    desi: ['kehna_kya_chahte_ho', 'tmkoc_game_over', 'kya_gunda_banega_re_tu'],
    en: ['bruh_sound_effect', 'sad_trombone_fail'],
  },
  'bs.my_hit': {
    when: 'My shot hits a ship',
    tier: 1,
    maxSecs: 3,
    desi: ['jalwa_hai_hamara', 'moj_kardi_waah_bete', 'kaisa_laga_mera_mazaak', 'shabaash_beta'],
    en: ['lil_jon_okay', 'vine_boom_sound'],
  },
  'bs.my_sunk': {
    when: 'My shot sinks a whole ship (not the last one)',
    tier: 1,
    maxSecs: 5,
    desi: ['kgf_theme_bgm', 'paisa_hi_paisa_hoga', 'systumm_faad_denge', 'miracle_miracle'],
    en: ['airhorn_rap'],
  },
  'bs.their_miss': {
    when: 'The friend\'s shot misses my fleet',
    tier: 1,
    maxSecs: 2.5,
    desi: ['nana_patekar_laugh', 'shabaash_beta', 'overacting_50_rupaye_kat'],
    en: [],
  },
  'bs.their_hit': {
    when: 'The friend hits one of my ships',
    tier: 1,
    maxSecs: 3,
    desi: ['maro_mujhe_maro', 'khopdi_tod_saale_ka', 'ekdum_se_waqt_badal_diya'],
    en: ['roblox_oof', 'emotional_damage'],
  },
  'bs.their_sunk': {
    when: 'The friend sinks one of my ships (not my last one)',
    tier: 1,
    maxSecs: 5,
    desi: ['moye_moye_chorus', 'tmkoc_game_over', 'maro_mujhe_maro', 'ekdum_se_waqt_badal_diya'],
    en: ['sad_trombone_fail', 'emotional_damage'],
  },

  // --- Hangman (the guesser calls letters, the setter watches) -------------------------
  'hm.right_mine': {
    when: 'I guessed a letter that is in the word',
    tier: 1,
    maxSecs: 2.5,
    desi: ['shabaash_beta', 'jalwa_hai_hamara', 'kaisa_laga_mera_mazaak'],
    en: ['noice_click'],
  },
  'hm.wrong_mine': {
    when: 'I guessed a letter that is not in the word',
    tier: 1,
    maxSecs: 2.5,
    desi: ['kya_gunda_banega_re_tu', 'kehna_kya_chahte_ho', 'tmkoc_game_over'],
    en: ['bruh_sound_effect'],
  },
  'hm.friend_right': {
    when: 'The friend guessed a letter of my word',
    tier: 1,
    maxSecs: 2.5,
    desi: ['maro_mujhe_maro', 'kehna_kya_chahte_ho', 'khopdi_tod_saale_ka'],
    en: ['roblox_oof'],
  },
  'hm.friend_wrong': {
    when: 'The friend guessed a letter that is not in my word',
    tier: 1,
    maxSecs: 2.5,
    desi: ['nana_patekar_laugh', 'kaisa_laga_mera_mazaak', 'shabaash_beta'],
    en: [],
  },
  'hm.round_won': {
    when: 'I won the round (word found, or the friend was hanged); not the last round',
    tier: 1,
    maxSecs: 5,
    desi: ['moj_kardi_waah_bete', 'paisa_hi_paisa_hoga', 'jalwa_hai_hamara', 'miracle_miracle'],
    en: ['airhorn_rap'],
  },
  'hm.round_lost': {
    when: 'I lost the round; not the last round',
    tier: 1,
    maxSecs: 5,
    desi: ['moye_moye_chorus', 'tmkoc_game_over', 'maro_mujhe_maro'],
    en: ['sad_trombone_fail'],
  },

  // --- Draw & Guess / Blind Draw ------------------------------------------------------
  'dg.right_mine': {
    when: 'I guessed the drawing (not the last round)',
    tier: 1,
    maxSecs: 3,
    desi: ['shabaash_beta', 'jalwa_hai_hamara', 'kaisa_laga_mera_mazaak'],
    en: ['noice_click'],
  },
  'dg.friend_right': {
    when: 'The friend guessed my drawing (not the last round)',
    tier: 1,
    maxSecs: 3,
    desi: ['moj_kardi_waah_bete', 'jalwa_hai_hamara'],
    en: ['airhorn_rap'],
  },
  'dg.time_up': {
    when: 'Time ran out and nobody guessed it (not the last round)',
    tier: 1,
    maxSecs: 4,
    desi: ['moye_moye_chorus', 'tmkoc_game_over'],
    en: ['sad_trombone_fail'],
  },

  // --- Light Cycles ---------------------------------------------------------------------
  'tr.round_won': {
    when: 'My bike outlasted the friend\'s (not the last round)',
    tier: 1,
    maxSecs: 4,
    desi: ['moj_kardi_waah_bete', 'jalwa_hai_hamara'],
    en: ['airhorn_rap'],
  },
  'tr.round_lost': {
    when: 'I crashed first (not the last round)',
    tier: 1,
    maxSecs: 4,
    desi: ['moye_moye_chorus', 'tmkoc_game_over'],
    en: ['sad_trombone_fail'],
  },

  // --- Quick Draw -----------------------------------------------------------------------
  'qd.round_won': {
    when: 'I fired first and won the duel (not the last one)',
    tier: 1,
    maxSecs: 4,
    desi: ['shabaash_beta', 'jalwa_hai_hamara', 'moj_kardi_waah_bete'],
    en: ['airhorn_rap'],
  },
  'qd.round_lost': {
    when: 'The friend fired first, or I jumped the gun (not the last duel)',
    tier: 1,
    maxSecs: 4,
    desi: ['moye_moye_chorus', 'kya_gunda_banega_re_tu', 'tmkoc_game_over'],
    en: ['sad_trombone_fail', 'bruh_sound_effect'],
  },

  // --- Trivia Duel --------------------------------------------------------------------
  'tv.right': {
    when: 'My answer was right (not the last question)',
    tier: 1,
    maxSecs: 3,
    desi: ['shabaash_beta', 'moj_kardi_waah_bete', 'jalwa_hai_hamara', 'miracle_miracle'],
    en: ['noice_click', 'lil_jon_okay'],
  },
  'tv.wrong': {
    when: 'My answer was wrong (not the last question)',
    tier: 1,
    maxSecs: 3,
    desi: ['tmkoc_game_over', 'kya_gunda_banega_re_tu', 'maro_mujhe_maro'],
    en: ['bruh_sound_effect', 'sad_trombone_fail'],
  },
  'tv.timeout': {
    when: 'I ran out of time without answering (not the last question)',
    tier: 1,
    maxSecs: 3,
    desi: ['jaldi_bol_panvel', 'kya_kar_raha_hai_tu', 'kehna_kya_chahte_ho'],
    en: ['bruh_sound_effect'],
  },
  'tv.streak': {
    when: 'My second right answer in a row, or more (plays instead of tv.right)',
    tier: 1,
    maxSecs: 4,
    desi: ['systumm_faad_denge', 'paisa_hi_paisa_hoga', 'jalwa_hai_hamara'],
    en: ['airhorn_rap'],
  },
  'tv.hurry': {
    when: 'Four seconds left on the clock and I have not answered',
    tier: 2,
    chance: 0.6,
    maxSecs: 3,
    desi: ['jaldi_bol_panvel', 'kehna_kya_chahte_ho'],
    en: [],
  },

  // A hit that fills the extra-turn condition plays cp.extra_turn instead of cp.my_hit, so one
  // clip covers the moment. The friend's bounce shots and extra turns just play cp.their_hit.
  // Deliberately silent: 'TURN SWITCH' and round changes. They happen every few seconds.
};

// Clips that exist in the library but are not mapped on purpose, so nobody wonders later.
export const HELD_BACK = {
  khatam_tata_bye_bye: 'Political (a politician meme). A friends game should not pick sides.',
  kitne_tejaswi_log_hai: 'Political (a politician speech).',
  aaiye_aapka_intezaar_tha: 'Sarcastic-welcome meme tied to a political event. Unsure; your call.',
  tu_samjha_haan: 'Needs the interview context to land.',
  // Every english/*music* clip, plus these: Hollywood / Western references or needs context.
  fbi_open_up: 'American police reference.',
  gta_v_wasted: 'Game reference, English title card.',
  among_us_role_reveal: 'Game reference.',
  wait_a_minute_who_are_you: 'Needs the song for context.',
  hold_up_wait_a_minute: 'Needs the song for context.',
  stop_wait_a_minute: 'Needs the song for context.',
  sike_wrong_number: 'Needs the original clip.',
  hehe_boi_ainsley: 'Needs the original clip.',
  oh_hell_naw: 'Slang; the shorter reactions already cover this.',
  oh_my_god_wow: 'Too long (6.6s) for a reaction.',
};

export const DEFAULT_MAX_SECS = 4.5;

/** Longest a scenario's clip may play before fading out. */
export function maxSecsFor(scenarioId) {
  return SCENARIOS[scenarioId]?.maxSecs ?? DEFAULT_MAX_SECS;
}

/** How often a scenario makes a sound when its moment happens, 0..1. */
export function chanceFor(scenarioId) {
  return SCENARIOS[scenarioId]?.chance ?? 1;
}

export function scenarioIds() {
  return Object.keys(SCENARIOS);
}

/** Every clip a scenario may play, as paths relative to the audio folder: 'desi/x.mp3'. */
export function clipsFor(scenarioId) {
  const s = SCENARIOS[scenarioId];
  if (!s) return [];
  return [...s.desi.map((c) => `desi/${c}.mp3`), ...s.en.map((c) => `english/${c}.mp3`)];
}

/** Every clip any scenario uses, de-duplicated: what to copy into the repo. */
export function allClips() {
  return [...new Set(scenarioIds().flatMap(clipsFor))].sort();
}

/**
 * Pick one clip at random for a scenario, never the one picked last time for it
 * (pass `last`, the previous return value) unless it is the only choice.
 * `rng` is injectable for tests.
 */
export function pickClip(scenarioId, {last = null, rng = Math.random} = {}) {
  const all = clipsFor(scenarioId);
  const pool = all.length > 1 ? all.filter((c) => c !== last) : all;
  return pool.length ? pool[Math.floor(rng() * pool.length)] : null;
}
