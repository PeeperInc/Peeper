'use strict';

// The same inventory IDs serve both expedition versions. Card rules are an
// explicit overlay, so existing stock and expeditions never need destructive
// inventory migrations and dice expeditions keep their original behavior.
const { ARTIFACTS, PROVISIONS } = require('./catalog');
const { artifactUseEligibility } = require('./artifactEffects');

const provisionRules = {
  carrot_rations: ['Restore 2 AP, up to 5.', 'recovery', 'restore_ap', { amount: 2 }],
  tomato_soup: ['Restore all HP. Cannot revive a knocked-out hero.', 'recovery', 'restore_hp', { toMax: true }],
  hearty_potato_meal: ['Gain 1 block at the start of each new hand in this combat room.', 'combat', 'room_block', { amount: 1 }],
  lucky_breakfast: ['Draw 2 cards into your current hand. Maximum 8 cards.', 'combat', 'draw_cards', { amount: 2 }],
  warm_milk: ['Gain 1 energy for your current hand. Maximum 6 energy.', 'combat', 'gain_energy', { amount: 1 }],
  truffle_treat: ['Raise your next expedition reward relic by one rarity tier, up to legendary.', 'loot', 'upgrade_loot_rarity', { uses: 1, tiers: 1, mode: 'tier' }],
  magic_squash_pie: ['Your first damaging card each hand deals +1 damage for the rest of this expedition.', 'combat', 'first_attack_bonus', { amount: 1 }],
};

const CARD_PROVISIONS = Object.freeze(Object.fromEntries(Object.entries(provisionRules).map(([id, [description, category, type, config]]) => [id,
  Object.freeze({ ...PROVISIONS[id], description, category, effect: { type, config }, manualEffect: type }),
])));

const activeHint = 'Use before or during your hand. Consumed once; costs no energy or AP.';
const trialHint = 'Use in an open noncombat trial before starting an attempt. Costs no AP.';
const passiveHint = 'Automatic while equipped. Duplicate copies do not stack.';
const artifactRules = {
  old_torch: ['Trials last 10% longer and timing windows are 10% wider.', 'trials'],
  bent_sword: ['Your first damaging card each hand deals +1 damage outside boss rooms.', 'combat', null, { kind: 'first_card_damage_bonus', amount: 1, bossOnly: false }],
  chalk_rune: ['Add 3 seconds to your next trial attempt in this room.', 'trials', trialHint],
  rabbit_foot: ['Prevent the first enemy hit that gets through your defenses this expedition.', 'combat'],
  bone_die: ['Your next damaging card in this room deals at least 5 damage.', 'combat', activeHint, { kind: 'combat_roll_floor', floor: 5 }],
  wooden_shield: ['Prevent your next unblocked enemy response in this room. Does not stop overheat.', 'combat', activeHint],
  tiny_shovel: ['Add up to 2 progress to a noncombat trial. Cannot damage enemies.', 'trials', trialHint],
  ration_box: ['Restore 1 HP. Cannot revive a knocked-out hero.', 'recovery', activeHint],
  rusty_lockpick: ['Automatically succeed at your next trial attempt in this room. The attempt still costs AP.', 'trials', trialHint],
  loaded_die: ['Your next damaging card in this room deals +3 damage.', 'combat', activeHint, { kind: 'combat_advantage', uses: 1, amount: 3 }],
  family_banner: ['Start each new hand with 1 extra block.', 'combat', null, { kind: 'hand_block', amount: 1 }],
  rootcutters_axe: ['Your first damaging card each hand deals +2 damage against the boss.', 'combat', null, { kind: 'first_card_damage_bonus', amount: 2, bossOnly: true }],
  warding_nail: ['Place a family shield: prevent the next unblocked enemy response in this room.', 'combat', activeHint],
  second_chance_coin: ['Give the family one free retry after a failed trial attempt in this room.', 'trials', trialHint],
  campfire_charm: ['Return a card of your choice from your discard to your hand. Its energy cost stays the same.', 'combat', 'Use during your hand. Choose a discarded card; maximum 8 cards in hand.', { kind: 'recover_card' }],
  phoenix_feather: ['End your knockout recovery and return with 3 HP.', 'recovery', 'Use while knocked out, in an open room. Consumed once.'],
  hourglass_shard: ['Restore 2 AP, up to 5.', 'recovery', activeHint],
  last_stand_banner: ['Once per expedition, a lethal enemy hit leaves you at 1 HP. Does not stop overheat or self-damage.', 'combat'],
  emerald_heart: ['Once per hand, playing your last card as an attack heals 1 HP.', 'combat', null, { kind: 'last_card_heal', amount: 1, usesPerHand: 1 }],
  crooked_compass: ['Add a relic roll for this room to your final expedition rewards, within the reward cap.', 'loot', 'Use before this room is cleared, then spend at least 1 AP here.'],
  mimic_tooth: ['Gain 50% more coins from your share of cleared rooms in the final rewards.', 'loot'],
  fates_broken_die: ['Your next 3 damaging cards in this room each deal +3 damage.', 'combat', activeHint, { kind: 'multi_combat_advantage', uses: 3, amount: 3 }],
  crown_of_twenty: ['Once per hand, playing your last card as an attack deals +2 damage.', 'combat', null, { kind: 'last_card_damage_bonus', amount: 2, usesPerHand: 1 }],
  root_kings_signet: ['Every damaging card against the boss deals +1 damage.', 'combat', null, { kind: 'boss_card_damage_bonus', amount: 1 }],
};

const CARD_ARTIFACTS = Object.freeze(Object.fromEntries(Object.entries(artifactRules).map(([id, [displayEffect, category, useHint, effect]]) => [id,
  Object.freeze({ ...ARTIFACTS[id], displayEffect, category, effect: effect || ARTIFACTS[id].effect,
    useHint: useHint || passiveHint }),
])));

function armed(member, kind, roomKey) {
  return (member.triggerHistory || []).some(entry => entry.scope === 'armed' && entry.effectKind === kind
    && entry.roomKey === roomKey && entry.remainingUses > 0);
}

function artifactContext(member, room, roomEffects = []) {
  return {
    roomKey: room.key, roomState: room.state, roomType: room.type,
    roomProgress: room.progress, roomProgressTarget: room.progressTarget,
    hasMinigame: Boolean(room.miniGame), combat: room.type === 'boss' || room.type === 'combat' || room.encounterType === 'combat',
    heroHp: member.heroHp, heroRecoverAt: member.heroRecoverAt, maxHeroHp: 3, ap: member.ap, maxAp: 5,
    roomShield: roomEffects.some(effect => effect.effectType === 'knight_shield'),
    roomRetry: roomEffects.some(effect => effect.effectType === 'bend_fate'),
    minigameTimeBonus: armed(member, 'minigame_time_once', room.key),
    combatRollFloor: armed(member, 'combat_roll_floor', room.key),
    personalDamageShield: armed(member, 'prevent_personal_damage', room.key),
    minigameAutoSuccess: armed(member, 'minigame_auto_success', room.key),
    bonusArtifactRoll: armed(member, 'bonus_artifact_roll', room.key),
  };
}

function supplyContextReason({ member, room, cardState }) {
  if (!room || room.state !== 'unlocked') return 'Choose a current open room.';
  if (cardState?.active && cardState.roomKey !== room.key) return 'Use supplies in the room of your saved hand.';
  return '';
}

function cardArtifactReason(artifactId, context) {
  const artifact = CARD_ARTIFACTS[artifactId];
  if (!artifact || artifact.useType !== 'active') return 'This relic works automatically while equipped.';
  const { member, room, cardState, roomEffects, openAttempt } = context;
  const contextReason = supplyContextReason(context);
  if (contextReason) return contextReason;
  if (cardState?.active ? cardState.artifactsDisabled : member.debuff?.type === 'cursed') return 'Relics are disabled by your curse for this hand.';
  if (artifact.category === 'trials' && (!room.miniGame || room.type === 'camp' || artifactContext(member, room).combat)) return 'Use this relic only in noncombat trials.';
  if (artifact.category === 'trials' && openAttempt) return 'Finish your current trial attempt before using a trial relic.';
  if (artifactId === 'campfire_charm') {
    if (member.heroHp <= 0) return 'Your hero is knocked out.';
    if (!cardState?.active) return 'Draw a hand before recovering a card.';
    if (cardState.hand.length >= 8) return 'Your hand is full (8 cards).';
    if (!cardState.discard.length) return 'Your discard is empty.';
    return '';
  }
  return artifactUseEligibility({ artifactId, artifact, state: artifactContext(member, room, roomEffects) }).reason || '';
}

function cardProvisionReason(provisionId, context) {
  const { member, room, cardState } = context;
  if (!CARD_PROVISIONS[provisionId]) return 'Choose a provision in preparation.';
  if (!member.provisionState?.available || member.provisionState.used) return 'This provision has already been used.';
  const reason = supplyContextReason(context);
  if (reason) return reason;
  if (member.heroHp <= 0) return 'Your hero cannot eat while knocked out.';
  if (provisionId === 'carrot_rations' && member.ap >= 5) return 'Your AP is already full.';
  if (provisionId === 'tomato_soup' && member.heroHp >= 3) return 'Your HP is already full.';
  if (['hearty_potato_meal', 'magic_squash_pie'].includes(provisionId) && !artifactContext(member, room).combat) return 'Use this meal in an open combat room.';
  if (['lucky_breakfast', 'warm_milk'].includes(provisionId)) {
    if (!cardState?.active) return 'Draw a hand before using this meal.';
    if (provisionId === 'lucky_breakfast' && cardState.hand.length >= 8) return 'Your hand is full (8 cards).';
    if (provisionId === 'lucky_breakfast' && !cardState.drawPile.length && !cardState.discard.length) return 'No cards are available to draw.';
    if (provisionId === 'warm_milk' && cardState.energy >= 6) return 'Your energy is already full (6).';
  }
  return '';
}

module.exports = { CARD_PROVISIONS, CARD_ARTIFACTS, cardArtifactReason, cardProvisionReason };
