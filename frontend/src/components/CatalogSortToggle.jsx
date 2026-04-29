import React from 'react';
import { CATALOG_SORT_MODES, getCatalogSortLabel } from '../utils/catalogSort.mjs';

export default function CatalogSortToggle({ mode, onToggle }) {
  const nextMode = mode === CATALOG_SORT_MODES.NEWEST
    ? CATALOG_SORT_MODES.PRICE
    : CATALOG_SORT_MODES.NEWEST;

  return (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={() => onToggle(nextMode)}
      style={{
        padding: '8px 12px',
        fontSize: 13,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      Sort: {getCatalogSortLabel(mode)}
    </button>
  );
}
