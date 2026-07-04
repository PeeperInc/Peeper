'use strict';

const THEME_ID = 'root_king';
const DAILY_AP = 5;
const MAX_AP = 5;
const AP_REGEN_SECONDS = 3 * 60 * 60;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const ROLES = deepFreeze({
  knight: { stat: 'might', bonus: 3, ability: 'shield_wall' },
  scout: { stat: 'agility', bonus: 3, ability: 'reveal_room' },
  mage: { stat: 'arcana', bonus: 3, ability: 'reroll' },
  cleric: { stat: 'spirit', bonus: 3, ability: 'blessing' },
});

const PROVISIONS = deepFreeze({
  carrot_rations: {
    id: 'carrot_rations',
    name: 'Carrot Rations',
    recipe: { productId: 'carrot', quantity: 20 },
    effect: { type: 'grant_ap', config: { amount: 1, timing: 'after_preparation' } },
  },
  tomato_soup: {
    id: 'tomato_soup',
    name: 'Tomato Soup',
    recipe: { productId: 'tomato', quantity: 12 },
    effect: { type: 'prevent_debuff', config: { uses: 1 } },
  },
  hearty_potato_meal: {
    id: 'hearty_potato_meal',
    name: 'Hearty Potato Meal',
    recipe: { productId: 'potato', quantity: 10 },
    effect: { type: 'minimum_progress', config: { uses: 1, from: 0, to: 1 } },
  },
  lucky_breakfast: {
    id: 'lucky_breakfast',
    name: 'Lucky Breakfast',
    recipe: { productId: 'egg', quantity: 10 },
    effect: { type: 'roll_bonus', config: { uses: 1, amount: 2 } },
  },
  warm_milk: {
    id: 'warm_milk',
    name: 'Warm Milk',
    recipe: { productId: 'milk', quantity: 8 },
    effect: { type: 'restore_role_ability', config: { uses: 1, roomType: 'camp' } },
  },
  truffle_treat: {
    id: 'truffle_treat',
    name: 'Truffle Treat',
    recipe: { productId: 'truffle', quantity: 3 },
    effect: { type: 'upgrade_loot_rarity', config: { uses: 1, tiers: 1 } },
  },
  magic_squash_pie: {
    id: 'magic_squash_pie',
    name: 'Magic Squash Pie',
    recipe: { productId: 'magic_squash', quantity: 1 },
    effect: { type: 'raise_modified_roll', config: { uses: 1, below: 10, value: 10 } },
  },
});

const ROLE_BY_STAT = Object.freeze(Object.fromEntries(
  Object.entries(ROLES).map(([role, config]) => [config.stat, role]),
));

const ENCOUNTER_TYPE_BY_ROOM_TYPE = Object.freeze({
  combat: 'combat',
  trap: 'trap',
  arcane: 'puzzle',
  exploration: 'puzzle',
  treasure: 'treasure',
  shrine: 'shrine',
  camp: 'shrine',
  mystery: 'puzzle',
  boss: 'boss',
});

const DEFAULT_INTENT_BY_ENCOUNTER_TYPE = Object.freeze({
  combat: 'strike',
  trap: 'hide',
  treasure: 'trick',
  shrine: 'bless',
  puzzle: 'solve',
  boss: 'guard',
});

const ROOM_VISUALS = Object.freeze({
  root_guardians: { enemyId: 'rootbound_guard', enemyIntent: 'guard' },
  bone_sentinels: { enemyId: 'hollow_archer', enemyIntent: 'strike' },
  thorn_snare: { objectId: 'thorn_snare', enemyIntent: 'hide' },
  rune_darts: { objectId: 'rune_darts', enemyIntent: 'channel' },
  root_seal: { objectId: 'root_seal', enemyIntent: 'channel' },
  whispering_reliquary: { objectId: 'lantern_skull', enemyIntent: 'curse' },
  collapsed_gallery: { objectId: 'collapsed_gallery', enemyIntent: 'solve' },
  forgotten_crossroads: { objectId: 'forgotten_crossroads', enemyIntent: 'hide' },
  rootbound_vault: { objectId: 'rootbound_vault', enemyIntent: 'guard' },
  mimic_cache: { enemyId: 'vine_mimic', objectId: 'mimic_cache', enemyIntent: 'trick' },
  lantern_shrine: { objectId: 'lantern_shrine', enemyIntent: 'bless' },
  traveler_shrine: { objectId: 'traveler_shrine', enemyIntent: 'bless' },
  entrance_camp: { objectId: 'expedition_camp', enemyIntent: 'bless' },
  root_king_bargain: { enemyId: 'root_cultist', objectId: 'root_king_bargain', enemyIntent: 'curse' },
  sleeping_knight: { enemyId: 'rootbound_champion', objectId: 'sleeping_knight', enemyIntent: 'guard' },
  root_king_phase_1: { enemyId: 'rootbound_champion', enemyIntent: 'guard' },
  root_king_phase_2: { enemyId: 'rootbound_champion', enemyIntent: 'strike' },
  root_king_phase_3: { enemyId: 'rootbound_champion', enemyIntent: 'channel' },
});

function weakRolesForActions(actions = []) {
  const ranked = [...actions]
    .filter(candidate => ROLE_BY_STAT[candidate.stat])
    .sort((left, right) => (left.modifier ?? 0) - (right.modifier ?? 0));
  const roles = [];
  for (const action of ranked) {
    const role = ROLE_BY_STAT[action.stat];
    if (!roles.includes(role)) roles.push(role);
    if (roles.length >= 2) break;
  }
  return roles.length > 0 ? roles : ['knight'];
}

function miniMechanicForRoom(type, id) {
  if (type === 'boss') return { type: 'boss_phase' };
  if (type === 'trap') {
    return {
      type: 'route_choice',
      options: [
        { id: 'safe_path', label: 'Safe Path', effect: 'Less threat risk' },
        { id: 'fast_path', label: 'Fast Path', effect: 'Swingy progress' },
        { id: 'greedy_path', label: 'Greedy Path', effect: 'Better chest, riskier low roll' },
      ],
    };
  }
  if (type === 'treasure') {
    return {
      type: 'mimic_read',
      options: [
        { id: 'listen', label: 'Listen First', effect: 'Safer read' },
        { id: 'bait', label: 'Bait It', effect: 'More reward on a good read' },
      ],
    };
  }
  if (type === 'shrine' || type === 'camp') return { type: 'combat' };
  if (['arcane', 'exploration', 'mystery'].includes(type)) {
    return { type: 'symbol_puzzle', clueCount: id === 'root_king_bargain' ? 3 : 2 };
  }
  return { type: 'combat' };
}

function miniGameForRoom(type, id) {
  const games = {
    trap: {
      kind: 'timing_window',
      label: 'Dodge the trap',
      instruction: 'Stop the marker inside the gold window.',
    },
    arcane: {
      kind: 'rune_sequence',
      label: 'Repeat the runes',
      instruction: 'Tap the glowing runes in the shown order.',
      sequence: id === 'whispering_reliquary' ? ['moon', 'skull', 'rune'] : ['rune', 'root', 'moon'],
    },
    exploration: {
      kind: 'path_pick',
      label: 'Find the safe path',
      instruction: 'Pick the path with the green torch.',
    },
    shrine: {
      kind: 'focus_hold',
      label: 'Hold the blessing',
      instruction: 'Hold focus long enough, but release before it burns out.',
    },
    mystery: {
      kind: 'shadow_match',
      label: 'Read the shadow',
      instruction: 'Choose the matching shadow before it fades.',
    },
    treasure: {
      kind: 'timing_window',
      label: 'Open the cache',
      instruction: 'Stop the marker inside the gold window.',
    },
  };
  return games[type] || null;
}

function artifact(id, name, rarity, displayEffect, effect, behavior = { type: 'permanent' }) {
  return { id, name, rarity, displayEffect, behavior, effect };
}

const ARTIFACTS = deepFreeze({
  old_torch: artifact('old_torch', 'Old Torch', 'common', '+1 to dark-room checks',
    { type: 'roll_bonus', trigger: 'before_roll', config: { amount: 1, roomTags: ['dark'] } }),
  bent_sword: artifact('bent_sword', 'Bent Sword', 'common', '+1 Might',
    { type: 'roll_bonus', trigger: 'before_roll', config: { amount: 1, stats: ['might'] } }),
  chalk_rune: artifact('chalk_rune', 'Chalk Rune', 'common', 'One use: +2 Arcana',
    { type: 'roll_bonus', trigger: 'before_roll', config: { amount: 2, stats: ['arcana'] } },
    { type: 'consumable', consumeOnTrigger: true }),
  rabbit_foot: artifact('rabbit_foot', 'Rabbit Foot', 'common', '+1 to the first roll',
    { type: 'roll_bonus', trigger: 'before_roll', config: { amount: 1, limit: { count: 1, scope: 'expedition' } } }),
  rusty_buckle: artifact('rusty_buckle', 'Rusty Buckle', 'common', 'Assist grants +1 extra',
    { type: 'assist_bonus', trigger: 'before_assist', config: { amount: 1 } }),
  bone_die: artifact('bone_die', 'Bone Die', 'common', 'Reroll one natural 1',
    { type: 'reroll', trigger: 'after_roll', config: { rawRolls: [1], limit: { count: 1, scope: 'expedition' }, keep: 'new' } }),
  map_scrap: artifact('map_scrap', 'Map Scrap', 'common', 'Reveal one room hint',
    { type: 'reveal_room_hint', trigger: 'room_reveal', config: { count: 1 } },
    { type: 'consumable', consumeOnTrigger: true }),
  cracked_compass: artifact('cracked_compass', 'Cracked Compass', 'common', '+1 Exploration',
    { type: 'roll_bonus', trigger: 'before_roll', config: { amount: 1, roomTypes: ['exploration'] } }),
  ration_box: artifact('ration_box', 'Ration Box', 'common', 'Camp effects are slightly stronger',
    { type: 'camp_effect_bonus', trigger: 'after_progress', config: { amount: 1, roomTypes: ['camp'] } }),
  grave_salt: artifact('grave_salt', 'Grave Salt', 'common', '+2 against undead once',
    { type: 'roll_bonus', trigger: 'before_roll', config: { amount: 2, roomTags: ['undead'] } },
    { type: 'consumable', consumeOnTrigger: true }),
  copper_bell: artifact('copper_bell', 'Copper Bell', 'common', '+1 Spirit',
    { type: 'roll_bonus', trigger: 'before_roll', config: { amount: 1, stats: ['spirit'] } }),
  worn_gloves: artifact('worn_gloves', 'Worn Gloves', 'common', '+1 Agility',
    { type: 'roll_bonus', trigger: 'before_roll', config: { amount: 1, stats: ['agility'] } }),
  moss_amulet: artifact('moss_amulet', 'Moss Amulet', 'common', '+2 against root traps once',
    { type: 'roll_bonus', trigger: 'before_roll', config: { amount: 2, roomTypes: ['trap'], roomTags: ['root'] } },
    { type: 'consumable', consumeOnTrigger: true }),
  candle_stub: artifact('candle_stub', 'Candle Stub', 'common', 'Ignore one darkness penalty',
    { type: 'ignore_modifier', trigger: 'before_roll', config: { modifierTags: ['darkness'], limit: { count: 1, scope: 'expedition' } } }),
  lucky_button: artifact('lucky_button', 'Lucky Button', 'common', '+1 when rolling exactly 10',
    { type: 'roll_bonus', trigger: 'after_roll', config: { amount: 1, rawRolls: [10] } }),
  tiny_shovel: artifact('tiny_shovel', 'Tiny Shovel', 'common', '+1 Treasure checks',
    { type: 'roll_bonus', trigger: 'before_roll', config: { amount: 1, roomTypes: ['treasure'] } }),
  wooden_shield: artifact('wooden_shield', 'Wooden Shield', 'common', 'Reduce the first debuff',
    { type: 'reduce_debuff', trigger: 'before_debuff', config: { amount: 1, limit: { count: 1, scope: 'expedition' } } }),
  crow_feather: artifact('crow_feather', 'Crow Feather', 'common', '+1 hidden-room checks',
    { type: 'roll_bonus', trigger: 'before_roll', config: { amount: 1, actionTags: ['hidden_path'] } }),
  empty_vial: artifact('empty_vial', 'Empty Vial', 'common', 'Shrines may fill it with a buff',
    { type: 'store_shrine_buff', trigger: 'after_progress', config: { capacity: 1, roomTypes: ['shrine'] } }),
  rope_knot: artifact('rope_knot', 'Rope Knot', 'common', '+1 Trap checks',
    { type: 'roll_bonus', trigger: 'before_roll', config: { amount: 1, roomTypes: ['trap'] } }),

  rusty_lockpick: artifact('rusty_lockpick', 'Rusty Lockpick', 'rare', '3 charges: +4 Agility on locks',
    { type: 'roll_bonus', trigger: 'before_roll', config: { amount: 4, stats: ['agility'], actionTags: ['lock'] } },
    { type: 'charged', initialCharges: 3, consumeOnTrigger: true }),
  clerics_bell: artifact('clerics_bell', "Cleric's Bell", 'rare', 'First Spirit roll each day gets +3',
    { type: 'roll_bonus', trigger: 'before_roll', config: { amount: 3, stats: ['spirit'], limit: { count: 1, scope: 'day' } } }),
  loaded_die: artifact('loaded_die', 'Loaded Die', 'rare', 'One reroll per expedition',
    { type: 'reroll', trigger: 'after_roll', config: { limit: { count: 1, scope: 'expedition' }, keep: 'new' } }),
  family_banner: artifact('family_banner', 'Family Banner', 'rare', '+1 per helper, maximum +3',
    { type: 'helper_bonus', trigger: 'before_roll', config: { amountPerHelper: 1, maximum: 3 } }),
  rootcutters_axe: artifact('rootcutters_axe', "Rootcutter's Axe", 'rare', '+3 against root creatures',
    { type: 'roll_bonus', trigger: 'before_roll', config: { amount: 3, roomTags: ['root_creature'] } }),
  mirror_shard: artifact('mirror_shard', 'Mirror Shard', 'rare', 'Reflect one curse',
    { type: 'reflect_debuff', trigger: 'before_debuff', config: { debuffTypes: ['cursed'] } },
    { type: 'charged', initialCharges: 1, consumeOnTrigger: true }),
  silver_lantern: artifact('silver_lantern', 'Silver Lantern', 'rare', 'All dark-room rolls get +2',
    { type: 'roll_bonus', trigger: 'before_roll', config: { amount: 2, roomTags: ['dark'] } }),
  mapmakers_lens: artifact('mapmakers_lens', "Mapmaker's Lens", 'rare', 'Reveal one adjacent optional room',
    { type: 'reveal_adjacent_room', trigger: 'room_reveal', config: { optionalOnly: true, count: 1, limit: { count: 1, scope: 'expedition' } } }),
  goblin_coin: artifact('goblin_coin', 'Goblin Coin', 'rare', 'Rolls of 18+ may grant coins',
    { type: 'bonus_coins', trigger: 'before_loot', config: { minimumModifiedRoll: 18, chance: 0.5, coins: { min: 3, max: 7 } } }),
  thornward_ring: artifact('thornward_ring', 'Thornward Ring', 'rare', 'Ignore one root debuff',
    { type: 'prevent_debuff', trigger: 'before_debuff', config: { sourceTags: ['root'], limit: { count: 1, scope: 'expedition' } } }),
  echo_flute: artifact('echo_flute', 'Echo Flute', 'rare', 'Copy +2 support once',
    { type: 'copy_support', trigger: 'before_roll', config: { amount: 2 } },
    { type: 'charged', initialCharges: 1, consumeOnTrigger: true }),
  campfire_charm: artifact('campfire_charm', 'Campfire Charm', 'rare', 'Restore a role ability at camp',
    { type: 'restore_role_ability', trigger: 'after_progress', config: { roomTypes: ['camp'], limit: { count: 1, scope: 'expedition' } } }),
  mimic_whistle: artifact('mimic_whistle', 'Mimic Whistle', 'rare', 'Identify one false chest',
    { type: 'identify_mimic', trigger: 'room_reveal', config: { count: 1 } },
    { type: 'charged', initialCharges: 1, consumeOnTrigger: true }),
  warding_nail: artifact('warding_nail', 'Warding Nail', 'rare', 'Prevent one room complication',
    { type: 'prevent_complication', trigger: 'before_complication', config: { count: 1 } },
    { type: 'charged', initialCharges: 1, consumeOnTrigger: true }),
  second_chance_coin: artifact('second_chance_coin', 'Second Chance Coin', 'rare', 'Turn one roll below 5 into 5',
    { type: 'raise_raw_roll', trigger: 'after_roll', config: { below: 5, value: 5 } },
    { type: 'charged', initialCharges: 1, consumeOnTrigger: true }),
  scouts_monocle: artifact('scouts_monocle', "Scout's Monocle", 'rare', '+2 to hidden paths',
    { type: 'roll_bonus', trigger: 'before_roll', config: { amount: 2, actionTags: ['hidden_path'] } }),

  mimic_tooth: artifact('mimic_tooth', 'Mimic Tooth', 'epic', 'Treasure rooms may yield double coins',
    { type: 'multiply_coins', trigger: 'before_loot', config: { multiplier: 2, chance: 0.5, roomTypes: ['treasure'] } }),
  hourglass_shard: artifact('hourglass_shard', 'Hourglass Shard', 'epic', 'Recover 1 AP once',
    { type: 'recover_ap', trigger: 'after_roll', config: { amount: 1 } },
    { type: 'consumable', consumeOnTrigger: true }),
  phoenix_feather: artifact('phoenix_feather', 'Phoenix Feather', 'epic', 'Remove any debuff once',
    { type: 'clear_debuff', trigger: 'before_roll', config: { any: true } },
    { type: 'consumable', consumeOnTrigger: true }),
  crooked_compass: artifact('crooked_compass', 'Crooked Compass', 'epic', 'Open one hidden branch',
    { type: 'open_hidden_branch', trigger: 'room_reveal', config: { count: 1, limit: { count: 1, scope: 'expedition' } } }),
  blackroot_key: artifact('blackroot_key', 'Blackroot Key', 'epic', 'Instantly add progress to a sealed room',
    { type: 'add_room_progress', trigger: 'before_progress', config: { amount: 3, roomTags: ['sealed'] } },
    { type: 'consumable', consumeOnTrigger: true }),
  moonlit_d20: artifact('moonlit_d20', 'Moonlit d20', 'epic', '+3 to one roll each day',
    { type: 'roll_bonus', trigger: 'before_roll', config: { amount: 3, limit: { count: 1, scope: 'day' } } }),
  last_stand_banner: artifact('last_stand_banner', 'Banner of Last Stand', 'epic', 'Failed boss rolls still add progress',
    { type: 'minimum_progress', trigger: 'before_progress', config: { minimum: 1, roomTypes: ['boss'], whenProgressBelow: 1 } }),
  witch_bottle: artifact('witch_bottle', 'Witch Bottle', 'epic', 'Store and reuse one shrine buff',
    { type: 'store_shrine_buff', trigger: 'after_progress', config: { capacity: 1, reusable: true, roomTypes: ['shrine'] } }),
  gravekeepers_crown: artifact('gravekeepers_crown', "Gravekeeper's Crown", 'epic', '+4 Spirit against undead',
    { type: 'roll_bonus', trigger: 'before_roll', config: { amount: 4, stats: ['spirit'], roomTags: ['undead'] } }),
  hungry_satchel: artifact('hungry_satchel', 'Hungry Satchel', 'epic', 'Extra loot chance after three successes',
    { type: 'success_streak_loot', trigger: 'before_loot', config: { successesRequired: 3, chance: 0.5, drawback: { type: 'reset_streak', trigger: 'failed_attempt' } } },
    { type: 'cursed' }),
  emerald_heart: artifact('emerald_heart', 'Emerald Heart', 'epic', 'The first critical grants +1 AP',
    { type: 'recover_ap', trigger: 'after_roll', config: { amount: 1, criticalOnly: true, limit: { count: 1, scope: 'expedition' } } }),
  chain_of_favors: artifact('chain_of_favors', 'Chain of Favors', 'epic', 'Assisting also grants the helper +1 next roll',
    { type: 'grant_personal_roll_buff', trigger: 'after_assist', config: { amount: 1, uses: 1 } }),

  eye_of_dungeon: artifact('eye_of_dungeon', 'Eye of the Dungeon', 'legendary', 'Reveal every optional room',
    { type: 'reveal_all_optional_rooms', trigger: 'room_reveal', config: { limit: { count: 1, scope: 'expedition' } } }),
  crown_of_twenty: artifact('crown_of_twenty', 'Crown of Twenty', 'legendary', 'Natural 19 also counts as critical',
    { type: 'critical_threshold', trigger: 'after_roll', config: { minimumRawRoll: 19 } }),
  endless_candle: artifact('endless_candle', 'Endless Candle', 'legendary', '+5 in every dark room',
    { type: 'roll_bonus', trigger: 'before_roll', config: { amount: 5, roomTags: ['dark'] } }),
  root_kings_signet: artifact('root_kings_signet', "Root King's Signet", 'legendary', 'Boss actions gain +3 progress once per phase',
    { type: 'phase_progress_bonus', trigger: 'before_progress', config: { amount: 3, roomTypes: ['boss'], limit: { count: 1, scope: 'boss_phase' } } }),
  fates_broken_die: artifact('fates_broken_die', "Fate's Broken Die", 'legendary', 'Choose one of two d20 results once per day',
    { type: 'choose_roll', trigger: 'after_roll', config: { rolls: 2, choose: 'higher', limit: { count: 1, scope: 'day' } } }),
  door_without_key: artifact('door_without_key', 'Door Without a Key', 'legendary', 'Clear one non-boss sealed room instantly',
    { type: 'clear_room', trigger: 'before_progress', config: { excludeRoomTypes: ['boss'], requiredRoomTags: ['sealed'] } },
    { type: 'consumable', consumeOnTrigger: true }),
});

function action(id, label, stat, difficulty, modifier, tags, options = {}) {
  return {
    id,
    label,
    description: options.description || label,
    stat,
    difficulty,
    modifier,
    tags,
    narration: options.narration || { success: `${id}_success`, setback: `${id}_setback` },
    complication: options.complication || null,
    loot: options.loot || { coins: { min: 0, max: 3 }, artifactRolls: 0 },
  };
}

function room(id, type, name, progressTarget, tags, actions, extra = {}) {
  const encounterType = extra.encounterType || ENCOUNTER_TYPE_BY_ROOM_TYPE[type] || 'combat';
  const visual = ROOM_VISUALS[id] || {};
  const authoredActions = actions.map(authoredAction => ({ ...authoredAction, progressTarget }));
  const authoredRoom = {
    id,
    type,
    name,
    progressTarget,
    tags,
    encounterType,
    weakRoles: extra.weakRoles || weakRolesForActions(authoredActions),
    enemyIntent: extra.enemyIntent || visual.enemyIntent || DEFAULT_INTENT_BY_ENCOUNTER_TYPE[encounterType] || 'strike',
    threatMax: extra.threatMax || (type === 'boss' ? 8 : type === 'camp' ? 3 : 5),
    miniMechanic: extra.miniMechanic || miniMechanicForRoom(type, id),
    miniGame: extra.miniGame || miniGameForRoom(type, id),
    actions: authoredActions,
    ...extra,
  };
  const enemyId = extra.enemyId || visual.enemyId;
  const objectId = extra.objectId || visual.objectId || (!enemyId ? id : undefined);
  if (enemyId) authoredRoom.enemyId = enemyId;
  if (objectId) authoredRoom.objectId = objectId;
  return authoredRoom;
}

const ROOM_TEMPLATES = deepFreeze({
  combat: [
    room('root_guardians', 'combat', 'Root Guardians', 7, ['dark', 'root_creature'], [
      action('break_guard', 'Break their guard', 'might', 'risky', 2, ['weapon', 'root_creature']),
      action('flank_guard', 'Slip behind the roots', 'agility', 'risky', 2, ['root_creature']),
      action('burn_guard_runes', 'Unmake their binding runes', 'arcana', 'hard', 4, ['rune', 'root_creature']),
      action('banish_guard', 'Drive out the grave spirit', 'spirit', 'hard', 4, ['undead']),
    ]),
    room('bone_sentinels', 'combat', 'Bone Sentinels', 6, ['dark', 'undead'], [
      action('scatter_bones', 'Scatter the sentinels', 'might', 'easy', 0, ['weapon', 'undead']),
      action('turn_sentinels', 'Turn the restless dead', 'spirit', 'risky', 2, ['undead']),
    ]),
  ],
  trap: [
    room('thorn_snare', 'trap', 'Thorn Snare', 4, ['root', 'dark'], [
      action('cut_thorn_snare', 'Cut through the snare', 'might', 'risky', 2, ['root', 'trap']),
      action('slip_thorn_snare', 'Slip between the thorns', 'agility', 'easy', 0, ['root', 'trap']),
      action('calm_thorn_snare', 'Calm the hungry roots', 'spirit', 'hard', 4, ['root', 'trap']),
    ], { complication: 'frightened' }),
    room('rune_darts', 'trap', 'Rune-Dart Gallery', 4, ['rune'], [
      action('outrun_darts', 'Outrun the rune darts', 'agility', 'risky', 2, ['trap']),
      action('unwrite_darts', 'Unwrite the firing rune', 'arcana', 'easy', 0, ['rune', 'trap']),
    ], { complication: 'blinded' }),
  ],
  arcane: [
    room('root_seal', 'arcane', 'The Root Seal', 5, ['sealed', 'rune', 'dark'], [
      action('shatter_root_seal', 'Shatter the seal', 'might', 'hard', 4, ['sealed']),
      action('decode_root_seal', 'Decode the root script', 'arcana', 'easy', 0, ['sealed', 'rune']),
      action('purify_root_seal', 'Purify the binding', 'spirit', 'risky', 2, ['sealed', 'rune']),
    ]),
    room('whispering_reliquary', 'arcane', 'Whispering Reliquary', 5, ['cursed', 'undead'], [
      action('silence_reliquary', 'Silence the whispers', 'spirit', 'easy', 0, ['cursed', 'undead']),
      action('study_reliquary', 'Trace the curse', 'arcana', 'risky', 2, ['cursed', 'rune']),
    ], { complication: 'cursed' }),
  ],
  exploration: [
    room('collapsed_gallery', 'exploration', 'Collapsed Gallery', 5, ['dark', 'hidden_path'], [
      action('lift_gallery_stones', 'Lift the fallen stones', 'might', 'easy', 0, ['hidden_path']),
      action('thread_gallery_gap', 'Thread the narrow gap', 'agility', 'risky', 2, ['hidden_path']),
      action('map_gallery_echoes', 'Map the hollow echoes', 'arcana', 'hard', 4, ['hidden_path']),
    ]),
    room('forgotten_crossroads', 'exploration', 'Forgotten Crossroads', 4, ['hidden_path'], [
      action('track_crossroads', 'Track the old passage', 'agility', 'easy', 0, ['hidden_path']),
      action('consult_crossroads_dead', 'Ask the watchful dead', 'spirit', 'risky', 2, ['hidden_path', 'undead']),
    ]),
  ],
  treasure: [
    room('rootbound_vault', 'treasure', 'Rootbound Vault', 4, ['sealed', 'lock', 'root'], [
      action('force_vault', 'Force the vault door', 'might', 'hard', 4, ['lock', 'sealed']),
      action('pick_vault', 'Pick the rootbound lock', 'agility', 'risky', 2, ['lock', 'sealed']),
      action('command_vault', 'Command the ward to open', 'arcana', 'risky', 2, ['rune', 'sealed']),
    ], { optional: true, loot: { coins: { min: 8, max: 15 }, artifactRolls: 1 } }),
    room('mimic_cache', 'treasure', 'The Waiting Cache', 5, ['mimic', 'dark'], [
      action('wrestle_mimic', 'Wrestle the false chest', 'might', 'risky', 2, ['mimic']),
      action('bait_mimic', 'Bait the hidden jaws', 'agility', 'easy', 0, ['mimic']),
      action('expose_mimic', 'Expose its borrowed shape', 'spirit', 'hard', 4, ['mimic']),
    ], { optional: true, loot: { coins: { min: 10, max: 18 }, artifactRolls: 1 } }),
  ],
  shrine: [
    room('lantern_shrine', 'shrine', 'Shrine of Last Light', 4, ['shrine', 'dark'], [
      action('rekindle_shrine', 'Rekindle the old flame', 'arcana', 'risky', 2, ['shrine']),
      action('offer_shrine_prayer', 'Offer a steadfast prayer', 'spirit', 'easy', 0, ['shrine']),
    ], { reward: { type: 'shared_roll_bonus', stat: 'spirit', amount: 2, uses: 1 } }),
    room('traveler_shrine', 'shrine', 'Shrine of the Lost Road', 4, ['shrine', 'hidden_path'], [
      action('trace_shrine_path', 'Trace the vanished road', 'agility', 'risky', 2, ['shrine', 'hidden_path']),
      action('read_shrine_marks', 'Read the pilgrim marks', 'arcana', 'easy', 0, ['shrine', 'rune']),
    ], { reward: { type: 'shared_roll_bonus', stat: 'agility', amount: 2, uses: 1 } }),
  ],
  camp: [
    room('entrance_camp', 'camp', 'Expedition Camp', 1, ['camp'], [
      action('fortify_camp', 'Fortify the camp', 'might', 'easy', 0, ['camp']),
      action('survey_camp_routes', 'Survey the routes ahead', 'agility', 'easy', 0, ['camp', 'hidden_path']),
      action('study_camp_log', 'Study the expedition log', 'arcana', 'easy', 0, ['camp']),
      action('tend_campfire', 'Tend the warding fire', 'spirit', 'easy', 0, ['camp']),
    ], { startingRoom: true, recovery: { type: 'role_ability', amount: 1 } }),
  ],
  mystery: [
    room('root_king_bargain', 'mystery', "The Root King's Bargain", 4, ['cursed', 'root'], [
      action('refuse_bargain', 'Refuse the buried king', 'spirit', 'risky', 2, ['cursed']),
      action('outwit_bargain', 'Twist the bargain wording', 'arcana', 'hard', 4, ['cursed', 'rune']),
      action('steal_bargain_token', 'Steal the offered token', 'agility', 'hard', 4, ['cursed']),
    ], { choices: 3 }),
    room('sleeping_knight', 'mystery', 'The Sleeping Knight', 3, ['undead'], [
      action('wake_sleeping_knight', 'Wake the knight gently', 'spirit', 'easy', 0, ['undead']),
      action('search_sleeping_knight', 'Search the old armor', 'agility', 'risky', 2, ['undead']),
    ], { choices: 2 }),
  ],
  boss: [
    room('root_king_phase_1', 'boss', 'Break the Armor', 9, ['boss', 'root_creature', 'undead'], [
      action('break_king_armor', 'Break the bark armor', 'might', 'easy', 0, ['boss', 'root_creature']),
      action('find_king_weakpoint', 'Find a buried weak point', 'agility', 'risky', 2, ['boss', 'root_creature']),
      action('disrupt_king_runes', 'Disrupt the crown runes', 'arcana', 'risky', 2, ['boss', 'rune']),
      action('ward_king_retaliation', 'Ward the king\'s retaliation', 'spirit', 'hard', 4, ['boss', 'undead']),
    ], { phase: 1 }),
    room('root_king_phase_2', 'boss', 'Survive the Roots', 9, ['boss', 'root_creature'], [
      action('hold_back_roots', 'Hold back the root tide', 'might', 'risky', 2, ['boss', 'root']),
      action('evade_king_roots', 'Dance through the roots', 'agility', 'easy', 0, ['boss', 'root']),
      action('sever_root_magic', 'Sever the root magic', 'arcana', 'risky', 2, ['boss', 'rune']),
      action('sanctify_root_ground', 'Sanctify the tangled ground', 'spirit', 'easy', 0, ['boss', 'root']),
    ], { phase: 2, complication: 'frightened' }),
    room('root_king_phase_3', 'boss', 'Final Strike', 9, ['boss', 'root_creature', 'undead'], [
      action('final_might', 'Land the final blow', 'might', 'risky', 2, ['boss']),
      action('final_agility', 'Strike the exposed heart', 'agility', 'risky', 2, ['boss']),
      action('final_arcana', 'Unmake the root crown', 'arcana', 'risky', 2, ['boss', 'rune']),
      action('final_spirit', 'Banish the buried king', 'spirit', 'risky', 2, ['boss', 'undead']),
    ], { phase: 3, criticalBonusLootRolls: 1 }),
  ],
});

const PROGRESS_BANDS = deepFreeze([
  { max: 5, progress: 0 },
  { max: 10, progress: 1 },
  { max: 15, progress: 2 },
  { max: 19, progress: 3 },
  { max: Infinity, progress: 5 },
]);

const RARITY_WEIGHTS = deepFreeze({ common: 65, rare: 25, epic: 8, legendary: 2 });

module.exports = {
  THEME_ID,
  DAILY_AP,
  MAX_AP,
  AP_REGEN_SECONDS,
  ROLES,
  PROVISIONS,
  ARTIFACTS,
  ROOM_TEMPLATES,
  PROGRESS_BANDS,
  RARITY_WEIGHTS,
};
