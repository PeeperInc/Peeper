export function shouldPauseHomeRuntime({ isActive, gameplayOpen }) {
  return !isActive || gameplayOpen;
}

export function shouldPauseLiveStats({ isActive, gameplayOpen }) {
  return shouldPauseHomeRuntime({ isActive, gameplayOpen });
}

export function shouldPauseAppPolling({ gameplayOpen }) {
  return Boolean(gameplayOpen);
}
