// The collectible layout from the supplied game, without rendering/scenery.
// Keep random calls in exactly the same order as build() in the original.
function rng(seed) {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function generateCollectibles({ seed, length, hazard }) {
  const random = rng(seed);
  const sausages = [];
  let x = -8;
  const flat = n => { x += n; };
  const line = (x0, n, y, gap) => {
    for (let k = 0; k < n; k++) sausages.push([x0 + k * gap, y]);
  };
  const arc = (x0, width, y0, height) => {
    for (let k = 0; k < 5; k++) {
      sausages.push([x0 + width * (k + .5) / 5, y0 + Math.sin((k + .5) / 5 * Math.PI) * height]);
    }
  };
  flat(16);
  while (x < length - 18) {
    const type = random();
    const start = x;
    if (type < .18) { flat(8); line(start + 1.5, 5, .9, 1.2); }
    else if (type < .4) { const width = 2.6 + random() * 1.4; x += width; arc(start, width, 1.3, 1.7); flat(7); }
    else if (type < .6) {
      flat(13);
      [1.7, 2.8, 1.7].forEach((y, k) => sausages.push([start + 2 + k * 4 + 1.6, y + .9]));
      random();
      line(start + .8, 2, .9, 1.1);
    }
    else if (type < .78) {
      const width = 1.8 + random() * .8;
      flat(14); random(); arc(start + 6 - .3, width + 2.4, 1.3, 1.9);
    }
    else if (type < .93 || hazard < .5) { flat(14); line(start + 4, 4, 2.3, 1.2); }
    else { x += 8.5; sausages.push([start + 4.2, 1.7]); flat(7); }
  }
  return sausages;
}

function normalizeLevel(value) {
  const { index, seed, length, hazard } = value || {};
  const baseLength = [130, 175, 220][index];
  const baseHazard = [.35, .6, .85][index];
  if (!Number.isInteger(index) || index < 0 || index > 2
    || !Number.isInteger(seed) || seed < 0 || seed >= 1e9
    || !Number.isInteger(length) || length < baseLength - 10 || length > baseLength + 20
    || !Number.isFinite(hazard) || hazard < baseHazard || hazard > baseHazard + .1) {
    const error = new Error('Invalid Sausage Quest level');
    error.status = 400;
    throw error;
  }
  return { index, seed, length, hazard };
}

module.exports = { generateCollectibles, normalizeLevel };
