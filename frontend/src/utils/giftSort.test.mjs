import test from 'node:test';
import assert from 'node:assert/strict';

import { GIFT_SORT_MODES, sortGifts } from './giftSort.mjs';

const gifts = [
  { id: 1, gift_price: 20, sent_at: 300, is_seen: 1 },
  { id: 2, gift_price: 90, sent_at: 100, is_seen: 1 },
  { id: 3, gift_price: 50, sent_at: 500, is_seen: 1 },
];

test('gift sort defaults to price descending', () => {
  assert.deepEqual(sortGifts(gifts).map((gift) => gift.id), [2, 3, 1]);
});

test('gift sort can switch to newest first', () => {
  assert.deepEqual(sortGifts(gifts, GIFT_SORT_MODES.NEWEST).map((gift) => gift.id), [3, 1, 2]);
});

test('unseen owner gifts stay first while respecting current sort mode', () => {
  const mixed = [
    { id: 1, gift_price: 100, sent_at: 100, is_seen: 1 },
    { id: 2, gift_price: 10, sent_at: 300, is_seen: 0 },
    { id: 3, gift_price: 50, sent_at: 200, is_seen: 0 },
  ];

  assert.deepEqual(sortGifts(mixed, GIFT_SORT_MODES.PRICE, { isOwner: true }).map((gift) => gift.id), [3, 2, 1]);
  assert.deepEqual(sortGifts(mixed, GIFT_SORT_MODES.NEWEST, { isOwner: true }).map((gift) => gift.id), [2, 3, 1]);
});
