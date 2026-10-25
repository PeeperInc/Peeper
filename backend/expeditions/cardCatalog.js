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
  card('bulwark', 'Bulwark', 2, 'guard', 'Gain 3 block. Keep 2 for your next hand.', { role: 'knight', block: 3, effect: 'retain', retain: 2, icon: 'tower' }),
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
  card('mend', 'Mend', 1, 'skill', 'Spend 2 light: heal 2 HP and draw a card.', { role: 'cleric', effect: 'mend', lightCost: 2, heal: 2, draw: 1, icon: 'heart' }),
  card('judgement', 'Judgement', 2, 'attack', 'Deal 4 damage + 2 per light. Spend your light.', { role: 'cleric', damage: 4, effect: 'judgement', icon: 'sun' }),
  card('sanctuary', 'Sanctuary', 1, 'support', 'Gain 2 block and 1 light. Leave a ward for an ally.', { role: 'cleric', block: 2, light: 1, effect: 'ward', icon: 'heart' }),
  card('fortress', 'Fortress', 1, 'guard', 'Gain 2 block. Keep 1 for the next hand.', { role: 'knight', block: 2, effect: 'retain', reward: true, icon: 'tower' }),
  card('shield_crash', 'Shield Crash', 2, 'attack', 'Deal 5 + 3 per block. Spend block. Weaken the response by 1.', { role: 'knight', damage: 5, effect: 'bash', weaken: 1, reward: true, icon: 'shield' }),
  card('vanguard', 'Vanguard', 2, 'support', 'Gain 2 block. Ward an ally. Draw a card.', { role: 'knight', block: 2, effect: 'ward', draw: 1, reward: true, icon: 'banner' }),
  card('ambush', 'Venom Finish', 1, 'attack', 'Spend 1–2 combo. Hit for 3. Poison: 2–3 on your next 3 turn ends.', { role: 'scout', damage: 3, effect: 'venom_finisher', comboCost: 1, comboSpendMax: 2, reward: true, icon: 'poison' }),
  card('death_mark', 'Death Mark', 1, 'support', 'Gain 2 combo. The family’s next 2 hits deal +2 damage.', { role: 'scout', effect: 'expose', combo: 2, reward: true, icon: 'eye' }),
  card('vanish', 'Vanish', 2, 'guard', 'Dodge the response and draw 2 cards.', { role: 'scout', effect: 'vanish', draw: 2, reward: true, icon: 'wind' }),
  card('inferno', 'Inferno', 2, 'attack', 'Deal 6 + 2 per heat, then gain 2 heat. Keep your heat.', { role: 'mage', damage: 6, heat: 2, effect: 'inferno', reward: true, icon: 'flame' }),
  card('ice_bolt', 'Ice Bolt', 1, 'attack', 'Deal 3 damage. Enemy deals 1 less damage this turn.', { role: 'mage', damage: 3, effect: 'weaken', reward: true, icon: 'crystal' }),
  card('deep_breath', 'Deep Breath', 0, 'skill', 'Remove all heat and draw a card.', { role: 'mage', effect: 'cool_all', draw: 1, reward: true, icon: 'wind' }),
  card('radiance', 'Radiance', 2, 'attack', 'Deal 5 damage. Gain 2 light and draw a card.', { role: 'cleric', damage: 5, light: 2, draw: 1, reward: true, icon: 'sun' }),
  card('mercy', 'Mercy', 0, 'guard', 'Spend 1 light: heal 1 HP and gain 1 block. Works at full HP.', { role: 'cleric', effect: 'mend', lightCost: 1, heal: 1, block: 1, reward: true, icon: 'heart' }),
  card('holy_fire', 'Holy Fire', 1, 'attack', 'Spend 2 light: deal 7 damage. Keep your other light.', { role: 'cleric', damage: 7, effect: 'holy_fire', reward: true, icon: 'flame' }),
  card('standfast', 'Standfast', 0, 'guard', 'Gain 1 block. If already blocking, draw a card.', { role: 'knight', block: 1, effect: 'standfast', icon: 'shield' }),
  card('challenge', 'Challenge', 1, 'guard', 'Gain 1 block. Fully block the response to counter for 4 damage.', { role: 'knight', block: 1, effect: 'counter', icon: 'sword' }),
  card('shield_throw', 'Shield Throw', 1, 'attack', 'Deal 3 + 2 per block. Keep your block.', { role: 'knight', damage: 3, effect: 'shield_throw', icon: 'shield' }),
  card('preparation', 'Preparation', 0, 'skill', 'Spend 1 combo to draw 2 cards.', { role: 'scout', effect: 'prepare', draw: 2, icon: 'eye' }),
  card('poisoned_blade', 'Venom Blade', 1, 'attack', 'Deal 2 damage. Poison deals 2 more on your next 3 turn ends.', { role: 'scout', damage: 2, effect: 'poison', icon: 'dagger' }),
  card('flurry', 'Flurry', 1, 'attack', 'Deal 1 + your combo. Keep it, then gain 1 combo.', { role: 'scout', damage: 1, effect: 'flurry', icon: 'dagger' }),
  card('frost_armor', 'Frost Armor', 1, 'guard', 'Gain 2 block and remove 2 heat.', { role: 'mage', block: 2, effect: 'frost', icon: 'crystal' }),
  card('overchannel', 'Overchannel', 0, 'skill', 'Gain 2 heat. Draw 2 cards. Beware of overheating.', { role: 'mage', heat: 2, draw: 2, icon: 'bolt' }),
  card('echo', 'Arcane Echo', 1, 'skill', 'Your next damaging card this turn deals double damage.', { role: 'mage', effect: 'echo', icon: 'crystal' }),
  card('prayer', 'Prayer', 0, 'skill', 'Gain 2 light. Save it for healing or a judgement.', { role: 'cleric', light: 2, icon: 'sun' }),
  card('offering', 'Offering', 0, 'skill', 'Lose 1 HP. Gain 3 light and 1 energy. Requires 2+ HP.', { role: 'cleric', effect: 'offering', light: 3, icon: 'heart' }),
  card('beacon', 'Beacon', 1, 'support', 'Gain 1 light. Leave 2 charges: wounded family attackers heal 1 HP. Full HP saves the charge.', { role: 'cleric', light: 1, effect: 'beacon', icon: 'sun' }),
].map(definition => [definition.id, definition])));

const CLASS_RULES = Object.freeze({
  knight: { name: 'Knight', resource: 'Block', description: 'Build block, counter enemy hits, then turn your shield into a weapon.' },
  scout: { name: 'Scout', resource: 'Combo', description: 'Chain cuts into finishers. Poison enemies and expose them for the family.' },
  mage: { name: 'Mage', resource: 'Heat', description: 'Echo spells, build heat, then discharge or cool it. Ending at 4+ heat costs 1 HP.' },
  cleric: { name: 'Cleric', resource: 'Light', description: 'Faith: your first light-generating card each turn grants 1 block. Spend light on healing or judgement.' },
});

function starterDeck(role) {
  if (!CLASS_RULES[role]) throw new RangeError('Unknown card class');
  return ['strike', 'guard', ...Object.values(CARDS).filter(card => card.role === role).map(card => card.id)];
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

module.exports = { CARD_MODE, ENERGY_PER_TURN, HAND_SIZE, MAX_DECK_SIZE, CARDS, CLASS_RULES, starterDeck, enemyIntent };
