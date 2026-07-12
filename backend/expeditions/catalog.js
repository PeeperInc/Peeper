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
  knight: { ability: 'shield_wall' },
  scout: { ability: 'reveal_room' },
  mage: { ability: 'damage_boost' },
  cleric: { ability: 'blessing' },
});

const PROVISIONS = deepFreeze({
  carrot_rations: {
    id: 'carrot_rations',
    name: 'Carrot Rations',
    recipe: { productId: 'carrot', quantity: 20 },
    effect: { type: 'grant_ap', config: { amount: 1, timing: 'after_preparation' } },
    manualEffect: 'restore_ap',
    description: 'Restore 1 AP when you choose to eat it.',
  },
  tomato_soup: {
    id: 'tomato_soup',
    name: 'Tomato Soup',
    recipe: { productId: 'tomato', quantity: 12 },
    effect: { type: 'prevent_debuff', config: { uses: 1 } },
    manualEffect: 'heal_self',
    description: 'Restore 1 HP to your wounded hero.',
  },
  hearty_potato_meal: {
    id: 'hearty_potato_meal',
    name: 'Hearty Potato Meal',
    recipe: { productId: 'potato', quantity: 10 },
    effect: { type: 'damage_bonus', config: { uses: 1, amount: 2 } },
    manualEffect: 'next_hit_damage',
    description: 'Add +2 damage to your next successful attack.',
  },
  lucky_breakfast: {
    id: 'lucky_breakfast',
    name: 'Lucky Breakfast',
    recipe: { productId: 'egg', quantity: 10 },
    effect: { type: 'damage_bonus', config: { uses: 1, amount: 1 } },
    manualEffect: 'room_damage_bonus',
    description: 'Add +1 damage to every successful attack in the current room.',
  },
  warm_milk: {
    id: 'warm_milk',
    name: 'Warm Milk',
    recipe: { productId: 'milk', quantity: 8 },
    effect: { type: 'restore_role_ability', config: { uses: 1, roomType: 'camp' } },
    manualEffect: 'restore_role_ability',
    description: 'Immediately restore your class ability.',
  },
  truffle_treat: {
    id: 'truffle_treat',
    name: 'Truffle Treat',
    recipe: { productId: 'truffle', quantity: 3 },
    effect: { type: 'upgrade_loot_rarity', config: { uses: 1, tiers: 1 } },
    manualEffect: 'upgrade_loot_rarity',
    description: 'Upgrade the rarity table of your next artifact reward.',
  },
  magic_squash_pie: {
    id: 'magic_squash_pie',
    name: 'Magic Squash Pie',
    recipe: { productId: 'magic_squash', quantity: 1 },
    effect: { type: 'damage_bonus', config: { uses: 1, amount: 3 } },
    manualEffect: 'next_hit_damage',
    description: 'Add +3 damage to your next successful attack.',
  },
});

// Kept only for authored encounter flavor and legacy action labels. These
// mappings no longer grant a roll modifier in combat.
const ROLE_BY_STAT = Object.freeze({
  might: 'knight',
  agility: 'scout',
  arcana: 'mage',
  spirit: 'cleric',
});

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

function artifact(id, name, rarity, useType, displayEffect, effect) {
  return { id, name, rarity, useType, displayEffect, effect };
}

const ARTIFACTS = deepFreeze({
  old_torch: artifact('old_torch', 'Old Torch', 'common', 'expedition_passive',
    '+10% minigame limits and timing windows', { kind: 'minigame_time', multiplier: 1.1 }),
  bent_sword: artifact('bent_sword', 'Bent Sword', 'common', 'expedition_passive',
    'Non-boss combat rolls 16-19 deal +1 damage', { kind: 'combat_damage_bonus', minRoll: 16, maxRoll: 19, amount: 1 }),
  chalk_rune: artifact('chalk_rune', 'Chalk Rune', 'common', 'active',
    '+3 seconds to the next minigame in this room', { kind: 'minigame_time_once', seconds: 3 }),
  rabbit_foot: artifact('rabbit_foot', 'Rabbit Foot', 'common', 'expedition_passive',
    'Prevent the first personal combat damage', { kind: 'prevent_personal_damage', uses: 1 }),
  bone_die: artifact('bone_die', 'Bone Die', 'common', 'active',
    'Your next damage d6 is at least 3', { kind: 'combat_roll_floor', floor: 3 }),
  wooden_shield: artifact('wooden_shield', 'Wooden Shield', 'common', 'active',
    'Prevent the next wearer damage in this room', { kind: 'prevent_personal_damage', uses: 1 }),
  tiny_shovel: artifact('tiny_shovel', 'Tiny Shovel', 'common', 'active',
    'Add 2 progress to the current non-boss room', { kind: 'room_progress', amount: 2 }),
  ration_box: artifact('ration_box', 'Ration Box', 'common', 'active',
    'Restore 1 HP', { kind: 'heal_self', amount: 1 }),
  rusty_lockpick: artifact('rusty_lockpick', 'Rusty Lockpick', 'rare', 'active',
    'Automatically succeed one noncombat minigame attempt', { kind: 'minigame_auto_success' }),
  loaded_die: artifact('loaded_die', 'Loaded Die', 'rare', 'active',
    'Add +1 damage to your next successful attack', { kind: 'combat_advantage', uses: 1 }),
  family_banner: artifact('family_banner', 'Family Banner', 'rare', 'expedition_passive',
    'Class ability cooldown is reduced from 3 hours to 2 hours', { kind: 'role_recharge_threshold', threshold: 2 }),
  rootcutters_axe: artifact('rootcutters_axe', "Rootcutter's Axe", 'rare', 'expedition_passive',
    'Boss combat rolls 16-20 deal +1 damage', { kind: 'boss_damage_bonus', minRoll: 16, amount: 1 }),
  warding_nail: artifact('warding_nail', 'Warding Nail', 'rare', 'active',
    'Place a shared shield in this room', { kind: 'place_room_shield' }),
  second_chance_coin: artifact('second_chance_coin', 'Second Chance Coin', 'rare', 'active',
    'Place a shared free retry in this room', { kind: 'place_room_retry' }),
  campfire_charm: artifact('campfire_charm', 'Campfire Charm', 'rare', 'active',
    'Restore your role ability charge', { kind: 'restore_role_charge' }),
  phoenix_feather: artifact('phoenix_feather', 'Phoenix Feather', 'epic', 'active',
    'End knockout recovery and return at 3 HP', { kind: 'revive_self', hp: 3 }),
  hourglass_shard: artifact('hourglass_shard', 'Hourglass Shard', 'epic', 'active',
    'Restore 2 AP, up to the cap', { kind: 'restore_ap', amount: 2 }),
  last_stand_banner: artifact('last_stand_banner', 'Banner of Last Stand', 'epic', 'expedition_passive',
    'The first lethal damage leaves you at 1 HP', { kind: 'prevent_knockout', uses: 1 }),
  emerald_heart: artifact('emerald_heart', 'Emerald Heart', 'epic', 'expedition_passive',
    'A natural 20 restores 1 HP', { kind: 'critical_heal', amount: 1 }),
  crooked_compass: artifact('crooked_compass', 'Crooked Compass', 'epic', 'active',
    'Guarantee one extra artifact roll when the current room is cleared', { kind: 'scout_choice' }),
  mimic_tooth: artifact('mimic_tooth', 'Mimic Tooth', 'epic', 'expedition_passive',
    'Gain 50% more room coins', { kind: 'coin_multiplier', multiplier: 1.5 }),
  fates_broken_die: artifact('fates_broken_die', "Fate's Broken Die", 'legendary', 'active',
    'Add +1 damage to your next 3 successful attacks', { kind: 'multi_combat_advantage', uses: 3 }),
  crown_of_twenty: artifact('crown_of_twenty', 'Crown of Twenty', 'legendary', 'expedition_passive',
    'A natural 20 deals +2 additional damage', { kind: 'critical_threshold', threshold: 20, amount: 2 }),
  root_kings_signet: artifact('root_kings_signet', "Root King's Signet", 'legendary', 'expedition_passive',
    'Every successful boss combat deals +1 damage', { kind: 'boss_damage_bonus', minRoll: 9, amount: 1 }),
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
    attackTarget: extra.attackTarget || (type === 'boss' ? 12 : encounterType === 'combat' ? 10 : null),
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

function combatEnemyRoom(id, name, enemyId, hp, attackTarget, tags = []) {
  return room(id, 'combat', name, hp, ['dark', ...tags], [
    action(`${id}_strike`, `Strike ${name}`, 'might', 'easy', 0, ['weapon', ...tags]),
    action(`${id}_flank`, `Flank ${name}`, 'agility', 'easy', 0, ['combat', ...tags]),
    action(`${id}_hex`, `Break ${name}'s ward`, 'arcana', 'easy', 0, ['rune', ...tags]),
    action(`${id}_banish`, `Defy ${name}`, 'spirit', 'easy', 0, ['spirit', ...tags]),
  ], { enemyId, attackTarget });
}

const ROOM_TEMPLATES = deepFreeze({
  combat: [
    combatEnemyRoom('bone_rat_pack', 'Bone Rat Pack', 'bone_rat', 14, 6, ['undead']),
    combatEnemyRoom('grave_slime_pool', 'Grave Slime', 'grave_slime', 15, 6, ['ooze']),
    combatEnemyRoom('crypt_spider_nest', 'Crypt Spider', 'crypt_spider', 16, 6, ['beast']),
    combatEnemyRoom('lantern_skull_watch', 'Lantern Skull', 'lantern_skull', 17, 7, ['undead']),
    combatEnemyRoom('hollow_archer_watch', 'Hollow Archer', 'hollow_archer', 18, 7, ['undead']),
    combatEnemyRoom('thorn_hound_lair', 'Thorn Hound', 'thorn_hound', 18, 7, ['root_creature']),
    combatEnemyRoom('moss_wraith_hollow', 'Moss Wraith', 'moss_wraith', 19, 8, ['spirit']),
    combatEnemyRoom('root_cultist_ritual', 'Root Cultist', 'root_cultist', 20, 8, ['cultist']),
    combatEnemyRoom('vine_mimic_den', 'Vine Mimic', 'vine_mimic', 21, 9, ['mimic']),
    combatEnemyRoom('rootbound_guard_post', 'Rootbound Guard', 'rootbound_guard', 23, 10, ['root_creature']),
    combatEnemyRoom('ossuary_golem_vault', 'Ossuary Golem', 'ossuary_golem', 25, 11, ['undead']),
    combatEnemyRoom('rootbound_champion_gate', 'Rootbound Champion', 'rootbound_champion', 27, 12, ['root_creature']),
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
    room('root_king_phase_1', 'boss', 'Break the Armor', 36, ['boss', 'root_creature', 'undead'], [
      action('break_king_armor', 'Break the bark armor', 'might', 'easy', 0, ['boss', 'root_creature']),
      action('find_king_weakpoint', 'Find a buried weak point', 'agility', 'risky', 2, ['boss', 'root_creature']),
      action('disrupt_king_runes', 'Disrupt the crown runes', 'arcana', 'risky', 2, ['boss', 'rune']),
      action('ward_king_retaliation', 'Ward the king\'s retaliation', 'spirit', 'hard', 4, ['boss', 'undead']),
    ], { phase: 1, attackTarget: 12 }),
    room('root_king_phase_2', 'boss', 'Survive the Roots', 42, ['boss', 'root_creature'], [
      action('hold_back_roots', 'Hold back the root tide', 'might', 'risky', 2, ['boss', 'root']),
      action('evade_king_roots', 'Dance through the roots', 'agility', 'easy', 0, ['boss', 'root']),
      action('sever_root_magic', 'Sever the root magic', 'arcana', 'risky', 2, ['boss', 'rune']),
      action('sanctify_root_ground', 'Sanctify the tangled ground', 'spirit', 'easy', 0, ['boss', 'root']),
    ], { phase: 2, attackTarget: 13, complication: 'frightened' }),
    room('root_king_phase_3', 'boss', 'Final Strike', 48, ['boss', 'root_creature', 'undead'], [
      action('final_might', 'Land the final blow', 'might', 'risky', 2, ['boss']),
      action('final_agility', 'Strike the exposed heart', 'agility', 'risky', 2, ['boss']),
      action('final_arcana', 'Unmake the root crown', 'arcana', 'risky', 2, ['boss', 'rune']),
      action('final_spirit', 'Banish the buried king', 'spirit', 'risky', 2, ['boss', 'undead']),
    ], { phase: 3, attackTarget: 14, criticalBonusLootRolls: 1 }),
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
