export const GIFT_SORT_MODES = {
  PRICE: 'price',
  NEWEST: 'newest',
};

export function getGiftSortLabel(mode) {
  return mode === GIFT_SORT_MODES.NEWEST ? 'Newest' : 'Price';
}

function numericValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compareGiftValues(a, b, mode) {
  if (mode === GIFT_SORT_MODES.NEWEST) {
    const sentDiff = numericValue(b?.sent_at) - numericValue(a?.sent_at);
    if (sentDiff !== 0) return sentDiff;

    const priceDiff = numericValue(b?.gift_price) - numericValue(a?.gift_price);
    if (priceDiff !== 0) return priceDiff;
  } else {
    const priceDiff = numericValue(b?.gift_price) - numericValue(a?.gift_price);
    if (priceDiff !== 0) return priceDiff;

    const sentDiff = numericValue(b?.sent_at) - numericValue(a?.sent_at);
    if (sentDiff !== 0) return sentDiff;
  }

  return numericValue(b?.id) - numericValue(a?.id);
}

export function sortGifts(gifts, mode = GIFT_SORT_MODES.PRICE, { isOwner = false } = {}) {
  return [...(Array.isArray(gifts) ? gifts : [])].sort((a, b) => {
    if (isOwner) {
      const aNew = Number(a?.is_seen) === 0;
      const bNew = Number(b?.is_seen) === 0;
      if (aNew !== bNew) return aNew ? -1 : 1;
    }

    return compareGiftValues(a, b, mode);
  });
}
