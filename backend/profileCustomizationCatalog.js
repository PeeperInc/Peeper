'use strict';

const PROFILE_CATALOG_ITEMS = Object.freeze([
  { itemId: 'profile_frame_moss_circuit', name: 'Moss Circuit', type: 'frame', price: 450, filePath: '/profile/frames/profile_frame_moss_circuit.png?v=3' },
  { itemId: 'profile_frame_ember_crest', name: 'Ember Crest', type: 'frame', price: 650, filePath: '/profile/frames/profile_frame_ember_crest.png?v=3' },
  { itemId: 'profile_frame_royal_signal', name: 'Royal Signal', type: 'frame', price: 900, filePath: '/profile/frames/profile_frame_royal_signal.png?v=3' },

  { itemId: 'profile_scene_neon_burrow', name: 'Neon Burrow', type: 'scene', price: 700, filePath: '/profile/scenes/profile_scene_neon_burrow.png' },
  { itemId: 'profile_scene_moonlit_marsh', name: 'Moonlit Marsh', type: 'scene', price: 900, filePath: '/profile/scenes/profile_scene_moonlit_marsh.png' },
  { itemId: 'profile_scene_root_king_hall', name: 'Root King Hall', type: 'scene', price: 1200, filePath: '/profile/scenes/profile_scene_root_king_hall.png' },

  { itemId: 'profile_title_duelist', name: 'Duelist', type: 'title', titleText: 'Duelist', price: 0, unlockType: 'arena_wins', unlockValue: 25, unlockText: 'Win 25 Arena duels.' },
  { itemId: 'profile_title_lucky_farmer', name: 'Lucky Farmer', type: 'title', titleText: 'Lucky Farmer', price: 0, unlockType: 'magic_squash_inventory', unlockValue: 5, unlockText: 'Hold 5 Magic Squashes in your Farm inventory at once.' },
  { itemId: 'profile_title_root_king_slayer', name: 'Root King Slayer', type: 'title', titleText: 'Root King Slayer', price: 0, unlockType: 'expedition_boss_final_blow', unlockValue: 1, unlockText: 'Land the final blow on the Root King.' },
  { itemId: 'profile_title_ancient_one', name: 'Ancient One', type: 'title', titleText: 'Ancient One', price: 0, unlockType: 'peeper_age_days', unlockValue: 100, unlockText: 'Keep one Peeper alive for 100 days.' },
  { itemId: 'profile_title_generous_soul', name: 'Generous Soul', type: 'title', titleText: 'Generous Soul', price: 0, unlockType: 'gifts_sent', unlockValue: 100, unlockText: 'Send 100 gifts to other players.' },
  { itemId: 'profile_title_expedition_veteran', name: 'Expedition Veteran', type: 'title', titleText: 'Expedition Veteran', price: 0, unlockType: 'expeditions_completed', unlockValue: 10, unlockText: 'Take part in 10 completed Family Expeditions.' },
  { itemId: 'profile_title_family_provider', name: 'Family Provider', type: 'title', titleText: 'Family Provider', price: 0, unlockType: 'family_feasts_served', unlockValue: 10, unlockText: 'Serve 10 Family Big Feasts, using coins or Farm food.' },
  { itemId: 'profile_title_jackpot_hunter', name: 'Jackpot Hunter', type: 'title', titleText: 'Jackpot Hunter', price: 0, unlockType: 'casino_jackpots_won', unlockValue: 1, unlockText: 'Win the shared caSino jackpot.' },

  { itemId: 'profile_name_style_ember_pulse', name: 'Ember Pulse', type: 'name_style', price: 450, nameColor: '#FF5A36', nameColorSecondary: '#FFD052', nameGlowColor: '#FF3B1F', nameGlowStrength: 2, nameEffect: 'ember' },
  { itemId: 'profile_name_style_toxic_bloom', name: 'Toxic Bloom', type: 'name_style', price: 500, nameColor: '#9DFF35', nameColorSecondary: '#E8FF62', nameGlowColor: '#69FF1F', nameGlowStrength: 2, nameEffect: 'toxic' },
  { itemId: 'profile_name_style_hologram', name: 'Hologram', type: 'name_style', price: 600, nameColor: '#5FFBFF', nameColorSecondary: '#5A8CFF', nameGlowColor: '#38E8FF', nameGlowStrength: 1, nameEffect: 'hologram' },
  { itemId: 'profile_name_style_royal_gold', name: 'Royal Gold', type: 'name_style', price: 700, nameColor: '#FFD75E', nameColorSecondary: '#FFF4B0', nameGlowColor: '#F6B91E', nameGlowStrength: 1, nameEffect: 'royal' },
  { itemId: 'profile_name_style_void_echo', name: 'Void Echo', type: 'name_style', price: 750, nameColor: '#A875FF', nameColorSecondary: '#F06BFF', nameGlowColor: '#7C3CFF', nameGlowStrength: 2, nameEffect: 'void' },
  { itemId: 'profile_name_style_frost_signal', name: 'Frost Signal', type: 'name_style', price: 800, nameColor: '#D9FFFF', nameColorSecondary: '#74D9FF', nameGlowColor: '#8DEBFF', nameGlowStrength: 2, nameEffect: 'frost' },
  { itemId: 'profile_name_style_blood_moon', name: 'Blood Moon', type: 'name_style', price: 850, nameColor: '#FF365D', nameColorSecondary: '#FF8A54', nameGlowColor: '#E3133D', nameGlowStrength: 2, nameEffect: 'blood' },
  { itemId: 'profile_name_style_arcane_circuit', name: 'Arcane Circuit', type: 'name_style', price: 950, nameColor: '#FF65DF', nameColorSecondary: '#65F2FF', nameGlowColor: '#C541FF', nameGlowStrength: 2, nameEffect: 'arcane' },
  { itemId: 'profile_name_style_solar_flare', name: 'Solar Flare', type: 'name_style', price: 1050, nameColor: '#FFF16A', nameColorSecondary: '#FF7A24', nameGlowColor: '#FFB21C', nameGlowStrength: 3, nameEffect: 'solar' },
  { itemId: 'profile_name_style_glitch_protocol', name: 'Glitch Protocol', type: 'name_style', price: 1200, nameColor: '#B8FF57', nameColorSecondary: '#FF4FD8', nameGlowColor: '#62FFDF', nameGlowStrength: 1, nameEffect: 'glitch' },
]);

const RETIRED_PROFILE_CATALOG_ITEM_IDS = Object.freeze([
  'profile_title_early_adopter',
  'profile_title_marsh_wanderer',
  'profile_title_night_owl',
  'profile_title_family_heart',
  'profile_title_peeper_patron',
  'profile_title_coin_magnet',
  'profile_title_arcade_ace',
]);

module.exports = { PROFILE_CATALOG_ITEMS, RETIRED_PROFILE_CATALOG_ITEM_IDS };
