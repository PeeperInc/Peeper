// Clamp against the unobstructed playfield, not the full screen behind the HUD.
export function frameCamera(focus, scale, area, size = 1254) {
  const extent = size * scale;
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  const x = area.left + (area.right - area.left) * 0.5;
  // Feet sit below the centre so the face and location marker stay in view.
  const y = area.top + (area.bottom - area.top) * 0.68;
  return {
    x:
      extent < area.right - area.left
        ? x - extent / 2
        : clamp(x - focus[0] * extent, area.right - extent, area.left),
    y:
      extent < area.bottom - area.top
        ? y - extent / 2
        : clamp(y - focus[1] * extent, area.bottom - extent, area.top),
  };
}
