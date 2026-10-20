import threeUrl from './vendor/three.min.js?url';
import loaderUrl from './vendor/GLTFLoader.js?url';
import skeletonUrl from './vendor/SkeletonUtils.js?url';

const CHANNEL = 'peeper-sausage-quest';
const pending = new Map();
let onReward = () => {};

function send(type, payload = {}) {
  const id = requestId();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Peeper connection timed out'));
    }, 15000);
    pending.set(id, { resolve, reject, timeout });
    window.parent.postMessage({ channel: CHANNEL, id, type, payload }, location.origin);
  });
}

addEventListener('message', event => {
  if (event.source !== window.parent || event.origin !== location.origin || event.data?.channel !== CHANNEL) return;
  const { id, result, error, type, token, retryable } = event.data;
  if (type === 'reward') { onReward(token, result); return; }
  const request = pending.get(id);
  if (!request) return;
  pending.delete(id);
  clearTimeout(request.timeout);
  if (error) {
    const failure = new Error(error);
    failure.retryable = retryable;
    request.reject(failure);
  }
  else request.resolve(result);
});

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load the game engine'));
    document.head.append(script);
  });
}

function requestId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}

(async () => { try {
  await loadScript(threeUrl);
  await loadScript(loaderUrl);
  await loadScript(skeletonUrl);
  const { connectPeeper } = await import('./game.js');
  connectPeeper({
    requestId,
    start: payload => send('start', payload),
    finish: payload => send('finish', payload),
    onReward: callback => { onReward = callback; },
    ready: () => window.parent.postMessage({ channel: CHANNEL, type: 'ready' }, location.origin),
  });
} catch (error) {
  document.getElementById('card').textContent = 'Could not load Sausage Quest. Close and reopen the game to try again.';
  window.parent.postMessage({ channel: CHANNEL, type: 'load-error', error: error.message }, location.origin);
} })();
