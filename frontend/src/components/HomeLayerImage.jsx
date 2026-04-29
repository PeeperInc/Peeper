import React from 'react';
import { assetUrl } from '../utils/assetUrl';

export default function HomeLayerImage({ item, className = '' }) {
  if (!item?.file_path) return null;

  return (
    <img
      src={assetUrl(item.file_path)}
      alt=""
      className={className || 'home-layer-image'}
      draggable={false}
    />
  );
}
