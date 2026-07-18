export const ROOT_CROSSING_LANE_COUNT = 6;
const CHECKER_LANE_OFFSETS = Object.freeze([8, 58, 24, 74, 40, 15]);

function hashSeed(value) {
  let hash = 2166136261;
  for (const char of String(value || 'root-crossing')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildRootCrossingLanes(seed) {
  const random = mulberry32(hashSeed(seed));
  return Array.from({ length: ROOT_CROSSING_LANE_COUNT }, (_, laneIndex) => {
    const direction = laneIndex % 2 === 0 ? 1 : -1;
    const speed = 6.5 + random() * 3 + laneIndex * 0.25;
    const hazardCount = laneIndex < 4 ? 1 : 2;
    const spacing = 100 / hazardCount;
    const laneOffset = CHECKER_LANE_OFFSETS[laneIndex] + random() * 6 - 3;
    const hazards = Array.from({ length: hazardCount }, (_, hazardIndex) => ({
      id: `${laneIndex}-${hazardIndex}`,
      // Keep pairs separated so a seeded lane cannot become an impassable wall.
      offset: (laneOffset + hazardIndex * spacing + random() * 8) % 100,
      width: 16 + random() * 6,
      variant: Math.floor(random() * 3),
    }));
    return { direction, speed, hazards };
  });
}

function wrap(value, span) {
  return ((value % span) + span) % span;
}

export function rootCrossingHazardX(hazard, lane, elapsedSeconds) {
  const span = 126;
  return wrap(hazard.offset + lane.direction * lane.speed * elapsedSeconds + 13, span) - 13;
}
