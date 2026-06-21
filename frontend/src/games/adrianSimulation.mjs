export const ADRIAN_DURATION_SECONDS = 10;
export const ADRIAN_TAUMOEBA_PER_SECOND = 1_000_000;
export const ADRIAN_MAX_TAUMOEBA = ADRIAN_DURATION_SECONDS * ADRIAN_TAUMOEBA_PER_SECOND;

const STABLE_ERROR_LIMIT = 0.24;

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function getAdrianTarget(elapsedSeconds) {
  return {
    angle: Math.sin(elapsedSeconds * 1.08) * 0.34,
    thrust: Math.cos(elapsedSeconds * 0.82 + 0.45) * 0.26,
  };
}

export function getAdrianFlightCue(target) {
  const angle = clamp(target?.angle, -1, 1);
  const thrust = clamp(target?.thrust, -1, 1);
  return {
    x: Number((angle * 0.42).toFixed(3)),
    y: Number((0.62 + thrust * 0.45).toFixed(3)),
    tilt: Number((-0.18 + angle * 0.34).toFixed(3)),
  };
}

export function getAdrianFlightErrorCue(control, target) {
  const angleError = clamp(
    clamp(control?.angle, -1, 1) - clamp(target?.angle, -1, 1),
    -1,
    1,
  );
  const thrustError = clamp(
    clamp(control?.thrust, -1, 1) - clamp(target?.thrust, -1, 1),
    -1,
    1,
  );
  return {
    x: Number((angleError * 1.1).toFixed(3)),
    y: Number((0.62 + thrustError * 1.05).toFixed(3)),
    tilt: Number((-0.18 + angleError * 0.5).toFixed(3)),
  };
}

export function getAdrianAlignmentError(control, target) {
  const angleError = clamp(control?.angle, -1, 1) - clamp(target?.angle, -1, 1);
  const thrustError = clamp(control?.thrust, -1, 1) - clamp(target?.thrust, -1, 1);
  return Math.hypot(angleError * 1.12, thrustError);
}

export function isAdrianAligned(control, target) {
  return getAdrianAlignmentError(control, target) <= STABLE_ERROR_LIMIT;
}

export function createAdrianRun() {
  return {
    elapsedSeconds: 0,
    taumoebaCollected: 0,
    chainStrain: 0.08,
    heat: 0.08,
    stability: 1,
    finished: false,
    failed: false,
  };
}

export function stepAdrianRun(current, input, rawDeltaSeconds) {
  if (current.finished) return current;

  const deltaSeconds = clamp(Number(rawDeltaSeconds) || 0, 0, 0.1);
  const elapsedSeconds = Math.min(
    ADRIAN_DURATION_SECONDS,
    current.elapsedSeconds + deltaSeconds,
  );
  const target = getAdrianTarget(current.elapsedSeconds);
  const angleError = Math.abs(clamp(input.angle, -1, 1) - target.angle);
  const thrustError = Math.abs(clamp(input.thrust, -1, 1) - target.thrust);
  const combinedError = getAdrianAlignmentError(input, target);
  const stable = isAdrianAligned(input, target);
  const stability = clamp(1 - combinedError / 0.82);

  const strainPressure = Math.max(0, angleError - 0.12) + Math.max(0, combinedError - 0.42) * 0.45;
  const heatPressure = Math.max(0, thrustError - 0.13) + Math.max(0, combinedError - 0.48) * 0.35;
  const chainStrain = clamp(current.chainStrain + (strainPressure * 0.5 - 0.11) * deltaSeconds);
  const heat = clamp(current.heat + (heatPressure * 0.48 - 0.1) * deltaSeconds);
  const failed = chainStrain >= 1 || heat >= 1;
  const taumoebaCollected = Math.min(
    ADRIAN_MAX_TAUMOEBA,
    current.taumoebaCollected + (stable && !failed ? ADRIAN_TAUMOEBA_PER_SECOND * deltaSeconds : 0),
  );

  return {
    elapsedSeconds,
    taumoebaCollected,
    chainStrain,
    heat,
    stability,
    failed,
    finished: failed || elapsedSeconds >= ADRIAN_DURATION_SECONDS,
  };
}

export function getAdrianReward(taumoebaCollected) {
  const collected = Math.max(0, Number(taumoebaCollected) || 0);
  if (collected >= 9_000_000) return 10;
  return Math.min(10, Math.floor(collected / 1_000_000));
}

export function getAdrianRockyMessage({ run, control, target, variant = 0 }) {
  const angleError = (control?.angle || 0) - (target?.angle || 0);
  const thrustError = (control?.thrust || 0) - (target?.thrust || 0);
  const pick = (lines) => lines[Math.abs(Math.trunc(variant)) % lines.length];

  if ((run?.chainStrain || 0) > 0.72) {
    return angleError > 0
      ? 'Chain bad! Marker left, quick quick!'
      : 'Chain bad! Marker right, quick quick!';
  }
  if ((run?.heat || 0) > 0.72) {
    return thrustError > 0
      ? 'Too hot! Less thrust, question?'
      : 'Collector sinking! More thrust!';
  }
  if ((run?.stability || 0) > 0.78) {
    return pick([
      'Amaze amaze amaze! Hold this!',
      'Good good good! Science working!',
      'Yes! Marker centered. Happy happy!',
    ]);
  }
  if (Math.abs(angleError) > Math.abs(thrustError)) {
    return angleError > 0
      ? 'Marker right. Correct left!'
      : 'Marker left. Correct right!';
  }
  return thrustError > 0
    ? 'Marker high. Less thrust!'
    : 'Marker low. More thrust!';
}
