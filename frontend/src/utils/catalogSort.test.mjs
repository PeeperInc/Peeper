import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_SORT_MODES, sortCatalogItems } from './catalogSort.mjs';

test('sortCatalogItems sorts newest first by created_at descending', () => {
  const items = [
    { item_id: 'old', name: 'Old', price: 10, created_at: 100 },
    { item_id: 'new', name: 'New', price: 50, created_at: 300 },
    { item_id: 'mid', name: 'Mid', price: 20, created_at: 200 },
  ];

  const sorted = sortCatalogItems(items, CATALOG_SORT_MODES.NEWEST);

  assert.deepEqual(sorted.map((item) => item.item_id), ['new', 'mid', 'old']);
});

test('sortCatalogItems sorts by price ascending with stable fallbacks', () => {
  const items = [
    { item_id: 'b-item', name: 'Bee', price: 20, created_at: 100 },
    { item_id: 'a-item', name: 'Aye', price: 20, created_at: 500 },
    { item_id: 'cheap', name: 'Cheap', price: 5, created_at: 50 },
  ];

  const sorted = sortCatalogItems(items, CATALOG_SORT_MODES.PRICE);

  assert.deepEqual(sorted.map((item) => item.item_id), ['cheap', 'a-item', 'b-item']);
});

test('sortCatalogItems falls back cleanly when created_at is missing', () => {
  const items = [
    { item_id: 'b-item', name: 'Bee', price: 15 },
    { item_id: 'a-item', name: 'Aye', price: 15 },
  ];

  const sorted = sortCatalogItems(items, CATALOG_SORT_MODES.NEWEST);

  assert.deepEqual(sorted.map((item) => item.item_id), ['a-item', 'b-item']);
});
