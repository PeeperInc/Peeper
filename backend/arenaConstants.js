const ARENA_STAKE = 25;
const ARENA_HP = 100;
const ARENA_BASE_DAMAGE = 20;
const ARENA_CHOICE_SECONDS = 15;
const ARENA_COUNTDOWN_SECONDS = 3;
const ARENA_QUEUE_TIMEOUT_SECONDS = 60;
const ARENA_PRIVATE_ROOM_TIMEOUT_SECONDS = 120;

const ELEMENTS = ['fire', 'air', 'earth', 'water'];
const ELEMENT_BEATS = {
  fire: 'air',
  air: 'earth',
  earth: 'water',
  water: 'fire',
};

const ELEMENT_EMOJI = {
  fire: '🔥',
  water: '💧',
  earth: '🌍',
  air: '💨',
};

const ELEMENT_COLORS = {
  fire: '#e05555',
  water: '#4a9eff',
  earth: '#7cb342',
  air: '#b0bec5',
};

module.exports = {
  ARENA_STAKE,
  ARENA_HP,
  ARENA_BASE_DAMAGE,
  ARENA_CHOICE_SECONDS,
  ARENA_COUNTDOWN_SECONDS,
  ARENA_QUEUE_TIMEOUT_SECONDS,
  ARENA_PRIVATE_ROOM_TIMEOUT_SECONDS,
  ELEMENTS,
  ELEMENT_BEATS,
  ELEMENT_EMOJI,
  ELEMENT_COLORS,
};
