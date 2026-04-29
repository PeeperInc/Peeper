export const CATALOG_SORT_MODES = {
  NEWEST: 'newest',
  PRICE: 'price',
};

export function getCatalogSortLabel(mode) {
  return mode === CATALOG_SORT_MODES.PRICE ? 'Price' : 'Newest';
}

function numericValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function sortCatalogItems(items, mode = CATALOG_SORT_MODES.NEWEST) {
  return [...items].sort((a, b) => {
    if (mode === CATALOG_SORT_MODES.PRICE) {
      const priceDiff = numericValue(a?.price) - numericValue(b?.price);
      if (priceDiff !== 0) return priceDiff;
    } else {
      const createdDiff = numericValue(b?.created_at) - numericValue(a?.created_at);
      if (createdDiff !== 0) return createdDiff;
    }

    const nameDiff = String(a?.name || '').localeCompare(String(b?.name || ''));
    if (nameDiff !== 0) return nameDiff;

    return String(a?.item_id || '').localeCompare(String(b?.item_id || ''));
  });
}
