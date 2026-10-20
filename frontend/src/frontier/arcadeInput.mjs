// Sample a long drag without consuming the server's 256-event budget.
// Direction changes and releases must survive even a 120/240 Hz touch device.
export function acceptArcadeInput(events, event, duration) {
  if (events.length >= 254) return false;
  if (event[1] !== 1) return true;
  if (events.length >= 238) return false;
  const last = events.at(-1);
  if (!last || last[1] !== 1) return true;
  const previous = events.at(-2);
  const turn =
    previous &&
    previous[1] <= 1 &&
    (last[2] - previous[2]) * (event[2] - last[2]) +
      (last[3] - previous[3]) * (event[3] - last[3]) <
      -0.00002;
  return !!turn || event[0] - last[0] >= Math.max(45, duration / 180);
}
export function workbenchPoint(rect, clientX, clientY) {
  const scale = Math.min(rect.width / 400, rect.height / 300);
  const clamp = (v) => Math.max(0, Math.min(1, v));
  return [
    clamp(
      (clientX - rect.left - (rect.width - 400 * scale) / 2) / (400 * scale),
    ),
    clamp(
      (clientY - rect.top - (rect.height - 300 * scale) / 2) / (300 * scale),
    ),
  ];
}
