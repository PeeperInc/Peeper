'use strict';

const CARD_MODE = 'cards_v1';
const ENERGY_PER_TURN = 3;
const HAND_SIZE = 4;
const MAX_DECK_SIZE = 16;
const card = (id, name, cost, kind, text, options = {}) => Object.freeze({ id, name, cost, kind, text, ...options });
const CARDS = Object.freeze(Object.fromEntries([
  card('strike', 'Strike', 1, 'attack', 'Deal 3 damage.', { damage: 3, icon: 'sword' }),
  card('guard', 'Guard', 1, 'guard', 'Gain 1 block for the enemy response.', { block: 1, icon: 'shield' }),
  card('shield_bash', 'Shield Bash', 1, 'attack', 'Deal 2 damage + 3 per block. Spend your block.', { role: 'knight', damage: 2, effect: 'bash', icon: 'shield' }),
  card('bulwark', 'Bulwark', 2, 'guard', 'Gain 2 block. Keep 1 block for your next hand.', { role: 'knight', block: 2, effect: 'retain', icon: 'tower' }),
  card('riposte', 'Riposte', 1, 'attack', 'Deal 2 damage and gain 1 block.', { role: 'knight', damage: 2, block: 1, icon: 'sword' }),
  card('rally', 'Hold the Line', 1, 'support', 'Gain 1 block. Leave a ward to block an ally’s next hit.', { role: 'knight', block: 1, effect: 'ward', icon: 'banner' }),
  card('quick_cut', 'Quick Cut', 0, 'attack', 'Deal 1 damage. Gain 1 combo this turn.', { role: 'scout', damage: 1, effect: 'combo', icon: 'dagger' }),
  card('mark', 'Expose', 1, 'support', 'The family’s next 2 hits deal +2 damage.', { role: 'scout', effect: 'expose', icon: 'eye' }),
  card('finisher', 'Finisher', 2, 'attack', 'Deal 4 damage + 3 per combo. Spend your combo.', { role: 'scout', damage: 4, effect: 'finisher', icon: 'dagger' }),
  card('sidestep', 'Sidestep', 1, 'guard', 'Dodge the enemy response. Gain 1 combo.', { role: 'scout', effect: 'dodge', icon: 'wind' }),
  card('spark', 'Spark', 1, 'attack', 'Deal 3 damage. Gain 1 heat.', { role: 'mage', damage: 3, heat: 1, icon: 'bolt' }),
  card('fireball', 'Fireball', 2, 'attack', 'Deal 7 damage. Gain 2 heat.', { role: 'mage', damage: 7, heat: 2, icon: 'flame' }),
  card('vent', 'Vent', 0, 'skill', 'Remove 3 heat. Gain 1 energy.', { role: 'mage', effect: 'vent', icon: 'wind' }),
  card('discharge', 'Discharge', 1, 'attack', 'Deal 2 damage + 2 per heat. Spend your heat.', { role: 'mage', damage: 2, effect: 'discharge', icon: 'bolt' }),
  card('smite', 'Smite', 1, 'attack', 'Deal 3 damage. Gain 1 light.', { role: 'cleric', damage: 3, light: 1, icon: 'sun' }),
  card('mend', 'Mend', 1, 'skill', 'Spend 2 light to heal 1 HP.', { role: 'cleric', effect: 'mend', icon: 'heart' }),
  card('judgement', 'Judgement', 2, 'attack', 'Deal 4 damage + 2 per light. Spend your light.', { role: 'cleric', damage: 4, effect: 'judgement', icon: 'sun' }),
  card('sanctuary', 'Sanctuary', 1, 'support', 'Gain 1 block and 1 light. Leave a ward for an ally.', { role: 'cleric', block: 1, light: 1, effect: 'ward', icon: 'heart' }),
  card('fortress', 'Fortress', 1, 'guard', 'Gain 2 block. Keep 1 for the next hand.', { role: 'knight', block: 2, effect: 'retain', reward: true, icon: 'tower' }),
  card('shield_crash', 'Shield Crash', 2, 'attack', 'Deal 5 damage + 3 per block. Spend your block.', { role: 'knight', damage: 5, effect: 'bash', reward: true, icon: 'shield' }),
  card('vanguard', 'Vanguard', 1, 'support', 'Gain 2 block. Leave a ward for an ally.', { role: 'knight', block: 2, effect: 'ward', reward: true, icon: 'banner' }),
  card('ambush', 'Ambush', 1, 'attack', 'Deal 4 damage. Gain 1 combo.', { role: 'scout', damage: 4, effect: 'combo', reward: true, icon: 'dagger' }),
  card('death_mark', 'Death Mark', 0, 'support', 'The family’s next 2 hits deal +2 damage.', { role: 'scout', effect: 'expose', reward: true, icon: 'eye' }),
  card('vanish', 'Vanish', 0, 'guard', 'Dodge the enemy response. Gain 1 combo.', { role: 'scout', effect: 'dodge', reward: true, icon: 'wind' }),
  card('inferno', 'Inferno', 2, 'attack', 'Deal 10 damage. Gain 2 heat.', { role: 'mage', damage: 10, heat: 2, reward: true, icon: 'flame' }),
  card('ice_bolt', 'Ice Bolt', 1, 'attack', 'Deal 3 damage. Enemy deals 1 less damage this turn.', { role: 'mage', damage: 3, effect: 'weaken', reward: true, icon: 'crystal' }),
  card('deep_breath', 'Deep Breath', 0, 'skill', 'Remove 3 heat. Gain 1 energy.', { role: 'mage', effect: 'vent', reward: true, icon: 'wind' }),
  card('radiance', 'Radiance', 1, 'attack', 'Deal 4 damage. Gain 2 light.', { role: 'cleric', damage: 4, light: 2, reward: true, icon: 'sun' }),
  card('mercy', 'Mercy', 0, 'skill', 'Spend 2 light to heal 1 HP.', { role: 'cleric', effect: 'mend', reward: true, icon: 'heart' }),
  card('holy_fire', 'Holy Fire', 1, 'attack', 'Deal 4 damage + 2 per light. Spend your light.', { role: 'cleric', damage: 4, effect: 'judgement', reward: true, icon: 'flame' }),
].map(definition => [definition.id, definition])));

const CLASS_RULES = Object.freeze({
  knight: { name: 'Knight', resource: 'Block', description: 'Build block, then turn it into a crushing shield attack.', starter: ['shield_bash', 'bulwark', 'riposte', 'rally'] },
  scout: { name: 'Scout', resource: 'Combo', description: 'Chain quick cuts into finishers. Expose enemies for the family.', starter: ['quick_cut', 'mark', 'finisher', 'sidestep'] },
  mage: { name: 'Mage', resource: 'Heat', description: 'Build heat and discharge it. Ending at 4+ heat costs 1 HP.', starter: ['spark', 'fireball', 'vent', 'discharge'] },
  cleric: { name: 'Cleric', resource: 'Light', description: 'Build light through combat. Spend it on healing or judgement.', starter: ['smite', 'mend', 'judgement', 'sanctuary'] },
});

function starterDeck(role) {
  if (!CLASS_RULES[role]) throw new RangeError('Unknown card class');
  return ['strike', 'strike', 'guard', 'guard', ...CLASS_RULES[role].starter];
}

function enemyIntent(room, turnNumber) {
  const phase = Number(room.phase || 1);
  const index = (Math.max(1, turnNumber) - 1 + Number(room.id || 0)) % 3;
  if (index === 1) return { kind: 'heavy', damage: 2, label: 'Heavy attack', text: 'Deals 2 HP damage when you end your turn.' };
  if (index === 2 && (room.enemyId === 'root_cultist' || room.type === 'boss')) {
    return { kind: 'drain', damage: phase >= 3 ? 2 : 1, label: 'Root drain', text: 'An unblocked hit also restores 2 enemy HP.' };
  }
  return { kind: 'strike', damage: 1, label: 'Attack', text: 'Deals 1 HP damage when you end your turn.' };
}

const CARD_ARTIFACT_COPY = Object.freeze({
  bent_sword: 'Your first damaging card each hand deals +1 damage outside boss rooms',
  bone_die: 'Your next damaging card in this room deals at least 3 damage',
  wooden_shield: 'Prevent your next enemy response in this room',
  rootcutters_axe: 'Your first damaging card each hand deals +1 damage against the boss',
  warding_nail: 'Place a shared shield against the next enemy response in this room',
  family_banner: 'Start each card hand with 1 block; class ability cooldowns remain shorter',
  emerald_heart: 'Playing your last card as an attack restores 1 HP',
  crown_of_twenty: 'Playing your last card as an attack deals +2 damage',
  root_kings_signet: 'Every damaging card against the boss deals +1 damage',
});

module.exports = { CARD_MODE, ENERGY_PER_TURN, HAND_SIZE, MAX_DECK_SIZE, CARDS, CLASS_RULES, starterDeck, enemyIntent, CARD_ARTIFACT_COPY };
