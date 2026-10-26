import './browserInteractions.css';

// Mark chat surfaces explicitly. Inputs retain native selection, copy/paste and
// editing even when they live inside an otherwise non-selectable game screen.
const NATIVE_TEXT = '[data-native-text], input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]';

function preserveNativeInteraction(event) {
  const path = event.composedPath?.() || [event.target];
  return path.some(node => {
    const element = node?.nodeType === 3 ? node.parentElement : node;
    return typeof element?.closest === 'function' && Boolean(element.closest(NATIVE_TEXT));
  });
}

function suppressGameCallout(event) {
  if (!preserveNativeInteraction(event)) event.preventDefault();
}

// Only cancel selection/callouts, never pointer or touch events: games still
// receive holds and drags, and the page keeps native scrolling and pinch zoom.
document.addEventListener('contextmenu', suppressGameCallout, true);
document.addEventListener('selectstart', suppressGameCallout, true);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    document.removeEventListener('contextmenu', suppressGameCallout, true);
    document.removeEventListener('selectstart', suppressGameCallout, true);
  });
}
