import React, { useState } from 'react';
import { assetUrl } from '../utils/assetUrl';

const TELEGRAM_STAR_SRC = '/sprites/stars.webp';
const TELEGRAM_STAR_FALLBACK = '✦';

export function isSupporter(value) {
  const supporter = value?.supporter || value || {};
  return Boolean(
    supporter.donated
    || Number(supporter.starsTotal || 0) > 0
    || Number(value?.supporter_stars || 0) > 0
    || value?.supporter_since
    || supporter.since
  );
}

export function TelegramStarIcon({ size = 16, className = '', style = {} }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span
        className={className}
        style={{
          display: 'inline-flex',
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size,
          lineHeight: 1,
          color: '#f6b93b',
          ...style,
        }}
      >
        {TELEGRAM_STAR_FALLBACK}
      </span>
    );
  }
  return (
    <img
      src={assetUrl(TELEGRAM_STAR_SRC)}
      alt="Telegram Stars supporter"
      className={className}
      onError={() => setFailed(true)}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        display: 'inline-block',
        verticalAlign: '-0.16em',
        ...style,
      }}
    />
  );
}

export default function SupporterStar({ user = null, supporter = null, size = 13, className = 'supporter-inline-star', style = {} }) {
  const source = supporter || user;
  if (!isSupporter(source)) return null;
  return <TelegramStarIcon size={size} className={className} style={style} />;
}
