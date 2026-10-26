import assert from 'node:assert/strict';
import test from 'node:test';
import { enableMouseDragScroll } from './mouseDragScroll.mjs';

function setup() {
  const view = new EventTarget(), element = new EventTarget(), classes = new Set();
  Object.assign(element, { ownerDocument: { defaultView: view }, scrollWidth: 800, clientWidth: 300, scrollLeft: 0,
    classList: { add: value => classes.add(value), remove: value => classes.delete(value) } });
  const cleanup = enableMouseDragScroll(element);
  const emit = (target, type, values = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: 200, clientY: 100, detail: 1 }, values);
    target.dispatchEvent(event); return event;
  };
  return { view, element, classes, emit, cleanup };
}

test('horizontal drag scrolls, suppresses its click and allows the next deliberate click', () => {
  const c = setup(); c.emit(c.element, 'pointerdown');
  c.emit(c.view, 'pointermove', { clientX: 80 }); assert.equal(c.element.scrollLeft, 120);
  c.emit(c.view, 'pointerup', { buttons: 0 }); assert.equal(c.classes.size, 0);
  assert.equal(c.emit(c.element, 'click').defaultPrevented, true);
  c.emit(c.element, 'pointerdown'); c.emit(c.view, 'pointerup');
  assert.equal(c.emit(c.element, 'click').defaultPrevented, false); c.cleanup();
});

test('small mouse movements and vertical gestures preserve normal clicks and scrolling', () => {
  const c = setup(); c.emit(c.element, 'pointerdown');
  assert.equal(c.emit(c.view, 'pointermove', { clientX: 197 }).defaultPrevented, false);
  c.emit(c.view, 'pointerup'); assert.equal(c.emit(c.element, 'click').defaultPrevented, false);
  c.emit(c.element, 'pointerdown');
  assert.equal(c.emit(c.view, 'pointermove', { clientY: 140 }).defaultPrevented, false);
  c.emit(c.view, 'pointermove', { clientX: 50 }); assert.equal(c.element.scrollLeft, 0); c.cleanup();
});

test('touch gestures remain native and keyboard clicks are never suppressed', () => {
  const c = setup(); c.emit(c.element, 'pointerdown', { pointerType: 'touch' });
  assert.equal(c.emit(c.view, 'pointermove', { pointerType: 'touch', clientX: 50 }).defaultPrevented, false);
  assert.equal(c.element.scrollLeft, 0);
  c.emit(c.element, 'pointerdown'); c.emit(c.view, 'pointermove', { clientX: 100 }); c.emit(c.view, 'pointerup');
  assert.equal(c.emit(c.element, 'click', { detail: 0 }).defaultPrevented, false);
  c.emit(c.element, 'pointerdown', { pointerType: 'touch' });
  assert.equal(c.emit(c.element, 'click').defaultPrevented, false); c.cleanup();
});

test('cancellation, window blur and unmount stop dragging outside the card row', () => {
  for (const stop of ['pointercancel', 'blur', 'cleanup']) {
    const c = setup(); c.emit(c.element, 'pointerdown'); c.emit(c.view, 'pointermove', { clientX: 100 });
    if (stop === 'cleanup') c.cleanup(); else c.emit(c.view, stop);
    assert.equal(c.classes.size, 0);
    c.emit(c.view, 'pointermove', { clientX: 50 }); assert.equal(c.element.scrollLeft, 100); c.cleanup();
  }
});
