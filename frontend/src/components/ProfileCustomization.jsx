import React, { useEffect, useState } from 'react';
import * as api from '../api';
import { useApp } from '../context/AppContext';
import { avatarUrl } from '../utils/avatarUrl';
import BottomSheet from './BottomSheet';
import SupporterStar from './SupporterStar';

const SLOT_META = Object.freeze({
  frame: { label: 'Frame', plural: 'Frames', eyebrow: 'AVATAR LAYER', icon: '◇' },
  scene: { label: 'Scene', plural: 'Scenes', eyebrow: 'PROFILE BACKDROP', icon: '▧' },
  title: { label: 'Title', plural: 'Titles', eyebrow: 'IDENTITY TAG', icon: 'T' },
  name_style: { label: 'Name FX', plural: 'Name Effects', eyebrow: 'NAME SIGNAL', icon: 'Aa' },
});

const EMPTY_APPEARANCE = Object.freeze({ frame: null, scene: null, title: null, nameStyle: null });

export function getProfileNameStyleCss(style) {
  const normalizeColor = value => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : null;
  const primary = normalizeColor(style?.color || style?.nameColor);
  const secondary = normalizeColor(style?.colorSecondary || style?.nameColorSecondary);
  const glowColor = normalizeColor(style?.glowColor || style?.nameGlowColor || primary);
  const glowStrength = Math.max(0, Math.min(3, Number(style?.glowStrength ?? style?.nameGlowStrength ?? 0)));
  if (!primary) return undefined;

  const rgba = (hex, alpha) => {
    const value = Number.parseInt(hex.slice(1), 16);
    return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
  };
  const css = {
    color: primary,
    '--name-primary': primary,
    '--name-secondary': secondary || primary,
    '--name-glow': glowColor || primary,
  };
  if (secondary) {
    css.backgroundImage = `linear-gradient(90deg, ${primary}, ${secondary})`;
    css.backgroundClip = 'text';
    css.WebkitBackgroundClip = 'text';
    css.WebkitTextFillColor = 'transparent';
  }
  if (glowStrength > 0 && glowColor) {
    const shadows = glowStrength === 1
      ? [`0 0 3px ${rgba(glowColor, 0.48)}`]
      : glowStrength === 2
        ? [`0 0 4px ${rgba(glowColor, 0.78)}`, `0 0 10px ${rgba(glowColor, 0.48)}`]
        : [`0 0 5px ${rgba(glowColor, 0.98)}`, `0 0 14px ${rgba(glowColor, 0.82)}`, `0 0 26px ${rgba(glowColor, 0.64)}`];
    css.textShadow = shadows.join(', ');
  }
  return css;
}

export function getProfileNameEffectClass(style) {
  const effect = String(style?.effect || style?.nameEffect || '').replace(/[^a-z_]/g, '');
  return effect ? ` profile-name-effect profile-name-effect-${effect}` : '';
}

function AvatarImage({ user, size }) {
  const [failed, setFailed] = useState(false);
  const telegramId = user?.telegram_id ?? user?.telegramId;
  const src = telegramId
    ? avatarUrl(telegramId)
    : (user?.photo_url || user?.photoUrl || user?.sender_photo || null);
  const displayName = user?.first_name || user?.firstName || user?.displayName || 'Peeper player';
  if (!src || failed) {
    return <span className="profile-custom-avatar-fallback" style={{ fontSize: Math.round(size * 0.42) }}>🐸</span>;
  }
  return <img className="profile-custom-avatar-photo" src={src} alt={displayName} onError={() => setFailed(true)} />;
}

export function ProfileAvatar({ user, appearance = user?.appearance, size = 58, className = '' }) {
  return (
    <span className={`profile-custom-avatar${appearance?.frame?.filePath ? ' has-frame' : ''} ${className}`} style={{ width: size, height: size }}>
      <AvatarImage user={user} size={size} />
      {appearance?.frame?.filePath && (
        <img
          className="profile-custom-avatar-frame"
          src={appearance.frame.filePath}
          alt={appearance.frame.name || 'Profile frame'}
        />
      )}
    </span>
  );
}

export function ProfileTitle({ appearance, compact = false }) {
  const title = appearance?.title;
  if (!title?.text) return null;
  return (
    <span className={`profile-custom-title${compact ? ' compact' : ''}`} title={title.name || title.text}>
      {title.text}
    </span>
  );
}

export function ProfileName({
  user,
  appearance = user?.appearance,
  children = null,
  className = '',
  style = undefined,
  as: Tag = 'span',
}) {
  const content = children ?? user?.first_name ?? user?.firstName ?? user?.displayName ?? user?.username ?? 'Peeper player';
  const nameStyle = appearance?.nameStyle;
  return (
    <Tag
      className={`${className}${nameStyle ? ' has-name-style' : ''}${getProfileNameEffectClass(nameStyle)}`}
      style={{ ...style, ...getProfileNameStyleCss(nameStyle) }}
    >
      {content}
    </Tag>
  );
}

export function ProfileHero({ user, appearance = user?.appearance, action = null, compact = false }) {
  const sceneStyle = appearance?.scene?.filePath
    ? { backgroundImage: `linear-gradient(90deg, rgba(2,13,8,.88), rgba(2,13,8,.34), rgba(2,13,8,.76)), url("${appearance.scene.filePath}")` }
    : undefined;

  return (
    <section className={`profile-custom-hero${compact ? ' compact' : ''}${appearance?.scene ? ' has-scene' : ''}`} style={sceneStyle}>
      <div className="profile-custom-hero-grid" aria-hidden="true" />
      <ProfileAvatar user={user} appearance={appearance} size={compact ? 52 : 72} />
      <div className="profile-custom-identity">
        <div className="profile-custom-name-row">
          <ProfileName user={user} appearance={appearance} as="strong" />
          <SupporterStar user={user} supporter={user?.supporter} size={15} />
        </div>
        {user?.username && <span className="profile-custom-handle">@{user.username}</span>}
        <ProfileTitle appearance={appearance} />
      </div>
      {action && <div className="profile-custom-hero-action">{action}</div>}
    </section>
  );
}

function StudioPreview({ user, appearance }) {
  return (
    <div className="profile-studio-preview-wrap">
      <span>LIVE PROFILE</span>
      <ProfileHero user={user} appearance={appearance} compact />
    </div>
  );
}

function StudioTab({ type, active, count, onClick }) {
  const meta = SLOT_META[type];
  return (
    <button type="button" className={`profile-studio-tab${active ? ' active' : ''}`} onClick={onClick}>
      <span>{meta.label}</span>
      <small>{count}</small>
    </button>
  );
}

function ItemArtwork({ item }) {
  if (item.type === 'title') {
    return <div className="profile-studio-title-art">{item.titleText}</div>;
  }
  if (item.type === 'name_style') {
    return <div className={`profile-studio-name-art${getProfileNameEffectClass(item)}`} style={getProfileNameStyleCss(item)}>Peeper</div>;
  }
  if (!item.filePath) {
    return <div className="profile-studio-missing-art">PNG<br />pending</div>;
  }
  return (
    <img
      src={item.filePath}
      alt=""
      className={item.type === 'scene' ? 'profile-studio-scene-art' : 'profile-studio-frame-art'}
    />
  );
}

function DetailSheet({ item, coins, busy, onClose, onAction }) {
  const meta = SLOT_META[item.type];
  const cannotAfford = !item.owned && !item.locked && Number(item.price || 0) > Number(coins || 0);
  const actionLabel = item.locked
    ? 'Locked'
    : cannotAfford
      ? `Need ${item.price} ✦`
    : item.equipped
      ? `Remove ${meta.label}`
      : item.owned ? `Equip ${meta.label}` : `Buy & equip · ${item.price} ✦`;
  return (
    <BottomSheet onClose={onClose} bodyClassName="sheet-body profile-studio-sheet">
      <div className="profile-studio-detail-art"><ItemArtwork item={item} /></div>
      <span className="profile-studio-detail-eyebrow">{meta.eyebrow}</span>
      <h2>{item.name}</h2>
      <p>
        {item.type === 'frame' && 'Frames sit above your Telegram avatar and stay visible on your profile.'}
        {item.type === 'scene' && 'Scenes transform the profile header without hiding your identity.'}
        {item.type === 'title' && `Show “${item.titleText}” beneath your name. You can remove it at any time.`}
        {item.type === 'name_style' && 'Change your profile name color, gradient and glow without affecting readability.'}
      </p>
      {item.locked && (
        <div className="profile-studio-unlock">
          <span>ACHIEVEMENT REQUIRED</span>
          <strong>{item.unlockText}</strong>
          <div><i style={{ width: `${Math.min(100, (item.unlockProgress / Math.max(1, item.unlockValue)) * 100)}%` }} /></div>
          <small>{item.unlockProgress} / {item.unlockValue}</small>
        </div>
      )}
      <button type="button" className="btn btn-primary btn-full" disabled={busy || item.locked || cannotAfford || (!item.filePath && ['frame', 'scene'].includes(item.type))} onClick={onAction}>
        {busy ? 'Updating...' : actionLabel}
      </button>
      <button type="button" className="btn btn-ghost btn-full" disabled={busy} onClick={onClose}>Cancel</button>
    </BottomSheet>
  );
}

export default function ProfileStudio({ user, initialAppearance, onBack, onAppearanceChange }) {
  const { refreshGameState, showToast } = useApp();
  const [items, setItems] = useState([]);
  const [appearance, setAppearance] = useState(initialAppearance || EMPTY_APPEARANCE);
  const [activeType, setActiveType] = useState('frame');
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getProfileCustomizationCatalog()
      .then(data => {
        if (cancelled) return;
        setItems(data.items || []);
        setAppearance(data.appearance || EMPTY_APPEARANCE);
      })
      .catch(error => showToast(error.message || 'Could not open Profile Studio'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [showToast]);

  const visibleItems = items.filter(item => item.type === activeType);

  async function applyItem(item) {
    if (item.locked) return;
    setBusy(true);
    try {
      let ownedItem = item;
      if (!item.owned) {
        const purchase = await api.buyProfileCustomization(item.itemId);
        ownedItem = { ...item, ...purchase.item, owned: true };
        await refreshGameState();
      }
      const equipResult = await api.equipProfileCustomization(item.type, item.equipped ? null : ownedItem.itemId);
      const nextAppearance = equipResult.appearance;
      setAppearance(nextAppearance);
      setItems(current => current.map(entry => entry.type === item.type
        ? { ...entry, owned: entry.itemId === ownedItem.itemId ? true : entry.owned, equipped: item.equipped ? false : entry.itemId === ownedItem.itemId }
        : entry));
      onAppearanceChange?.(nextAppearance);
      showToast(equipResult.message || 'Profile updated');
      setSelected(null);
    } catch (error) {
      showToast(error.message || 'Could not update profile');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-studio-screen">
      <header className="profile-studio-header">
        <button type="button" className="profile-studio-back app-back-button" onClick={onBack}>Back</button>
        <h1>Studio</h1>
        <div className="profile-studio-coins">✦ {user?.coins ?? 0}</div>
      </header>

      <StudioPreview user={user} appearance={appearance} />

      <div className="profile-studio-tabs" role="tablist" aria-label="Profile customization categories">
        {Object.keys(SLOT_META).map(type => (
          <StudioTab
            key={type}
            type={type}
            active={activeType === type}
            count={items.filter(item => item.type === type).length}
            onClick={() => setActiveType(type)}
          />
        ))}
      </div>

      <div className="profile-studio-catalog-head">
        <div><span>{SLOT_META[activeType].eyebrow}</span><h2>{SLOT_META[activeType].plural}</h2></div>
        <small>{visibleItems.length} available</small>
      </div>

      {loading ? (
        <div className="profile-studio-empty">Loading profile collection...</div>
      ) : visibleItems.length === 0 ? (
        <div className="profile-studio-empty">
          <strong>No {SLOT_META[activeType].label.toLowerCase()}s yet</strong>
          <span>New profile goods will appear here when they are published.</span>
        </div>
      ) : (
        <div className="profile-studio-grid">
          {visibleItems.map(item => (
            <button
              type="button"
              key={item.itemId}
              className={`profile-studio-item${item.equipped ? ' equipped' : ''}${item.locked ? ' locked' : ''}`}
              onClick={() => setSelected(item)}
            >
              <div className="profile-studio-item-art"><ItemArtwork item={item} /></div>
              <div className="profile-studio-item-copy">
                <strong>{item.name}</strong>
                <span>{item.equipped ? 'Equipped' : item.owned ? 'Owned' : item.locked ? 'Locked' : `${item.price} ✦`}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && <DetailSheet item={selected} coins={user?.coins ?? 0} busy={busy} onClose={() => !busy && setSelected(null)} onAction={() => applyItem(selected)} />}
    </div>
  );
}
