// Touch and trackpad scrolling stay native. Capture mouse drags only after a
// horizontal gesture, so an ordinary click still activates the card.
export function enableMouseDragScroll(element) {
  const view = element.ownerDocument.defaultView;
  let gesture = null;
  let suppressClick = false;
  function down(event) {
    if (event.button !== 0 || event.isPrimary === false) return;
    suppressClick = false;
    if (event.pointerType !== 'mouse') return;
    if (element.scrollWidth <= element.clientWidth) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, scroll: element.scrollLeft, dragging: false };
  }
  function move(event) {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (!(event.buttons & 1)) { finish(event); return; }
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (!gesture.dragging) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
      if (Math.abs(dy) > Math.abs(dx)) { gesture = null; return; }
      gesture.dragging = true;
      suppressClick = true;
      element.classList.add('is-dragging');
      element.setPointerCapture?.(gesture.id);
    }
    event.preventDefault();
    element.scrollLeft = gesture.scroll - dx;
  }
  function finish(event) {
    if (!gesture || event && event.pointerId !== gesture.id) return;
    const id = gesture.id;
    gesture = null;
    element.classList.remove('is-dragging');
    if (element.hasPointerCapture?.(id)) element.releasePointerCapture(id);
  }
  function click(event) {
    if (!suppressClick || event.detail === 0) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  const preventDrag = event => event.preventDefault();
  const blur = () => finish();
  element.addEventListener('pointerdown', down, true);
  element.addEventListener('click', click, true);
  element.addEventListener('dragstart', preventDrag);
  view.addEventListener('pointermove', move, { capture: true, passive: false });
  view.addEventListener('pointerup', finish, true);
  view.addEventListener('pointercancel', finish, true);
  element.addEventListener('lostpointercapture', finish);
  view.addEventListener('blur', blur);
  return () => {
    finish();
    element.removeEventListener('pointerdown', down, true);
    element.removeEventListener('click', click, true);
    element.removeEventListener('dragstart', preventDrag);
    view.removeEventListener('pointermove', move, true);
    view.removeEventListener('pointerup', finish, true);
    view.removeEventListener('pointercancel', finish, true);
    element.removeEventListener('lostpointercapture', finish);
    view.removeEventListener('blur', blur);
  };
}
