export function generateCityWindowLayout(buildings, rng = Math.random) {
  return buildings.map((building) => {
    const width = Math.max(0, Number(building?.w) || 0);
    const height = Math.max(0, Number(building?.h) || 0);
    const windowWidth = Math.max(3, width * 0.18);
    const windowHeight = Math.max(3, width * 0.18);
    const columns = Math.max(0, Math.floor(width / (windowWidth + 4)));
    const rows = Math.max(0, Math.floor(height / (windowHeight + 5)));
    const windows = [];

    for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
        if (rng() > 0.38) {
          windows.push({
            x: 4 + columnIndex * (windowWidth + 4),
            y: 6 + rowIndex * (windowHeight + 5),
            w: windowWidth,
            h: windowHeight,
          });
        }
      }
    }

    return windows;
  });
}
