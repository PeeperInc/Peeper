import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api';
import assetCatalog from '../assets/expeditions/root-king/asset-catalog.json';
import ArtifactDetailSheet from '../components/expedition/ArtifactDetailSheet';
import ExpeditionCombatFx from '../components/expedition/ExpeditionCombatFx';
import PersistedRoomMiniGame from '../components/expedition/PersistedRoomMiniGame';
import RewardClaimSheet from '../components/expedition/RewardClaimSheet';
import RoomEffectsBar from '../components/expedition/RoomEffectsBar';
import './FamilyExpeditionTab.css';

const roleImages = import.meta.glob('../assets/expeditions/root-king/ui/role_*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});
const provisionImages = import.meta.glob('../assets/expeditions/root-king/provisions/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});
const artifactImages = import.meta.glob('../assets/expeditions/root-king/artifacts/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});
const roomImages = import.meta.glob('../assets/expeditions/root-king/rooms/*.webp', {
  query: '?url',
  import: 'default',
});
const bossImages = import.meta.glob('../assets/expeditions/root-king/bosses/root_king_phase_*.png', {
  query: '?url',
  import: 'default',
});
const enemyImages = import.meta.glob('../assets/expeditions/root-king/enemies/*.png', {
  query: '?url',
  import: 'default',
});

const MAX_ROOM_SUPPORT = 6;

function makeIdempotencyKey(prefix) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}:${crypto.randomUUID()}`;
  }
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function titleize(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function assetById(modules, id) {
  if (!id) return null;
  const path = Object.keys(modules).find(key => key.endsWith(`/${id}.png`));
  return path ? modules[path] : null;
}

function roleImage(role) {
  return assetById(roleImages, `role_${role}`);
}

function artifactImage(artifactId) {
  return assetById(artifactImages, artifactId);
}

function normalizeEntries(value) {
  if (Array.isArray(value)) return value.map(item => [item.id, item]);
  return Object.entries(value || {});
}

function artifactIdFromLoadoutSlot(slot) {
  return slot?.artifactId ?? slot;
}

function normalizeAssetId(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function signedNumber(value) {
  const number = Number(value || 0);
  return number > 0 ? `+${number}` : String(number);
}

function formatDifficulty(value) {
  if (value === undefined || value === null || value === '') return 'Unknown';
  if (typeof value === 'number') return `DC ${value}`;
  return titleize(value);
}

function progressOutcome(progress = 0) {
  if (progress >= 5) return { label: 'Critical break', detail: '+5 progress and a rare surge' };
  if (progress >= 3) return { label: 'Strong success', detail: '+3 progress' };
  if (progress >= 2) return { label: 'Clean success', detail: '+2 progress' };
  if (progress >= 1) return { label: 'Partial success', detail: '+1 progress' };
  return { label: 'Setback', detail: '0 progress, try another approach' };
}

function combatOutcome(roll) {
  const value = Number(roll || 0);
  if (value <= 4) return { label: 'Wounded', detail: 'Hero loses 1 HP' };
  if (value <= 7) return { label: 'Miss', detail: 'No damage dealt' };
  if (value <= 15) return { label: 'Hit', detail: '1 damage' };
  if (value <= 19) return { label: 'Heavy hit', detail: '2 damage' };
  return { label: 'Critical hit', detail: '3 damage' };
}

function combatRollPreview() {
  return [
    { roll: '1-4', outcome: combatOutcome(4) },
    { roll: '5-7', outcome: combatOutcome(7) },
    { roll: '8-15', outcome: combatOutcome(15) },
    { roll: '16-19', outcome: combatOutcome(19) },
    { roll: '20', outcome: combatOutcome(20) },
  ];
}

function expectedProgressForAction(action = {}, member = {}, roleMeta = {}, support = 0, sharedBuff = 0) {
  const roleBonus = roleMeta?.stat === action.stat ? Number(roleMeta.bonus || 0) : 0;
  const base = Number(action.modifier || 0) + roleBonus + Number(support || 0) + Number(sharedBuff || 0);
  return [
    { roll: '1', outcome: progressOutcome(0) },
    { roll: '10', outcome: progressOutcome(progressForPreview(10 + base)) },
    { roll: '15', outcome: progressOutcome(progressForPreview(15 + base)) },
    { roll: '20', outcome: progressOutcome(5) },
  ];
}

function roleFromStat(stat, roles = {}) {
  return Object.entries(roles || {}).find(([, config]) => config?.stat === stat)?.[0] || null;
}

function primaryActionForRoom(room = {}, member = {}, roles = {}) {
  const safeRoom = room || {};
  const actions = safeRoom.actions || [];
  if (actions.length === 0) return null;
  const roleStat = roles?.[member?.role]?.stat;
  return actions.find(action => action.stat === roleStat)
    || actions.find(action => (safeRoom.weakRoles || []).includes(roleFromStat(action.stat, roles)))
    || actions[0];
}

function isCombatRoom(room = {}) {
  return (room?.encounterType || room?.type) === 'combat';
}

function mechanicCopy(mechanic = {}) {
  const type = mechanic?.type || 'combat';
  const copy = {
    combat: {
      title: 'Room mechanic',
      body: 'Roll once to push through the encounter. The highlighted role gets the cleanest route.',
    },
    route_choice: {
      title: 'Trap route',
      body: 'A careful roll disarms the route. Low rolls raise threat, so family support matters here.',
    },
    mimic_read: {
      title: 'Treasure read',
      body: 'The cache might bite. Clear the room before the reward is safe.',
    },
    symbol_puzzle: {
      title: 'Symbol puzzle',
      body: `Match the signs and break the seal. ${mechanic.clueCount || 2} clues are carved into the walls.`,
    },
    boss_phase: {
      title: 'Boss mechanic',
      body: 'Each roll wounds the boss phase. Any role can help, but the weak role punches through faster.',
    },
  };
  return copy[type] || copy.combat;
}

function roomRuleCopy(room = {}) {
  if (isCombatRoom(room)) {
    return {
      title: 'Combat roll',
      body: 'Roll d20. 1-4 hurts your hero. 5-7 misses. 8-15 deals 1 damage, 16-19 deals 2, 20 deals 3.',
    };
  }
  return mechanicCopy(room?.miniMechanic);
}

function progressForPreview(modifiedRoll) {
  if (modifiedRoll <= 9) return 0;
  if (modifiedRoll <= 14) return 1;
  if (modifiedRoll <= 18) return 2;
  return 3;
}

function nextPreferredRoomKey(rooms = [], selectedRoomKey = null) {
  const selected = rooms.find(room => room.key === selectedRoomKey);
  if (selected && isActionableRoom(selected)) return selected.key;
  const open = rooms.find(room => isActionableRoom(room));
  if (open) return open.key;
  if (selected && isVisibleRoom(selected)) return selected.key;
  return rooms.find(room => room.state === 'cleared')?.key
    || rooms.find(room => isVisibleRoom(room))?.key
    || null;
}

function isVisibleRoom(room) {
  return room && !['hidden', 'locked'].includes(room.state);
}

function isActionableRoom(room) {
  return room?.state === 'unlocked' && !room.clearedAt && !room.bossDefeated;
}

function findAssetModule(modules, filename) {
  if (!filename) return null;
  return Object.entries(modules).find(([path]) => path.endsWith(`/${filename}`))?.[1] || null;
}

function roomArtFile(room) {
  if (!room) return null;
  const candidates = [
    `${normalizeAssetId(room.key)}.webp`,
    `${normalizeAssetId(room.type)}.webp`,
    ...(room.tags || []).map(tag => `${normalizeAssetId(tag)}.webp`),
  ];
  const byType = {
    armory: 'cursed_armory.webp',
    archive: 'bone_archive.webp',
    boss: 'boss_sanctum.webp',
    camp: 'camp_chamber.webp',
    combat: 'crypt_gate.webp',
    gate: 'crypt_gate.webp',
    shrine: 'root_shrine.webp',
    trap: 'collapsed_gallery.webp',
    treasure: 'root_shrine.webp',
    water: 'flooded_catacomb.webp',
  };
  candidates.push(byType[room.type]);
  if ((room.tags || []).some(tag => String(tag).includes('flood'))) candidates.push('flooded_catacomb.webp');
  if ((room.tags || []).some(tag => String(tag).includes('bone'))) candidates.push('bone_archive.webp');
  if ((room.tags || []).some(tag => String(tag).includes('root'))) candidates.push('root_shrine.webp');
  return candidates.find(candidate => findAssetModule(roomImages, candidate)) || 'crypt_gate.webp';
}

function bossArtFile(room) {
  if (room?.type !== 'boss') return null;
  const phase = Math.max(1, Math.min(3, Number(room.phase || 1)));
  return `root_king_phase_${phase}.png`;
}

function enemyArtFile(room) {
  if (!room || room.type === 'boss') return null;
  const explicit = room.enemyId ? `${normalizeAssetId(room.enemyId)}.png` : null;
  const fallbackByType = {
    combat: 'rootbound_guard.png',
    mystery: 'root_cultist.png',
    treasure: 'vine_mimic.png',
    arcane: 'lantern_skull.png',
  };
  return explicit || fallbackByType[room.type] || null;
}

function useLazyAsset(modules, filename) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let active = true;
    const loader = findAssetModule(modules, filename);
    setUrl(null);
    if (!loader) return undefined;
    loader().then(value => {
      if (active) setUrl(value?.default || value);
    }).catch(() => {
      if (active) setUrl(null);
    });
    return () => { active = false; };
  }, [filename, modules]);

  return url;
}

function latestAction(actions) {
  return (actions || [])[Math.max(0, (actions || []).length - 1)] || null;
}

function actionLabel(action) {
  return action?.label || titleize(action?.id || action?.stat || 'Attempt');
}

function formatTime(ts) {
  if (!ts) return '';
  const date = new Date(ts * 1000);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function describeAction(action, memberNameById) {
  const who = memberNameById.get(action.userId) || 'Someone';
  const verb = titleize(action.actionType || 'acted').toLowerCase();
  const roll = action.modifiedRoll ? `roll ${action.modifiedRoll}` : null;
  const progress = action.progressAwarded ? `+${action.progressAwarded} progress` : null;
  return [who, verb, roll, progress].filter(Boolean).join(' / ');
}

function buildRoomLayout(rooms = [], edges = []) {
  const visibleRooms = rooms
    .filter(isVisibleRoom)
    .slice()
    .sort((a, b) => (a.depth || 0) - (b.depth || 0) || String(a.key).localeCompare(String(b.key)));
  const visibleKeys = new Set(visibleRooms.map(room => room.key));
  const byDepth = new Map();
  visibleRooms.forEach(room => {
    const depth = Number(room.depth || 0);
    byDepth.set(depth, [...(byDepth.get(depth) || []), room]);
  });

  const positions = new Map();
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  depths.forEach((depth, rowIndex) => {
    const row = (byDepth.get(depth) || []).sort((a, b) => {
      if (a.required !== b.required) return a.required ? -1 : 1;
      if (a.optional !== b.optional) return a.optional ? 1 : -1;
      return String(a.key).localeCompare(String(b.key));
    });
    const center = (row.length - 1) / 2;
    const spacing = row.length <= 3 ? 1.15 : Math.max(0.62, 4.2 / Math.max(1, row.length - 1));
    row.forEach((room, index) => {
      const lane = (index - center) * spacing + (room.optional ? (index % 2 === 0 ? -0.12 : 0.12) : 0);
      positions.set(room.key, {
        x: Math.max(8, Math.min(92, 50 + lane * 20)),
        y: 34 + rowIndex * 92,
        rowIndex,
      });
    });
  });

  const height = Math.max(174, 80 + Math.max(0, depths.length - 1) * 92);
  const paths = edges
    .filter(edge => visibleKeys.has(edge.from) && visibleKeys.has(edge.to))
    .map(edge => {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) return null;
      const midY = (from.y + to.y) / 2;
      return {
        key: `${edge.from}:${edge.to}`,
        d: `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`,
      };
    })
    .filter(Boolean);

  return { positions, paths, height };
}

function useCatalogMaps(canonicalArtifacts = []) {
  return useMemo(() => {
    const artifacts = new Map((assetCatalog.artifacts || []).map(item => [item.id, item]));
    for (const item of canonicalArtifacts || []) {
      artifacts.set(item.id, { ...(artifacts.get(item.id) || {}), ...item });
    }
    const provisions = new Map((assetCatalog.provisions || []).map(item => [item.id, item]));
    return { artifacts, provisions };
  }, [canonicalArtifacts]);
}

function ExpeditionIntro({ loading, onStart, permissions }) {
  return (
    <div className="expedition-card expedition-intro">
      <div className="expedition-kicker">Family Expedition</div>
      <h2>The Root King's dungeon waits below.</h2>
      <p>
        Rally your family, pick roles, pack provisions, and prepare a three-artifact loadout before
        the next build opens the full dungeon map.
      </p>
      <div className="expedition-intro-stats">
        <span>4 roles</span>
        <span>Shared map</span>
        <span>Family prep</span>
      </div>
      <button
        type="button"
        className="btn btn-primary btn-full expedition-cta"
        onClick={onStart}
        disabled={loading || !permissions?.canStart}
      >
        {loading ? 'Opening gate...' : permissions?.canStart ? 'Start Expedition' : 'Waiting for permission'}
      </button>
    </div>
  );
}

function PreparationFlow({ state, loading, onPrepare }) {
  const { artifacts, provisions: provisionNames } = useCatalogMaps(state.catalog?.artifacts);
  const roleEntries = normalizeEntries(state.catalog?.roles);
  const provisionEntries = normalizeEntries(state.catalog?.provisions);
  const [role, setRole] = useState(() => roleEntries[0]?.[0] || 'knight');
  const [provisionId, setProvisionId] = useState(null);
  const [artifactIds, setArtifactIds] = useState([]);
  const [artifactDetailId, setArtifactDetailId] = useState(null);

  useEffect(() => {
    if (!roleEntries.some(([id]) => id === role)) setRole(roleEntries[0]?.[0] || 'knight');
    if (provisionId && !provisionEntries.some(([id]) => id === provisionId)) setProvisionId(null);
  }, [provisionEntries, provisionId, role, roleEntries]);

  function addArtifact(id) {
    setArtifactIds(prev => (prev.length >= 3 ? prev : [...prev, id]));
    setArtifactDetailId(null);
  }

  const inventory = state.artifactInventory || [];
  const detailInventoryItem = inventory.find(item => item.artifactId === artifactDetailId);
  const detailMeta = artifactDetailId ? artifacts.get(artifactDetailId) : null;
  const detailSelectedCount = artifactIds.filter(id => id === artifactDetailId).length;
  const detailDisabledReason = artifactIds.length >= 3
    ? 'All three expedition slots are filled.'
    : detailInventoryItem && detailSelectedCount >= Number(detailInventoryItem.quantity || 0)
      ? 'Every owned copy is already in your loadout.'
      : '';

  return (
    <div className="expedition-prep">
      <div className="expedition-card expedition-prep-header">
        <div>
          <div className="expedition-kicker">Preparation</div>
          <h2>Choose your kit</h2>
        </div>
        <div className="expedition-ap-chip">3 slots</div>
      </div>

      <section>
        <div className="expedition-section-title">Role</div>
        <div className="expedition-role-grid">
          {roleEntries.map(([id, meta]) => (
            <button
              type="button"
              key={id}
              className={`expedition-choice expedition-role-card${role === id ? ' selected' : ''}`}
              onClick={() => setRole(id)}
            >
              {roleImage(id) && <img src={roleImage(id)} alt="" />}
              <strong>{titleize(id)}</strong>
              <span>{titleize(meta?.stat)} +{meta?.bonus ?? 0}</span>
              <small>{titleize(meta?.ability)}</small>
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="expedition-section-title">Provision</div>
        <div className="expedition-provision-grid">
          <button
            type="button"
            className={`expedition-choice expedition-provision-card${!provisionId ? ' selected' : ''}`}
            onClick={() => setProvisionId(null)}
          >
            <span className="expedition-provision-empty">None</span>
            <strong>Travel Light</strong>
            <small>No provision</small>
          </button>
          {provisionEntries.map(([id, meta]) => {
            const named = provisionNames.get(id);
            const image = assetById(provisionImages, id);
            const recipe = meta?.recipe;
            const unavailable = Boolean(recipe && meta.available === false);
            const recipeLabel = recipe
              ? `${meta.ownedQuantity || 0}/${recipe.quantity} ${titleize(recipe.productId)}`
              : titleize(meta?.effect?.type || 'provision');
            return (
              <button
                type="button"
                key={id}
                className={`expedition-choice expedition-provision-card${provisionId === id ? ' selected' : ''}${unavailable ? ' unavailable' : ''}`}
                onClick={() => setProvisionId(id)}
                disabled={unavailable}
              >
                {image && <img src={image} alt="" />}
                <strong>{meta?.name || named?.name || titleize(id)}</strong>
                <span>{recipeLabel}</span>
                <small>{unavailable ? 'Missing farm product' : titleize(meta?.effect?.type || 'provision')}</small>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <div className="expedition-section-title">Artifacts</div>
        <div className="expedition-loadout-slots">
          {[0, 1, 2].map(index => {
            const id = artifactIds[index];
            const item = id ? artifacts.get(id) : null;
            return (
              <button
                type="button"
                key={index}
                className={`expedition-loadout-slot${id ? ' filled' : ''}`}
                onClick={() => id && setArtifactIds(prev => prev.filter((_, slotIndex) => slotIndex !== index))}
                disabled={!id}
                aria-label={id ? `Remove ${item?.name || titleize(id)} from slot ${index + 1}` : `Empty slot ${index + 1}`}
              >
                {id ? item?.name || titleize(id) : `Slot ${index + 1}`}
              </button>
            );
          })}
        </div>
        {inventory.length > 0 ? (
          <div className="expedition-artifact-grid">
            {inventory.map(item => {
              const id = item.artifactId;
              const meta = artifacts.get(id);
              const selectedCount = artifactIds.filter(selectedId => selectedId === id).length;
              const selected = selectedCount > 0;
              const image = assetById(artifactImages, id);
              return (
                <button
                  type="button"
                  key={id}
                  className={`expedition-choice expedition-artifact-card rarity-${meta?.rarity || 'common'}${selected ? ' selected' : ''}`}
                  onClick={() => setArtifactDetailId(id)}
                >
                  {image && <img src={image} alt="" />}
                  <strong>{meta?.name || titleize(id)}</strong>
                  <small>{meta?.displayEffect || meta?.effect || `Owned x${item.quantity || 1}`}</small>
                  {selectedCount > 0 && <span>Equipped x{selectedCount}</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="expedition-empty">No artifacts found yet. You can prepare without them.</div>
        )}
      </section>

      <button
        type="button"
        className="btn btn-primary btn-full expedition-cta"
        onClick={() => onPrepare({ role, provisionId, artifactIds })}
        disabled={loading || !role}
      >
        {loading ? 'Preparing...' : 'Lock In Preparation'}
      </button>

      {artifactDetailId && detailMeta && (
        <ArtifactDetailSheet
          artifact={{
            ...detailMeta,
            image: artifactImage(artifactDetailId),
            quantity: detailInventoryItem?.quantity || 0,
            selectedQuantity: detailSelectedCount,
          }}
          mode="take"
          disabledReason={detailDisabledReason}
          onConfirm={() => addArtifact(artifactDetailId)}
          onClose={() => setArtifactDetailId(null)}
        />
      )}
    </div>
  );
}

function DungeonMap({ rooms, edges, selectedKey, onSelect }) {
  const visibleRooms = useMemo(() => rooms.filter(isVisibleRoom), [rooms]);
  const { positions, paths, height } = useMemo(() => buildRoomLayout(visibleRooms, edges), [visibleRooms, edges]);
  const nodeRefs = useRef(new Map());

  useEffect(() => {
    const node = nodeRefs.current.get(selectedKey);
    if (!node) return;
    node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }, [selectedKey]);

  return (
    <div className="expedition-card expedition-dungeon-card">
      <div className="expedition-map-heading">
        <div>
          <div className="expedition-kicker">Dungeon Map</div>
          <strong>Crypt of the Root King</strong>
        </div>
        <span>{visibleRooms.length} seen</span>
      </div>

      <div className="expedition-map-scroll">
        <div className="expedition-map-stage" style={{ height }}>
          <svg className="expedition-map-edges" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true">
            {paths.map(path => <path key={path.key} d={path.d} />)}
          </svg>
          {visibleRooms.map(room => {
            const position = positions.get(room.key) || { x: 50, y: 40 };
            const visible = isVisibleRoom(room);
            const selected = selectedKey === room.key;
            const canSelect = visible;
            const label = visible ? (room.name || titleize(room.type || 'Room')) : 'Veiled Door';
            const progress = room.progressTarget ? Math.round(((room.progress || 0) / room.progressTarget) * 100) : 0;

            return (
              <button
                type="button"
                key={room.key}
                ref={node => {
                  if (node) nodeRefs.current.set(room.key, node);
                  else nodeRefs.current.delete(room.key);
                }}
                className={[
                  'expedition-map-node',
                  `state-${room.state || 'unknown'}`,
                  room.type === 'boss' ? 'is-boss' : '',
                  room.optional ? 'is-optional' : '',
                  selected ? 'selected' : '',
                ].filter(Boolean).join(' ')}
                style={{ left: `${position.x}%`, top: position.y }}
                onClick={() => canSelect && onSelect(room.key)}
                disabled={!canSelect}
                aria-pressed={selected}
              >
                <span className="expedition-node-icon">{room.type === 'boss' ? 'III' : room.depth ?? '?'}</span>
                <span className="expedition-node-label">{label}</span>
                {visible && room.state !== 'locked' && (
                  <span className="expedition-node-meter"><i style={{ width: `${Math.min(100, progress)}%` }} /></span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="expedition-map-legend">
        <span><i className="legend-unlocked" /> Open</span>
        <span><i className="legend-cleared" /> Cleared</span>
        <span><i className="legend-hidden" /> Future rooms stay hidden</span>
      </div>
    </div>
  );
}

function ExpeditionOverlay({ title, kicker, onClose, children, wide = false }) {
  return (
    <div className="expedition-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="expedition-overlay-backdrop" onClick={onClose} aria-label="Close" />
      <div className={`expedition-overlay-panel${wide ? ' wide' : ''}`}>
        <div className="expedition-overlay-header">
          <div>
            {kicker && <div className="expedition-kicker">{kicker}</div>}
            <h2>{title}</h2>
          </div>
          <button type="button" className="expedition-icon-button" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ExpeditionGuidePanel() {
  return (
    <div className="expedition-guide-grid">
      <div className="expedition-guide-card">
        <strong>1. Rooms are checks</strong>
        <span>Every roll costs 1 AP. The final d20 result adds progress to the current room. More family members means more daily AP, so the dungeon moves faster.</span>
      </div>
      <div className="expedition-guide-card">
        <strong>2. Combat rolls</strong>
        <span>Mob rooms use one clean d20: 1-4 wounds your hero, 5-7 misses, 8-15 deals 1, 16-19 deals 2, and 20 deals 3.</span>
      </div>
      <div className="expedition-guide-card">
        <strong>3. Rewards open on clear</strong>
        <span>Treasure is paid when the room is cleared, not on every roll. Criticals and some relics can still create bonus luck.</span>
      </div>
      <div className="expedition-guide-card">
        <strong>4. Support is teamwork</strong>
        <span>Assist stores family support on the current room. The next hero can spend it as a direct roll bonus.</span>
      </div>
      <div className="expedition-guide-card">
        <strong>5. Scout pathing</strong>
        <span>The map hides future rooms. Scouts are the pathfinders: their ability opens the next unknown route when the family needs a choice.</span>
      </div>
      <div className="expedition-guide-card">
        <strong>6. Roles still matter</strong>
        <span>Each room highlights best roles. Anyone can roll, but the matching hero gets the cleanest modifier.</span>
      </div>
    </div>
  );
}

function LastRollPanel({ action }) {
  if (!action || action.actionType !== 'attempt') return null;
  const loot = action.loot || {};
  const modifierParts = action.modifiers?.parts || [];
  const events = action.events || action.modifiers?.events || [];
  const combatEvent = events.find(event => event.type === 'combat_roll');
  const damageEvent = events.find(event => event.type === 'hero_damaged');
  const combatCopy = combatEvent ? {
    wounded: 'Wounded',
    miss: 'Miss',
    hit: 'Hit',
    strong_hit: 'Heavy hit',
    critical_hit: 'Critical hit',
  }[combatEvent.outcome] || titleize(combatEvent.outcome) : null;

  return (
    <div className="expedition-last-roll">
      <div className="expedition-last-roll-die">
        <span>d20</span>
        <strong>{action.rawRoll ?? '?'}</strong>
      </div>
      <div className="expedition-last-roll-copy">
        <div>
          <strong>Last Roll</strong>
          {combatEvent ? (
            <span>
              {combatCopy} / {combatEvent.progress || 0} mob damage
              {damageEvent ? ` / HP ${damageEvent.heroHp}/3` : ''}
            </span>
          ) : (
            <span>Modified {action.modifiedRoll ?? '?'} / +{action.progressAwarded || 0} progress</span>
          )}
        </div>
        {modifierParts.length > 0 && (
          <small>
            {modifierParts.slice(0, 3).map(part => `${titleize(part.source)} ${signedNumber(part.amount)}`).join(' / ')}
          </small>
        )}
        {(loot.coins || loot.artifactRolls || loot.artifactId) && (
          <small>
            Loot: {[loot.coins ? `${loot.coins} coins` : null, loot.artifactRolls ? `${loot.artifactRolls} artifact roll` : null, loot.artifactId ? titleize(loot.artifactId) : null].filter(Boolean).join(' / ')}
          </small>
        )}
      </div>
    </div>
  );
}

function RoleAbilityControl({ member, room, mutating, onUse }) {
  if (!member?.role || member.role === 'scout' || !isActionableRoom(room)) return null;
  const copy = {
    mage: ['Place Bend Fate', 'Family advantage or one free mini-game retry.'],
    knight: ['Place Knight Shield', 'Blocks the next family hit in this room.'],
    cleric: ['Family Prayer', 'Heal wounded heroes and shorten recovery.'],
  }[member.role];
  if (!copy) return null;
  const ready = Number(member.roleCharge || 0) > 0;
  const effectType = member.role === 'knight' ? 'knight_shield' : member.role === 'mage' ? 'bend_fate' : null;
  const alreadyActive = effectType && (room.activeEffects || []).some(effect => effect.effectType === effectType);

  return (
    <button
      type="button"
      className={`expedition-toggle-tile${ready ? ' active' : ''}`}
      onClick={() => onUse(room.key)}
      disabled={!ready || mutating || alreadyActive}
    >
      <strong>{copy[0]}</strong>
      <span>{alreadyActive ? 'Already active in this room.' : ready ? copy[1] : `Recharge ${member.roleChargeProgress || 0}/3 AP`}</span>
    </button>
  );
}

function SupportPicker({ support, selected, onChange }) {
  const max = Math.max(0, Number(support || 0));
  if (max <= 0) return <div className="expedition-support-empty">No family support banked.</div>;

  return (
    <div className="expedition-support-picker">
      <span>Use support</span>
      <div>
        <button type="button" onClick={() => onChange(Math.max(0, selected - 1))} disabled={selected <= 0}>-</button>
        <strong>+{selected}</strong>
        <button type="button" onClick={() => onChange(Math.min(max, selected + 1))} disabled={selected >= max}>+</button>
        <button type="button" onClick={() => onChange(max)} disabled={selected >= max}>Max</button>
      </div>
    </div>
  );
}

function ScoutChoicePanel({ room, member, roles, mutating, onScoutChoice }) {
  const choices = Array.isArray(room?.scoutChoices) ? room.scoutChoices : [];
  if (room?.scoutChoice?.choiceId) {
    return (
      <div className="expedition-scout-choice locked">
        <div>
          <strong>Next room chosen</strong>
          <span>{room.scoutChoice.label || 'The family path is set.'}</span>
        </div>
      </div>
    );
  }
  if (member?.role !== 'scout' || Number(member.roleCharge || 0) <= 0 || choices.length === 0 || !['unlocked', 'cleared'].includes(room?.state)) {
    return null;
  }

  return (
    <div className="expedition-scout-choice">
      <div className="expedition-scout-choice-head">
        <div>
          <strong>Scout the next room</strong>
          <span>Pick one future encounter. Other scouts cannot change this room after that.</span>
        </div>
      </div>
      <div className="expedition-scout-choice-grid">
        {choices.map(choice => {
          const choiceRoom = choice.room || {};
          const bestRoles = (choiceRoom.weakRoles || []).map(role => roles?.[role]?.name || titleize(role)).join(' / ') || 'Any hero';
          return (
            <button
              type="button"
              key={choice.id}
              onClick={() => onScoutChoice(room.key, choice.id)}
              disabled={mutating}
            >
              <span>{titleize(choiceRoom.type || 'room')}</span>
              <strong>{choice.label || choiceRoom.name || titleize(choiceRoom.type || 'Path')}</strong>
              <small>Best: {bestRoles}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EventMiniGame({ room, mutating, disabled, onComplete }) {
  const runeTimerRef = useRef(null);
  const scoutTimerRef = useRef(null);
  const shadowTimerRef = useRef(null);
  const scoutStageRef = useRef(null);
  const [active, setActive] = useState(false);
  const [marker, setMarker] = useState(12);
  const [direction, setDirection] = useState(1);
  const [charge, setCharge] = useState(0);
  const [focusTarget, setFocusTarget] = useState(72);
  const [runeInput, setRuneInput] = useState([]);
  const [runeSequence, setRuneSequence] = useState([]);
  const [runeStarted, setRuneStarted] = useState(false);
  const [previewActive, setPreviewActive] = useState(false);
  const [previewStep, setPreviewStep] = useState(-1);
  const [memoryReady, setMemoryReady] = useState(false);
  const [resultFlash, setResultFlash] = useState(null);
  const [scoutRun, setScoutRun] = useState({ x: 50, y: 90, score: 0, running: false, hits: 0, hitUntil: 0, obstacles: [] });
  const [shadowHunt, setShadowHunt] = useState({ phase: 'idle', targets: [], correct: 0, startedAt: 0 });
  const miniGame = room?.miniGame || {};
  const kind = miniGame.kind || 'timing_window';
  const runeSymbols = ['rune', 'root', 'moon', 'skull', 'crown', 'fang', 'lantern', 'key', 'eye'];
  const safeGlyphs = { rune: 'R', root: 'RT', moon: 'M', skull: 'SK', crown: 'CR', fang: 'F', lantern: 'L', key: 'K', eye: 'E' };
  const stableRoomHash = String(room?.key || '').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const memoryGame = kind === 'rune_sequence';
  const scoutTraffic = useMemo(() => createScoutTraffic(stableRoomHash), [stableRoomHash]);

  useEffect(() => {
    if (runeTimerRef.current) {
      window.clearInterval(runeTimerRef.current);
      runeTimerRef.current = null;
    }
    if (scoutTimerRef.current) {
      window.clearInterval(scoutTimerRef.current);
      scoutTimerRef.current = null;
    }
    if (shadowTimerRef.current) {
      window.clearTimeout(shadowTimerRef.current);
      shadowTimerRef.current = null;
    }
    setActive(false);
    setMarker(12);
    setDirection(1);
    setCharge(0);
    setFocusTarget(randomFocusTarget());
    setRuneInput([]);
    setRuneSequence([]);
    setRuneStarted(false);
    setPreviewActive(false);
    setPreviewStep(-1);
    setMemoryReady(!memoryGame);
    setResultFlash(null);
    setScoutRun({ x: 50, y: 90, score: 0, running: false, hits: 0, hitUntil: 0, obstacles: scoutTraffic });
    setShadowHunt({ ...createShadowTargets(), phase: 'idle', startedAt: 0 });
    return () => {
      if (runeTimerRef.current) {
        window.clearInterval(runeTimerRef.current);
        runeTimerRef.current = null;
      }
      if (scoutTimerRef.current) {
        window.clearInterval(scoutTimerRef.current);
        scoutTimerRef.current = null;
      }
      if (shadowTimerRef.current) {
        window.clearTimeout(shadowTimerRef.current);
        shadowTimerRef.current = null;
      }
    };
  }, [room?.key, kind, memoryGame, scoutTraffic]);

  useEffect(() => {
    setPreviewActive(false);
    setPreviewStep(-1);
    setMemoryReady(kind !== 'rune_sequence');
    return undefined;
  }, [kind, room?.key]);

  useEffect(() => {
    if (!active || !['focus_hold', 'timing_window'].includes(kind)) return undefined;
    const id = window.setInterval(() => {
      if (kind === 'focus_hold') {
        setCharge(value => Math.min(100, value + 5));
      } else {
        setMarker(value => {
          const next = value + direction * 7;
          if (next >= 96) {
            setDirection(-1);
            return 96;
          }
          if (next <= 4) {
            setDirection(1);
            return 4;
          }
          return next;
        });
      }
    }, 70);
    return () => window.clearInterval(id);
  }, [active, direction, kind]);

  useEffect(() => {
    if (kind !== 'shadow_match' || shadowHunt.targets.length === 0 || Boolean(resultFlash)) return undefined;
    const id = window.setInterval(() => {
      setShadowHunt(current => (
        ['idle', 'watch', 'hunt'].includes(current.phase)
          ? { ...current, targets: moveShadowTargets(current.targets) }
          : current
      ));
    }, 48);
    return () => window.clearInterval(id);
  }, [kind, resultFlash, shadowHunt.phase, shadowHunt.targets.length]);

  const score = Math.max(0, Math.round(100 - Math.abs(marker - 50) * 2));
  const focusScore = charge >= 99 ? 0 : Math.max(0, Math.round(100 - Math.abs(charge - focusTarget) * 2.25));
  const locked = disabled || mutating || Boolean(resultFlash);
  const canSubmit = active && !locked;
  const roomActionVerb = {
    timing_window: 'Cut Through',
    focus_hold: 'Release',
    path_pick: 'Commit Path',
    shadow_match: 'Lock Shadow',
    rune_sequence: 'Seal Runes',
  }[kind] || 'Complete';
  const miniGameTone = {
    timing_window: ['Trap gauntlet', 'Start the trap, then cut through the gold window.'],
    focus_hold: ['Focus rite', 'Hold the pulse and release on the changing target.'],
    rune_sequence: ['Rune forge', 'Watch the seal flare, then press the vanished runes in order.'],
    path_pick: ['Scout run', 'Drag the scout light through the glowing route without touching roots.'],
    shadow_match: ['Shadow hunt', 'Watch the true shadow breathe, then tap it before it fades.'],
  }[kind] || ['Dungeon trick', 'Beat the room challenge to push deeper.'];

  function scoreLabel(finalScore) {
    if (finalScore >= 90) return 'Perfect';
    if (finalScore >= 72) return 'Great';
    if (finalScore >= 48) return 'Good';
    return 'Shaky';
  }

  async function showResultAndComplete(finalScore) {
    const normalized = Math.max(0, Math.min(100, Math.round(finalScore)));
    setResultFlash({ score: normalized, label: scoreLabel(normalized) });
    await new Promise(resolve => window.setTimeout(resolve, 520));
    await onComplete(room.key, normalized);
    setResultFlash(null);
    setActive(false);
    setRuneInput([]);
    setRuneSequence([]);
    setRuneStarted(false);
    setPreviewActive(false);
    setPreviewStep(-1);
    setMemoryReady(kind !== 'rune_sequence');
    setFocusTarget(randomFocusTarget());
    setScoutRun(prev => ({ ...prev, running: false }));
    setShadowHunt({ ...createShadowTargets(), phase: 'idle', startedAt: 0 });
    if (runeTimerRef.current) {
      window.clearInterval(runeTimerRef.current);
      runeTimerRef.current = null;
    }
    if (scoutTimerRef.current) {
      window.clearInterval(scoutTimerRef.current);
      scoutTimerRef.current = null;
    }
    if (shadowTimerRef.current) {
      window.clearTimeout(shadowTimerRef.current);
      shadowTimerRef.current = null;
    }
  }

  async function finish(finalScore = score) {
    if (!canSubmit) return;
    setActive(false);
    await showResultAndComplete(finalScore);
  }

  async function finishImmediate(finalScore) {
    if (locked) return;
    setActive(false);
    await showResultAndComplete(finalScore);
  }

  function startChallenge() {
    if (locked || active) return;
    setMarker(12);
    setDirection(1);
    setCharge(0);
    setActive(true);
  }

  function randomRuneSequence() {
    const pool = [...runeSymbols];
    const next = [];
    while (next.length < 3 && pool.length > 0) {
      const index = Math.floor(Math.random() * pool.length);
      next.push(pool.splice(index, 1)[0]);
    }
    return next;
  }

  function randomFocusTarget() {
    return 34 + Math.floor(Math.random() * 49);
  }

  function createScoutTraffic(seed) {
    const base = seed || 23;
    const laneYs = [74, 60, 46, 32, 18];
    return laneYs.flatMap((y, laneIndex) => {
      const direction = laneIndex % 2 === 0 ? -1 : 1;
      const speed = direction * (0.58 + laneIndex * 0.07);
      return [0, 1].map(carIndex => ({
        id: `lane-${laneIndex}-root-${carIndex}`,
        y,
        x: (base * (laneIndex + 3) + carIndex * 47 + laneIndex * 11) % 100,
        width: 16 + ((base + laneIndex + carIndex) % 8),
        speed,
      }));
    });
  }

  function startRuneChallenge() {
    if (locked || runeStarted || kind !== 'rune_sequence') return;
    const sequence = randomRuneSequence();
    setRuneSequence(sequence);
    setRuneInput([]);
    setRuneStarted(true);
    setPreviewActive(true);
    setMemoryReady(false);
    setPreviewStep(0);
    let step = 0;
    if (runeTimerRef.current) window.clearInterval(runeTimerRef.current);
    runeTimerRef.current = window.setInterval(() => {
      step += 1;
      if (step >= sequence.length) {
        window.clearInterval(runeTimerRef.current);
        runeTimerRef.current = null;
        setPreviewStep(-1);
        setPreviewActive(false);
        setMemoryReady(true);
      } else {
        setPreviewStep(step);
      }
    }, 650);
  }

  function startFocusHold(event) {
    event?.preventDefault?.();
    if (locked || active) return;
    setCharge(0);
    setFocusTarget(randomFocusTarget());
    setActive(true);
  }

  function releaseFocusHold(event) {
    event?.preventDefault?.();
    if (!active || locked || kind !== 'focus_hold') return;
    finish(focusScore);
  }

  function calculateScoutScore(next) {
    const progress = Math.max(0, Math.min(1, (90 - next.y) / 82));
    return Math.max(0, Math.min(100, Math.round(28 + progress * 78 - next.hits * 18)));
  }

  function startScoutRun() {
    if (locked || active) return;
    const next = { x: 50, y: 90, score: 28, running: true, hits: 0, hitUntil: 0, obstacles: scoutTraffic };
    setScoutRun(next);
    setActive(true);
    if (scoutTimerRef.current) window.clearInterval(scoutTimerRef.current);
    scoutTimerRef.current = window.setInterval(() => {
      setScoutRun(current => {
        if (!current.running) return current;
        const now = Date.now();
        const obstacles = current.obstacles.map(obstacle => {
          let x = obstacle.x + obstacle.speed;
          if (x < -18) x = 118;
          if (x > 118) x = -18;
          return { ...obstacle, x };
        });
        let hits = current.hits;
        let hitUntil = current.hitUntil;

        const collided = obstacles.some(obstacle => (
          Math.abs(current.y - obstacle.y) < 5.8
          && Math.abs(current.x - obstacle.x) < (obstacle.width / 2 + 4.5)
        ));
        if (collided && now > current.hitUntil) {
          hits += 1;
          hitUntil = now + 620;
        }

        const next = {
          ...current,
          hits,
          hitUntil,
          obstacles,
        };
        next.score = calculateScoutScore(next);
        return next;
      });
    }, 50);
  }

  function handleScoutMove(event) {
    if (!active || locked || kind !== 'path_pick') return;
    const rect = scoutStageRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const nextX = Math.max(9, Math.min(91, ((event.clientX - rect.left) / rect.width) * 100));
    const nextY = Math.max(6, Math.min(92, ((event.clientY - rect.top) / rect.height) * 100));
    setScoutRun(current => {
      const next = { ...current, x: nextX, y: nextY };
      next.score = calculateScoutScore(next);
      if (next.y <= 8) {
        finishImmediate(next.score);
        return { ...next, running: false };
      }
      return next;
    });
  }

  function createShadowTargets() {
    const correct = Math.floor(Math.random() * 4);
    const anchors = [
      { x: 22, y: 28 },
      { x: 74, y: 30 },
      { x: 27, y: 72 },
      { x: 76, y: 70 },
    ];
    const targets = anchors.map((anchor, index) => {
      const dir = ((stableRoomHash + index) % 2) === 0 ? 1 : -1;
      return {
        id: index,
        x: anchor.x + (Math.random() * 8 - 4),
        y: anchor.y + (Math.random() * 8 - 4),
        vx: (0.42 + Math.random() * 0.22) * dir,
        vy: (0.32 + Math.random() * 0.2) * (index % 2 === 0 ? 1 : -1),
      };
    });
    return { correct, targets };
  }

  function moveShadowTargets(targets) {
    const next = targets.map(target => {
      let x = target.x + target.vx;
      let y = target.y + target.vy;
      let vx = target.vx;
      let vy = target.vy;
      if (x < 13 || x > 87) {
        vx *= -1;
        x = Math.max(13, Math.min(87, x));
      }
      if (y < 18 || y > 82) {
        vy *= -1;
        y = Math.max(18, Math.min(82, y));
      }
      return { ...target, x, y, vx, vy };
    });

    for (let left = 0; left < next.length; left += 1) {
      for (let right = left + 1; right < next.length; right += 1) {
        const dx = next[right].x - next[left].x;
        const dy = next[right].y - next[left].y;
        const distance = Math.max(0.1, Math.hypot(dx, dy));
        if (distance >= 24) continue;
        const push = (24 - distance) / 2;
        const nx = dx / distance;
        const ny = dy / distance;
        next[left].x = Math.max(13, Math.min(87, next[left].x - nx * push));
        next[left].y = Math.max(18, Math.min(82, next[left].y - ny * push));
        next[right].x = Math.max(13, Math.min(87, next[right].x + nx * push));
        next[right].y = Math.max(18, Math.min(82, next[right].y + ny * push));
      }
    }

    return next;
  }

  function startShadowHunt() {
    if (locked || active) return;
    const next = shadowHunt.targets.length > 0 ? shadowHunt : createShadowTargets();
    setActive(true);
    setShadowHunt({ ...next, phase: 'watch', startedAt: Date.now() });
    if (shadowTimerRef.current) window.clearTimeout(shadowTimerRef.current);
    shadowTimerRef.current = window.setTimeout(() => {
      setShadowHunt(current => ({ ...current, phase: 'hunt', startedAt: Date.now() }));
      shadowTimerRef.current = window.setTimeout(() => {
        finishImmediate(0);
      }, 3600);
    }, 980);
  }

  function finishShadowHunt(targetId) {
    if (locked || !active || shadowHunt.phase !== 'hunt') return;
    if (shadowTimerRef.current) {
      window.clearTimeout(shadowTimerRef.current);
      shadowTimerRef.current = null;
    }
    const elapsedMs = Date.now() - shadowHunt.startedAt;
    const finalScore = targetId === shadowHunt.correct
      ? Math.max(62, Math.min(100, Math.round(104 - elapsedMs / 42)))
      : 0;
    finishImmediate(finalScore);
  }

  function handleRune(symbol) {
    if (locked || !memoryReady || !runeStarted) return;
    const next = [...runeInput, symbol];
    if (runeSequence[next.length - 1] !== symbol) {
      setRuneInput([]);
      finishImmediate(0);
      return;
    }
    setRuneInput(next);
    if (next.length >= runeSequence.length) {
      finishImmediate(96);
    }
  }

  return (
    <div className="expedition-event-game">
      {resultFlash && (
        <div className={`expedition-event-result ${resultFlash.score >= 80 ? 'great' : resultFlash.score >= 50 ? 'ok' : 'bad'}`}>
          <strong>{resultFlash.label}</strong>
          <span>{resultFlash.score}% clear</span>
        </div>
      )}
      <div className="expedition-event-game-copy">
        <span>{miniGameTone[0]}</span>
        <strong>{miniGame.label || roomActionVerb}</strong>
        <small>{miniGame.instruction || miniGameTone[1]}</small>
      </div>

      {kind === 'rune_sequence' ? (
        <>
          <div className="expedition-memory-cue">
            <span>{!runeStarted ? 'Press Start to reveal 3 runes' : previewActive ? 'Watch the rune order' : 'Repeat the vanished sequence'}</span>
            <strong>{!runeStarted ? '9 runes / 3 answers' : previewActive ? 'Memory window' : `${runeInput.length}/3 locked`}</strong>
          </div>
          <div className="expedition-rune-sequence">
            {runeSymbols.map(symbol => {
              const sequenceIndex = runeSequence.indexOf(symbol);
              const solved = runeInput.includes(symbol);
              const visible = previewActive && sequenceIndex === previewStep;
              return (
              <i
                key={symbol}
                className={`${solved ? 'done' : ''}${visible ? ' preview' : ''}${!visible && !solved ? ' hidden' : ''}`}
              >
                {safeGlyphs[symbol] || symbol.slice(0, 1).toUpperCase()}
              </i>
            );
            })}
          </div>
          <div className="expedition-event-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={startRuneChallenge}
              disabled={locked || runeStarted}
            >
              Start Runes
            </button>
            <button type="button" className="btn btn-primary" disabled>
              {memoryReady ? 'Enter 3 runes' : 'Watch'}
            </button>
          </div>
          <div className="expedition-event-choice-grid">
            {runeSymbols.map(symbol => (
              <button type="button" key={symbol} onClick={() => handleRune(symbol)} disabled={locked || !memoryReady || !runeStarted}>
                <strong>{safeGlyphs[symbol]}</strong>
                <span>{titleize(symbol)}</span>
              </button>
            ))}
          </div>
        </>
      ) : kind === 'path_pick' ? (
        <>
          <div
            ref={scoutStageRef}
            className={`expedition-scout-run${active ? ' active' : ''}`}
            onPointerDown={handleScoutMove}
            onPointerMove={handleScoutMove}
            style={{ '--scout-x': `${scoutRun.x}%`, '--scout-y': `${scoutRun.y}%` }}
          >
            {[74, 60, 46, 32, 18].map((laneY, index) => (
              <span key={laneY} className="expedition-scout-lane" style={{ '--lane-y': `${laneY}%` }}>
                <b>{index % 2 === 0 ? '<<<' : '>>>'}</b>
              </span>
            ))}
            {scoutRun.obstacles.map(obstacle => (
              <span
                key={obstacle.id}
                className="expedition-scout-car"
                style={{
                  '--car-x': `${obstacle.x}%`,
                  '--car-y': `${obstacle.y}%`,
                  '--car-width': `${obstacle.width}%`,
                }}
              >
                <i />
              </span>
            ))}
            <span className="expedition-scout-progress" />
            <i className={`expedition-scout-light${scoutRun.hitUntil > Date.now() ? ' hit' : ''}`}><b /></i>
            <span className="expedition-scout-gate start">START</span>
            <span className="expedition-scout-gate finish">EXIT</span>
          </div>
          <div className="expedition-memory-cue">
            <span>{active ? 'Cross the root traffic and reach EXIT' : 'Drag the scout across moving root lanes'}</span>
            <strong>{active ? `${scoutRun.score}% / ${scoutRun.hits} hits` : 'Frogger run'}</strong>
          </div>
          <div className="expedition-event-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={startScoutRun}
              disabled={locked || active}
            >
              Start Run
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => finishImmediate(scoutRun.score)}
              disabled={!canSubmit}
            >
              {mutating ? 'Resolving...' : 'Finish Early'}
            </button>
          </div>
        </>
      ) : kind === 'shadow_match' ? (
        <>
          <div className={`expedition-shadow-hunt ${shadowHunt.phase}`}>
            {shadowHunt.targets.length === 0 && (
              <div className="expedition-shadow-empty">
                <strong>Dark room</strong>
                <span>Start the hunt. Watch for the green breath.</span>
              </div>
            )}
            {shadowHunt.targets.map(target => (
              <button
                type="button"
                key={target.id}
                className={target.id === shadowHunt.correct ? 'true-shadow' : ''}
                style={{
                  '--shadow-x': `${target.x}%`,
                  '--shadow-y': `${target.y}%`,
                }}
                onClick={() => finishShadowHunt(target.id)}
                disabled={locked || shadowHunt.phase !== 'hunt'}
              >
                <i />
                <b />
              </button>
            ))}
          </div>
          <div className={`expedition-memory-cue ${shadowHunt.phase === 'hunt' ? 'is-hidden' : ''}`}>
            <span>{shadowHunt.phase === 'watch' ? 'The real shadow breathes green' : shadowHunt.phase === 'hunt' ? 'Tap the real one before it fades' : 'One shadow is real. The rest are bait.'}</span>
            <strong>{shadowHunt.phase === 'watch' ? 'Watch' : shadowHunt.phase === 'hunt' ? 'Hunt' : 'Ready'}</strong>
          </div>
          <div className="expedition-event-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={startShadowHunt}
              disabled={locked || active}
            >
              Start Hunt
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled
            >
              {mutating ? 'Resolving...' : 'Tap Shadow'}
            </button>
          </div>
        </>
      ) : (
        <>
          {kind === 'focus_hold' ? (
            <>
              <div
                className={`expedition-focus-challenge${active ? ' charging' : ''}`}
                style={{ '--focus-charge': `${charge}%`, '--focus-target': `${focusTarget}%` }}
              >
                <div className="expedition-focus-target">
                  <span>Target</span>
                  <strong>{focusTarget}</strong>
                </div>
                <div className="expedition-focus-orb">
                  <b />
                  <span>{Math.round(charge)}</span>
                </div>
                <div className="expedition-focus-meter">
                  <i className="expedition-focus-sweet" />
                  <b style={{ width: `${charge}%` }} />
                </div>
                <small>Hold the rite. Release as close as possible to the target.</small>
              </div>
              <div className="expedition-event-actions">
                <button
                  type="button"
                  className="btn btn-secondary expedition-hold-button"
                  onPointerDown={startFocusHold}
                  onPointerUp={releaseFocusHold}
                  onPointerCancel={releaseFocusHold}
                  onPointerLeave={releaseFocusHold}
                  onClick={event => event.preventDefault()}
                  disabled={locked}
                >
                  {active ? 'Holding...' : 'Hold Focus'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={releaseFocusHold}
                  disabled={!canSubmit}
                >
                  {mutating ? 'Resolving...' : 'Release'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={`expedition-trap-challenge${active ? ' active' : ''}`}>
                <div className="expedition-trap-lane">
                  <span className="expedition-trap-safe-zone" />
                  <span className="expedition-trap-runner" />
                  <span className="expedition-trap-blade" style={{ left: `${marker}%` }}>
                    <i />
                    <b />
                  </span>
                </div>
                <div className="expedition-trap-labels">
                  <span>danger</span>
                  <strong>safe window</strong>
                  <span>danger</span>
                </div>
              </div>
              <div className="expedition-event-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={startChallenge}
                  disabled={locked || active}
                >
                  Start Trap
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => finish(score)}
                  disabled={!canSubmit}
                >
                  {mutating ? 'Resolving...' : 'Cut Through'}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function LegacyTimingEventMiniGame({ room, mutating, disabled, onComplete }) {
  const [active, setActive] = useState(false);
  const [marker, setMarker] = useState(12);
  const [direction, setDirection] = useState(1);

  useEffect(() => {
    if (!active) return undefined;
    const id = window.setInterval(() => {
      setMarker(value => {
        const next = value + direction * 7;
        if (next >= 96) {
          setDirection(-1);
          return 96;
        }
        if (next <= 4) {
          setDirection(1);
          return 4;
        }
        return next;
      });
    }, 70);
    return () => window.clearInterval(id);
  }, [active, direction]);

  const score = Math.max(0, Math.round(100 - Math.abs(marker - 50) * 2));
  const canSubmit = active && !disabled && !mutating;

  async function finish() {
    if (!canSubmit) return;
    setActive(false);
    await onComplete(room.key, score);
  }

  return (
    <div className="expedition-event-game">
      <div className="expedition-event-game-copy">
        <span>Room mini-game</span>
        <strong>{room?.miniGame?.label || 'Hit the glowing window'}</strong>
        <small>Start the marker, then stop inside the gold window. Great timing gives faster progress.</small>
      </div>
      <div className={`expedition-event-track${active ? ' active' : ''}`}>
        <i className="expedition-event-zone" />
        <b style={{ left: `${marker}%` }} />
      </div>
      <div className="expedition-event-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setMarker(12);
            setDirection(1);
            setActive(true);
          }}
          disabled={mutating || disabled || active}
        >
          Start
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={finish}
          disabled={!canSubmit}
        >
          {mutating ? 'Resolving...' : 'Stop'}
        </button>
      </div>
    </div>
  );
}

function RoomPanel({
  room,
  rooms,
  edges,
  member,
  roleMeta,
  roles,
  expedition,
  mutating,
  lastRoll,
  onAttempt,
  onAssist,
  onScoutChoice,
  onMinigameStart,
  onMinigameFinish,
  onRoleAbility,
  onRollFxComplete,
  currentMinigameAttempt,
}) {
  const [selectedSupport, setSelectedSupport] = useState(0);
  const [useSharedBuff, setUseSharedBuff] = useState(false);
  const selectedMechanicChoice = null;
  const roomArt = useLazyAsset(roomImages, roomArtFile(room));
  const bossArt = useLazyAsset(bossImages, bossArtFile(room));
  const enemyArt = useLazyAsset(enemyImages, enemyArtFile(room));
  const rollBonus = expedition?.sharedBuffs?.rollBonus;
  const canUseSharedBuff = Boolean(rollBonus && (rollBonus.uses ?? 0) > 0 && isActionableRoom(room));
  const canAssist = isActionableRoom(room) && (member?.ap || 0) > 0 && (room?.support || 0) < MAX_ROOM_SUPPORT;
  const primaryAction = useMemo(() => primaryActionForRoom(room, member, roles), [room, member, roles]);
  const weakRoleLabels = (room?.weakRoles || []).map(role => roles?.[role]?.name || titleize(role));
  const mechanic = roomRuleCopy(room);
  const combatRoom = isCombatRoom(room);
  const eventRoom = !combatRoom && !['boss', 'camp'].includes(room?.type);
  const roomTraitChips = [
    room?.complication ? { key: 'complication', label: `Complication: ${titleize(room.complication)}`, danger: true } : null,
    member?.debuff?.type ? { key: 'debuff', label: `You: ${titleize(member.debuff.type)}`, danger: true } : null,
    { key: 'support', label: `Support +${room?.support || 0}`, danger: false },
  ].filter(Boolean);
  const stageAction = lastRoll?.roomKey === room?.key ? lastRoll : null;
  const stageEvents = stageAction?.events || stageAction?.modifiers?.events || [];
  const stageCombatEvent = stageEvents.find(event => event.type === 'combat_roll');
  const stageDamageEvent = stageEvents.find(event => event.type === 'hero_damaged');
  const stageOutcome = stageCombatEvent?.outcome || null;
  const stageDamage = Number(stageCombatEvent?.progress || 0);
  const enemyName = bossArt
    ? 'The Root King'
    : room?.enemyId
      ? titleize(room.enemyId)
      : combatRoom
        ? 'Dungeon Enemy'
        : null;
  const encounterGuide = eventRoom
    ? {
        title: 'Room mini-game',
        body: 'Beat the room challenge to push forward. Better execution gives faster progress.',
      }
    : combatRoom
      ? {
          title: 'Combat roll',
          body: 'Roll d20: 1-4 lose 1 HP, 5-7 miss, 8-15 deal 1 damage, 16-19 deal 2, 20 deals 3. Monsters do not counterattack.',
        }
      : {
          title: mechanic.title,
          body: mechanic.body,
        };
  const sharedBuffAmount = useSharedBuff ? Number(rollBonus?.amount || 0) : 0;
  const roleActionBonus = roleMeta?.stat === primaryAction?.stat ? Number(roleMeta.bonus || 0) : 0;
  const totalRollModifier = Number(primaryAction?.modifier || 0)
    + roleActionBonus
    + Number(selectedSupport || 0)
    + sharedBuffAmount;
  const heroRecoverAt = Number(member?.heroRecoverAt || 0);
  const heroRecovering = heroRecoverAt > Math.floor(Date.now() / 1000) || Number(member?.heroHp ?? 3) <= 0;
  const heroRecoverLabel = heroRecoverAt > 0 ? `Recovering until ${formatTime(heroRecoverAt)}` : 'Hero is recovering';
  const assistReason = room?.state === 'cleared'
    ? 'Room cleared'
    : heroRecovering
      ? 'Hero recovering'
    : (member?.ap || 0) <= 0
      ? 'No AP'
      : (room?.support || 0) >= MAX_ROOM_SUPPORT
        ? 'Support capped'
        : 'Add family support';

  useEffect(() => {
    setSelectedSupport(0);
    setUseSharedBuff(false);
  }, [room?.key]);

  useEffect(() => {
    setSelectedSupport(value => Math.min(value, room?.support || 0));
  }, [room?.support]);

  if (!room) {
    return (
      <div className="expedition-card expedition-room-panel">
        <div className="expedition-empty">Select an open room to inspect the dungeon.</div>
      </div>
    );
  }

  const progressTarget = room.progressTarget || 1;
  const progressPercent = Math.min(100, Math.round(((room.progress || 0) / progressTarget) * 100));
  const foregroundArt = bossArt || (combatRoom ? enemyArt : null);
  const locked = room.state === 'locked';
  const hidden = room.state === 'hidden';
  const actionable = isActionableRoom(room);

  return (
    <div className={`expedition-card expedition-room-panel state-${room.state || 'unknown'}`}>
      <div className={`expedition-room-art${bossArt ? ' has-boss-art' : ''}${foregroundArt ? ' has-foreground-art' : ''}${stageOutcome ? ` outcome-${stageOutcome}` : ''}`}>
        {roomArt ? <img className="expedition-room-bg" src={roomArt} alt="" /> : <span />}
        {foregroundArt && (
          <img
            className={`expedition-room-foreground ${bossArt ? 'boss' : 'enemy'}`}
            src={foregroundArt}
            alt=""
          />
        )}
        {combatRoom && !foregroundArt && <div className="expedition-enemy-fallback" />}
        {enemyName && (
          <div className="expedition-enemy-hud">
            <span>{bossArt ? 'Boss' : 'Enemy'}</span>
            <strong>{enemyName}</strong>
            <i>
              <b style={{ width: `${Math.max(0, Math.min(100, 100 - progressPercent))}%` }} />
            </i>
          </div>
        )}
        {stageOutcome && (
          <div className={`expedition-stage-impact ${stageDamage > 0 ? 'damage' : stageOutcome}`}>
            <strong>{stageDamage > 0 ? `-${stageDamage}` : stageOutcome === 'wounded' ? 'Ouch' : stageOutcome === 'miss' ? 'Miss' : 'Guarded'}</strong>
            <span>{stageDamage > 0 ? 'enemy HP' : stageOutcome === 'wounded' ? 'hero hit' : 'no damage'}</span>
          </div>
        )}
        {stageDamageEvent && (
          <div className="expedition-hero-hurt">
            <strong>-1 HP</strong>
            <span>hero hurt</span>
          </div>
        )}
        <ExpeditionCombatFx
          visualEvents={stageEvents}
          memberHp={member?.heroHp}
          onSequenceComplete={onRollFxComplete}
        />
        {stageAction?.kind === 'minigame' && !stageAction.pending && (
          <div className={`expedition-minigame-stage-result ${stageAction.minigameSuccess ? 'success' : 'failed'}`}>
            <span>Room challenge</span>
            <strong>{stageAction.minigameSuccess ? 'Cleared' : 'Attempt spent'}</strong>
          </div>
        )}
        <div className="expedition-room-art-scrim" />
        <div className="expedition-room-title">
          <div className="expedition-kicker">{hidden ? 'Uncharted' : titleize(room.type || 'Room')}</div>
          <h3>{hidden ? 'Veiled Door' : room.name || titleize(room.type || 'Room')}</h3>
        </div>
      </div>

      <RoomEffectsBar effects={room.activeEffects || []} />

      {hidden || locked ? (
        <div className="expedition-room-locked">
          <strong>{hidden ? 'The passage is still under root-fog.' : 'This room is sealed.'}</strong>
          <span>{hidden ? 'Use a Scout reveal from a connected room.' : 'Clear connected rooms to unlock it.'}</span>
        </div>
      ) : (
        <>
          <div className="expedition-room-meter">
            <div>
              <span>Progress</span>
              <strong>{room.progress || 0}/{progressTarget}</strong>
            </div>
            <i><b style={{ width: `${progressPercent}%` }} /></i>
          </div>

          <div className="expedition-room-traits">
            {roomTraitChips.map(chip => (
              <span key={chip.key} className={chip.danger ? 'danger' : ''}>{chip.label}</span>
            ))}
          </div>

          <div className="expedition-encounter-director">
            <div className="expedition-encounter-row">
              <div>
                <span>Encounter</span>
                <strong>{titleize(room.encounterType || room.type || 'room')}</strong>
              </div>
              <div>
                <span>Best roles</span>
                <strong>{weakRoleLabels.length ? weakRoleLabels.join(' / ') : 'Any hero'}</strong>
              </div>
            </div>
            <div className="expedition-mechanic-card">
              <strong>{encounterGuide.title}</strong>
              <span>{encounterGuide.body}</span>
            </div>
          </div>

          <LastRollPanel action={lastRoll} />

          {heroRecovering && (
            <div className="expedition-room-locked expedition-hero-recovery">
              <strong>Hero knocked out.</strong>
              <span>{heroRecoverLabel}. Expedition actions unlock after recovery.</span>
            </div>
          )}

          {actionable ? (
            <>
              <ScoutChoicePanel
                room={room}
                member={member}
                roles={roles}
                mutating={mutating}
                onScoutChoice={onScoutChoice}
              />

              {eventRoom ? (
                <PersistedRoomMiniGame
                  room={room}
                  initialAttempt={currentMinigameAttempt?.roomKey === room.key ? currentMinigameAttempt.attempt : null}
                  mutating={mutating}
                  disabled={((member?.ap || 0) <= 0 && currentMinigameAttempt?.roomKey !== room.key) || heroRecovering}
                  onStart={onMinigameStart}
                  onFinish={onMinigameFinish}
                />
              ) : (
                <>
                  <SupportPicker support={room.support || 0} selected={selectedSupport} onChange={setSelectedSupport} />

                  <div className="expedition-power-grid">
                    <RoleAbilityControl
                      member={member}
                      room={room}
                      mutating={mutating}
                      onUse={onRoleAbility}
                    />
                    {rollBonus && (
                      <button
                        type="button"
                        className={`expedition-toggle-tile${useSharedBuff ? ' active' : ''}`}
                        onClick={() => canUseSharedBuff && setUseSharedBuff(value => !value)}
                        disabled={!canUseSharedBuff}
                      >
                        <strong>Shared +{rollBonus.amount || 0}</strong>
                        <span>{canUseSharedBuff ? `${rollBonus.uses || 0} use left` : 'No uses left'}</span>
                      </button>
                    )}
                  </div>

                  {primaryAction ? (
                    <div className={`expedition-one-roll-card${mutating ? ' is-rolling' : ''}`}>
                      <div className="expedition-one-roll-main">
                        <div>
                          <span>Current roll</span>
                          <strong>{actionLabel(primaryAction)}</strong>
                          <small>
                            {titleize(primaryAction.stat || 'stat')} check / {formatDifficulty(primaryAction.difficulty)} / 1 AP
                          </small>
                        </div>
                        <div className="expedition-roll-score">
                          <span>Roll power</span>
                          <strong>{signedNumber(totalRollModifier)}</strong>
                        </div>
                      </div>
                      <div className="expedition-roll-preview">
                        {(combatRoom ? combatRollPreview() : expectedProgressForAction(
                          primaryAction,
                          member,
                          roleMeta,
                          selectedSupport,
                          sharedBuffAmount,
                        )).map(item => (
                          <span key={item.roll}>
                            <b>{item.roll}</b>
                            {item.outcome.detail}
                          </span>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary expedition-roll-button"
                        onClick={() => onAttempt(room.key, null, {
                          selectedSupport,
                          mechanicChoice: selectedMechanicChoice,
                          useSharedBuff,
                        })}
                        disabled={mutating || (member?.ap || 0) <= 0 || heroRecovering}
                      >
                        {mutating ? 'Rolling d20...' : 'Roll d20'}
                      </button>
                    </div>
                  ) : (
                    <div className="expedition-room-locked">
                      <strong>No roll available.</strong>
                      <span>Choose another unlocked room.</span>
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <div className="expedition-room-locked">
              <strong>{room.state === 'cleared' ? 'Room cleared.' : 'No actions available.'}</strong>
              <span>{room.state === 'cleared' ? 'The family sigil is carved into the stone.' : 'Choose another unlocked room.'}</span>
            </div>
          )}

          <button
            type="button"
            className="expedition-assist-button"
            onClick={() => onAssist(room.key)}
            disabled={mutating || !canAssist || heroRecovering}
          >
            Assist +support <span>{assistReason}</span>
          </button>

        </>
      )}
    </div>
  );
}

function ExpeditionDashboard({
  state,
  archive,
  mutating,
  onAttempt,
  onAssist,
  onScoutChoice,
  onMinigameStart,
  onMinigameFinish,
  onUseArtifact,
  onRoleAbility,
  onFinish,
  finishMessage,
  onClose,
}) {
  const { artifacts, provisions } = useCatalogMaps(state.catalog?.artifacts);
  const memberNameById = useMemo(() => new Map(
    (state.familyMembers || []).map(member => [member.userId, member.firstName || member.username || 'Family']),
  ), [state.familyMembers]);
  const [selectedRoomKey, setSelectedRoomKey] = useState(null);
  const [lastRoll, setLastRoll] = useState(null);
  const [showMap, setShowMap] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [artifactUseId, setArtifactUseId] = useState(null);
  const rooms = state.map?.rooms || [];
  const edges = state.map?.edges || [];
  const roomCounts = rooms.reduce((counts, room) => {
    counts.total += 1;
    counts[room.state || 'unknown'] = (counts[room.state || 'unknown'] || 0) + 1;
    return counts;
  }, { total: 0 });
  const member = state.member;
  const roleMeta = state.catalog?.roles?.[member?.role] || {};
  const loadout = (member?.loadout || [])
    .map(artifactIdFromLoadoutSlot)
    .filter(Boolean);
  const provision = member?.provisionId ? provisions.get(member.provisionId) : null;
  const selectedRoom = rooms.find(room => room.key === selectedRoomKey) || null;
  const activeLoadout = (member?.loadout || [])
    .map((slot, slotIndex) => {
      const artifactId = artifactIdFromLoadoutSlot(slot);
      const meta = artifacts.get(artifactId);
      return artifactId && meta?.useType === 'active'
        ? { artifactId, slotIndex, meta }
        : null;
    })
    .filter(Boolean);
  const heroRecoverAt = Number(member?.heroRecoverAt || 0);
  const heroRecovering = heroRecoverAt > Math.floor(Date.now() / 1000) || Number(member?.heroHp ?? 3) <= 0;
  const currentMinigameAttempt = state.currentMinigameAttempt || null;

  useEffect(() => {
    if (currentMinigameAttempt?.roomKey && selectedRoomKey !== currentMinigameAttempt.roomKey) {
      setSelectedRoomKey(currentMinigameAttempt.roomKey);
      return;
    }
    if (lastRoll) return;
    const preferred = nextPreferredRoomKey(rooms, selectedRoomKey);
    if (preferred !== selectedRoomKey) setSelectedRoomKey(preferred);
  }, [rooms, selectedRoomKey, lastRoll, currentMinigameAttempt?.roomKey]);

  useEffect(() => {
    setLastRoll(null);
  }, [selectedRoomKey]);

  useEffect(() => {
    if (!lastRoll || lastRoll.pending) return undefined;
    const events = lastRoll.events || lastRoll.modifiers?.events || [];
    const hasSequencedFx = events.some(event => ['mage_advantage', 'shield_blocked'].includes(event?.type));
    const timer = window.setTimeout(() => setLastRoll(null), hasSequencedFx ? 4200 : 800);
    return () => window.clearTimeout(timer);
  }, [lastRoll]);

  async function handleAttempt(roomKey, actionId, options) {
    setLastRoll({ roomKey, pending: true });
    try {
      const next = await onAttempt(roomKey, actionId, options);
      const action = latestAction(next?.recentActions);
      if (action?.actionType === 'attempt') {
        setLastRoll({
          ...action,
          roomKey,
          events: next?.visualEvents || action.events || action.modifiers?.events || [],
        });
      } else {
        setLastRoll(null);
      }
    } catch (error) {
      setLastRoll(null);
      throw error;
    }
  }

  async function handleRoomMinigameFinish(roomKey, attempt, result) {
    setLastRoll({ roomKey, pending: true, kind: 'minigame' });
    try {
      const next = await onMinigameFinish(roomKey, attempt, result);
      setLastRoll({
        roomKey,
        kind: 'minigame',
        minigameSuccess: Boolean(next?.success),
        events: next?.visualEvents || [],
      });
      return next;
    } catch (error) {
      setLastRoll(null);
      throw error;
    }
  }

  async function handleUseArtifact(artifactId) {
    if (!selectedRoom?.key) return;
    const next = await onUseArtifact(selectedRoom.key, artifactId);
    if (next) setArtifactUseId(null);
  }

  const artifactUse = activeLoadout.find(item => item.artifactId === artifactUseId);
  const artifactUseDisabledReason = !selectedRoom
    ? 'Select an open room first.'
    : selectedRoom.state !== 'unlocked'
      ? 'Active artifacts can only be used in the current open room.'
      : mutating
        ? 'Another expedition action is still resolving.'
        : '';

  return (
    <div className="expedition-dashboard">
      <div className="expedition-game-topbar">
        <button type="button" className="expedition-nav-button" onClick={onClose}>Back</button>
        <div className="expedition-game-title">
          <span>Family Expedition</span>
          <strong>Crypt of the Root King</strong>
        </div>
        <div className="expedition-game-actions">
          <button type="button" className="expedition-nav-button" onClick={() => setShowMap(true)}>Map</button>
          <button type="button" className="expedition-nav-button" onClick={() => setShowArchive(true)}>Vault</button>
          <button type="button" className="expedition-nav-button" onClick={() => setShowGuide(true)}>Guide</button>
        </div>
      </div>

      <div className="expedition-card expedition-status-card">
        <div>
          <div className="expedition-kicker">Active Expedition</div>
          <h2>{titleize(state.expedition?.status || 'running')}</h2>
          {finishMessage && <p className="expedition-finish-hint">Expedition archived. History will show the final family record.</p>}
        </div>
        <div className="expedition-status-actions">
          <div className={`expedition-ap-chip${heroRecovering ? ' danger' : ''}`}>{heroRecovering ? 'Recovering' : `HP ${member?.heroHp ?? 3}/3`}</div>
          <div className="expedition-ap-chip">{member?.ap ?? 0} AP</div>
          {state.permissions?.canFinish && (
            <button
              type="button"
              className="btn btn-primary expedition-finish-button"
              onClick={onFinish}
              disabled={mutating}
            >
              {mutating ? 'Sealing...' : 'Finish Expedition'}
            </button>
          )}
        </div>
      </div>

      <div className="expedition-command-strip">
        <span><b>{titleize(member?.role || 'Hero')}</b> role</span>
        <span><b>{provision?.name || titleize(member?.provisionId || 'No provision')}</b></span>
        <span><b>{loadout.length}/3</b> relics</span>
        <span><b>{roomCounts.unlocked || 0}</b> open</span>
        <span><b>{roomCounts.cleared || 0}</b> cleared</span>
      </div>

      {activeLoadout.length > 0 && (
        <div className="expedition-active-relics" aria-label="Active artifacts">
          <span>Ready relics</span>
          {activeLoadout.map(({ artifactId, slotIndex, meta }) => (
            <button
              type="button"
              key={`${artifactId}-${slotIndex}`}
              onClick={() => setArtifactUseId(artifactId)}
            >
              {artifactImage(artifactId) && <img src={artifactImage(artifactId)} alt="" />}
              <strong>{meta.name || titleize(artifactId)}</strong>
            </button>
          ))}
        </div>
      )}

      <RoomPanel
        room={selectedRoom}
        rooms={rooms}
        edges={edges}
        member={member}
        roleMeta={roleMeta}
        roles={state.catalog?.roles || {}}
        expedition={state.expedition}
        mutating={mutating}
        lastRoll={lastRoll}
        onAttempt={handleAttempt}
        onAssist={onAssist}
        onScoutChoice={onScoutChoice}
        onMinigameStart={onMinigameStart}
        onMinigameFinish={handleRoomMinigameFinish}
        onRoleAbility={onRoleAbility}
        onRollFxComplete={() => setLastRoll(null)}
        currentMinigameAttempt={currentMinigameAttempt}
      />

      {showMap && (
        <ExpeditionOverlay title="Dungeon Map" kicker="Navigation" onClose={() => setShowMap(false)} wide>
          <DungeonMap
            rooms={rooms}
            edges={edges}
            selectedKey={selectedRoomKey}
            onSelect={key => {
              setSelectedRoomKey(key);
              setShowMap(false);
            }}
          />
        </ExpeditionOverlay>
      )}

      {showArchive && (
        <ExpeditionOverlay title="Vault & Ledger" kicker="Archive" onClose={() => setShowArchive(false)} wide>
          <section>
            <div className="expedition-section-title">Family Prep</div>
            <div className="expedition-member-list">
              {(state.familyMembers || []).map(memberRow => (
                <div key={memberRow.userId} className="expedition-member-row">
                  <span>{memberRow.firstName || memberRow.username || 'Family member'}</span>
                  <strong>{memberRow.prepared ? titleize(memberRow.role) : 'Not ready'}</strong>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="expedition-section-title">Recent Actions</div>
            <div className="expedition-action-list">
              {(state.recentActions || []).length > 0 ? state.recentActions.slice().reverse().map(action => (
                <div key={action.id} className="expedition-action-row">
                  <span>{describeAction(action, memberNameById)}</span>
                  <small>{formatTime(action.createdAt)}</small>
                </div>
              )) : (
                <div className="expedition-empty">No actions yet. The dungeon is quiet.</div>
              )}
            </div>
          </section>

          <ExpeditionArchivePanel
            archive={archive}
            currentInventory={state.artifactInventory}
            familyMembers={state.familyMembers}
          />
        </ExpeditionOverlay>
      )}

      {showGuide && (
        <ExpeditionOverlay title="How Expeditions Work" kicker="Guide" onClose={() => setShowGuide(false)}>
          <ExpeditionGuidePanel />
        </ExpeditionOverlay>
      )}

      {artifactUse && (
        <ArtifactDetailSheet
          artifact={{
            ...artifactUse.meta,
            image: artifactImage(artifactUse.artifactId),
            quantity: 1,
          }}
          mode="use"
          disabledReason={artifactUseDisabledReason}
          onConfirm={() => handleUseArtifact(artifactUse.artifactId)}
          onClose={() => setArtifactUseId(null)}
        />
      )}
    </div>
  );
}

function ExpeditionArchivePanel({ archive, currentInventory = [], familyMembers = [] }) {
  const { artifacts } = useCatalogMaps();
  const memberNameById = useMemo(() => new Map(
    (familyMembers || []).map(member => [member.userId, member.firstName || member.username || 'Family']),
  ), [familyMembers]);
  const inventory = (currentInventory?.length ? currentInventory : archive?.artifactInventory || [])
    .slice()
    .sort((a, b) => {
      const rarityOrder = { legendary: 0, epic: 1, rare: 2, common: 3 };
      const metaA = artifacts.get(a.artifactId);
      const metaB = artifacts.get(b.artifactId);
      return (rarityOrder[metaA?.rarity] ?? 9) - (rarityOrder[metaB?.rarity] ?? 9)
        || String(metaA?.name || a.artifactId).localeCompare(String(metaB?.name || b.artifactId));
    });
  const history = archive?.history || [];
  const ownedCount = inventory.length;
  const catalogCount = artifacts.size;

  return (
    <section className="expedition-archive-grid">
      <div className="expedition-card expedition-vault-card">
        <div className="expedition-panel-heading">
          <div>
            <div className="expedition-kicker">Relics Vault</div>
            <h3>{ownedCount}/{catalogCount} artifacts</h3>
          </div>
          <span className="expedition-ledger-stamp">Personal</span>
        </div>
        <div className="expedition-vault-grid">
          {inventory.length > 0 ? inventory.slice(0, 8).map(item => {
            const meta = artifacts.get(item.artifactId);
            const image = artifactImage(item.artifactId);
            return (
              <div key={item.artifactId} className={`expedition-vault-item rarity-${meta?.rarity || 'common'}`}>
                {image ? <img src={image} alt="" /> : <span />}
                <div>
                  <strong>{meta?.name || titleize(item.artifactId)}</strong>
                  <small>{titleize(meta?.rarity || 'common')} / {item.charges ? `${item.charges} charges` : `x${item.quantity || 1}`}</small>
                  <em>{meta?.effect || 'Dungeon artifact'}</em>
                </div>
              </div>
            );
          }) : (
            <div className="expedition-empty expedition-vault-empty">
              No relics yet. Critical rolls and boss rooms can bring the first one home.
            </div>
          )}
        </div>
      </div>

      <div className="expedition-card expedition-ledger-card">
        <div className="expedition-panel-heading">
          <div>
            <div className="expedition-kicker">Family Ledger</div>
            <h3>{history.length > 0 ? `${history.length} sealed runs` : 'No sealed runs'}</h3>
          </div>
          <span className="expedition-ledger-stamp">Archive</span>
        </div>
        <div className="expedition-ledger-list">
          {history.length > 0 ? history.slice(0, 4).map(entry => {
            const members = (entry.summary?.members || [])
              .slice()
              .sort((a, b) => (b.progress || 0) - (a.progress || 0));
            const topMember = members[0];
            return (
              <div key={entry.id} className="expedition-ledger-row">
                <div>
                  <strong>Expedition #{entry.expeditionId}</strong>
                  <small>{formatTime(entry.finishedAt)} / {entry.summary?.roomsCleared || 0} rooms cleared</small>
                </div>
                <span>
                  {topMember ? `${memberNameById.get(topMember.userId) || 'Hero'} +${topMember.progress || 0}` : 'No progress'}
                </span>
              </div>
            );
          }) : (
            <div className="expedition-empty">
              The first victory will carve your family name into the Root King's ledger.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default function FamilyExpeditionTab({ onExpeditionChange, onClose } = {}) {
  const [state, setState] = useState(null);
  const [archive, setArchive] = useState({ history: [], artifactInventory: [] });
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState('');
  const [finishMessage, setFinishMessage] = useState(false);
  const [rewardSheet, setRewardSheet] = useState(null);
  const [rewardClaiming, setRewardClaiming] = useState(false);
  const [rewardClaimed, setRewardClaimed] = useState(false);
  const [rewardError, setRewardError] = useState('');
  const [personalFxReplay, setPersonalFxReplay] = useState(0);
  const startIdempotencyKeyRef = useRef(null);
  const prepareIdempotencyKeyRef = useRef(null);
  const finishIdempotencyKeyRef = useRef(null);
  const attemptIdempotencyKeysRef = useRef(new Map());
  const assistIdempotencyKeysRef = useRef(new Map());
  const scoutChoiceIdempotencyKeysRef = useRef(new Map());
  const minigameStartIdempotencyKeysRef = useRef(new Map());
  const minigameFinishIdempotencyKeysRef = useRef(new Map());
  const artifactUseIdempotencyKeysRef = useRef(new Map());
  const roleAbilityIdempotencyKeysRef = useRef(new Map());
  const eventAckIdempotencyKeysRef = useRef(new Map());
  const pendingRewards = state?.pendingRewards || [];
  const pendingRewardCount = Number(state?.pendingRewardCount ?? pendingRewards.length);
  const personalEvent = state?.personalEvents?.[0] || null;
  const rewardArtifactCatalog = useMemo(() => new Map(
    (state?.catalog?.artifacts || []).map(artifact => [artifact.id, artifact]),
  ), [state?.catalog?.artifacts]);
  const resolveRewardArtifact = useCallback((artifactId) => ({
    ...(rewardArtifactCatalog.get(artifactId) || {}),
    image: artifactImage(artifactId),
  }), [rewardArtifactCatalog]);

  const getPendingMutationKey = useCallback((ref, signature, prefix) => {
    if (!ref.current.has(signature)) {
      ref.current.set(signature, makeIdempotencyKey(prefix));
    }
    return ref.current.get(signature);
  }, []);

  const clearPendingMutationKey = useCallback((ref, signature) => {
    ref.current.delete(signature);
  }, []);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      setState(await api.getExpeditionCurrent());
      return true;
    } catch (err) {
      setError(err.message || 'Could not load expedition');
      return false;
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const loadArchive = useCallback(async () => {
    try {
      const [historyResult, artifactsResult] = await Promise.all([
        api.expeditionHistory(),
        api.expeditionArtifacts(),
      ]);
      setArchive({
        history: historyResult?.history || [],
        artifactInventory: artifactsResult?.artifactInventory || [],
      });
    } catch (err) {
      if (err.status === 403 || err.status === 404) {
        setArchive({ history: [], artifactInventory: [] });
      } else {
        console.warn('[expeditions] archive load failed:', err.message || err);
      }
    }
  }, []);

  useEffect(() => {
    load();
    loadArchive();
  }, [load, loadArchive]);

  useEffect(() => {
    function refreshIfVisible() {
      if (document.visibilityState !== 'visible' || mutating) return;
      load({ silent: true });
    }

    const id = window.setInterval(refreshIfVisible, 10000);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [load, mutating]);

  async function handleStart() {
    setMutating(true);
    setError('');
    startIdempotencyKeyRef.current ||= makeIdempotencyKey('expedition-start');
    try {
      setState(await api.startExpedition(startIdempotencyKeyRef.current));
      if (await load()) {
        startIdempotencyKeyRef.current = null;
        setFinishMessage(false);
        onExpeditionChange?.();
      }
    } catch (err) {
      if (err.status === 409) {
        if (await load()) {
          startIdempotencyKeyRef.current = null;
          onExpeditionChange?.();
        }
        return;
      }
      setError(err.message || 'Could not start expedition');
    } finally {
      setMutating(false);
    }
  }

  async function handlePrepare(payload) {
    if (!state?.expedition?.id) return;
    setMutating(true);
    setError('');
    prepareIdempotencyKeyRef.current ||= makeIdempotencyKey('expedition-prepare');
    try {
      setState(await api.prepareExpedition(state.expedition.id, {
        ...payload,
        idempotencyKey: prepareIdempotencyKeyRef.current,
      }));
      if (await load()) {
        prepareIdempotencyKeyRef.current = null;
        onExpeditionChange?.();
      }
    } catch (err) {
      if (err.status === 409) {
        if (await load()) {
          prepareIdempotencyKeyRef.current = null;
          onExpeditionChange?.();
        }
        return;
      }
      setError(err.message || 'Could not prepare expedition');
    } finally {
      setMutating(false);
    }
  }

  async function mutateExpedition(operation, fallbackMessage) {
    if (!state?.expedition?.id) return null;
    setMutating(true);
    setError('');
    try {
      const next = await operation(state.expedition.id);
      setState(next);
      const fresh = await api.getExpeditionCurrent();
      setState(fresh);
      onExpeditionChange?.();
      return next;
    } catch (err) {
      if (err.status === 409) {
        await load({ silent: true });
        onExpeditionChange?.();
        return null;
      }
      setError(err.message || fallbackMessage);
      return null;
    } finally {
      setMutating(false);
    }
  }

  async function handleAttemptRoom(roomKey, actionId, options = {}) {
    const payload = {
      actionId,
      mechanicChoice: options.mechanicChoice || null,
      selectedSupport: options.selectedSupport || 0,
      useSharedBuff: Boolean(options.useSharedBuff),
    };
    const signature = JSON.stringify({ expeditionId: state?.expedition?.id || null, roomKey, ...payload });
    const next = await mutateExpedition(expeditionId => api.attemptExpeditionRoom(expeditionId, roomKey, {
      ...payload,
      idempotencyKey: getPendingMutationKey(attemptIdempotencyKeysRef, signature, 'expedition-attempt'),
    }), 'Could not attempt room');
    if (next) clearPendingMutationKey(attemptIdempotencyKeysRef, signature);
    return next;
  }

  async function handleAssistRoom(roomKey) {
    const signature = JSON.stringify({ expeditionId: state?.expedition?.id || null, roomKey });
    const next = await mutateExpedition(expeditionId => api.assistExpeditionRoom(
      expeditionId,
      roomKey,
      getPendingMutationKey(assistIdempotencyKeysRef, signature, 'expedition-assist'),
    ), 'Could not assist room');
    if (next) clearPendingMutationKey(assistIdempotencyKeysRef, signature);
    return next;
  }

  async function handleScoutChoice(roomKey, choiceId) {
    const signature = JSON.stringify({ expeditionId: state?.expedition?.id || null, roomKey, choiceId });
    const next = await mutateExpedition(expeditionId => api.chooseExpeditionScoutRoom(expeditionId, roomKey, {
      choiceId,
      idempotencyKey: getPendingMutationKey(scoutChoiceIdempotencyKeysRef, signature, 'expedition-scout-choice'),
    }), 'Could not choose next room');
    if (next) clearPendingMutationKey(scoutChoiceIdempotencyKeysRef, signature);
    return next;
  }

  async function handleMinigameStart(roomKey) {
    if (!state?.expedition?.id) return null;
    const signature = JSON.stringify({ expeditionId: state.expedition.id, roomKey });
    setMutating(true);
    setError('');
    try {
      const next = await api.startExpeditionMinigame(
        state.expedition.id,
        roomKey,
        getPendingMutationKey(minigameStartIdempotencyKeysRef, signature, 'expedition-minigame-start'),
      );
      setState(next);
      onExpeditionChange?.();
      return next;
    } catch (err) {
      setError(err.message || 'Could not start room mini-game');
      return null;
    } finally {
      setMutating(false);
    }
  }

  async function handleMinigameFinish(roomKey, attempt, result) {
    if (!state?.expedition?.id || !attempt?.attemptToken) return null;
    const signature = JSON.stringify({
      expeditionId: state.expedition.id,
      roomKey,
      attemptToken: attempt.attemptToken,
      startedAt: attempt.startedAt,
      result,
    });
    setMutating(true);
    setError('');
    try {
      const next = await api.finishExpeditionMinigame(
        state.expedition.id,
        roomKey,
        attempt.attemptToken,
        {
          result,
          idempotencyKey: getPendingMutationKey(minigameFinishIdempotencyKeysRef, signature, 'expedition-minigame-finish'),
        },
      );
      setState(next);
      clearPendingMutationKey(minigameFinishIdempotencyKeysRef, signature);
      if (!next?.attempt?.retry) {
        clearPendingMutationKey(
          minigameStartIdempotencyKeysRef,
          JSON.stringify({ expeditionId: state.expedition.id, roomKey }),
        );
      }
      onExpeditionChange?.();
      return next;
    } catch (err) {
      setError(err.message || 'Could not finish room mini-game');
      throw err;
    } finally {
      setMutating(false);
    }
  }

  async function handleUseArtifact(roomKey, artifactId) {
    const signature = JSON.stringify({ expeditionId: state?.expedition?.id || null, roomKey, artifactId });
    const next = await mutateExpedition(expeditionId => api.useExpeditionArtifact(
      expeditionId,
      roomKey,
      artifactId,
      getPendingMutationKey(artifactUseIdempotencyKeysRef, signature, 'expedition-artifact'),
    ), 'Could not use artifact');
    if (next) clearPendingMutationKey(artifactUseIdempotencyKeysRef, signature);
    return next;
  }

  async function handleRoleAbility(roomKey) {
    const signature = JSON.stringify({ expeditionId: state?.expedition?.id || null, roomKey, role: state?.member?.role });
    const next = await mutateExpedition(expeditionId => api.useExpeditionRoleAbility(
      expeditionId,
      roomKey,
      getPendingMutationKey(roleAbilityIdempotencyKeysRef, signature, 'expedition-role'),
    ), 'Could not use role ability');
    if (next) clearPendingMutationKey(roleAbilityIdempotencyKeysRef, signature);
    return next;
  }

  async function handlePersonalFxComplete({ source, eventId }) {
    if (source !== 'personal' || !eventId) return;
    const signature = String(eventId);
    const idempotencyKey = getPendingMutationKey(
      eventAckIdempotencyKeysRef,
      signature,
      'expedition-event-ack',
    );
    try {
      const result = await api.acknowledgeExpeditionEvents([eventId], idempotencyKey);
      setState(previous => previous ? {
        ...previous,
        personalEvents: result.personalEvents || [],
      } : previous);
      clearPendingMutationKey(eventAckIdempotencyKeysRef, signature);
    } catch (err) {
      setError(err.message || 'Could not acknowledge expedition event');
      window.setTimeout(() => setPersonalFxReplay(value => value + 1), 2500);
    }
  }

  function handleOpenPendingRewards() {
    if (!pendingRewards.length) return;
    setRewardError('');
    setRewardClaimed(false);
    setRewardSheet(pendingRewards[0]);
  }

  async function handleClaimPendingReward(reward) {
    if (!reward?.id || rewardClaiming) return;
    setRewardClaiming(true);
    setRewardError('');
    try {
      const result = await api.claimExpeditionReward(reward.id);
      setState(previous => previous ? {
        ...previous,
        pendingRewards: result.pendingRewards || [],
        pendingRewardCount: Number(result.pendingRewardCount || 0),
      } : previous);
      setRewardSheet(result.reward || reward);
      setRewardClaimed(true);
      loadArchive();
      onExpeditionChange?.();
    } catch (err) {
      setRewardError(err.message || 'Could not claim expedition reward');
    } finally {
      setRewardClaiming(false);
    }
  }

  function handleCloseRewardSheet() {
    if (rewardClaiming) return;
    setRewardSheet(null);
    setRewardClaimed(false);
    setRewardError('');
  }

  async function handleFinishExpedition() {
    finishIdempotencyKeyRef.current ||= makeIdempotencyKey('expedition-finish');
    const next = await mutateExpedition(expeditionId => api.finishExpedition(
      expeditionId,
      finishIdempotencyKeyRef.current,
    ), 'Could not finish expedition');
    if (next) {
      finishIdempotencyKeyRef.current = null;
      setFinishMessage(true);
      loadArchive();
    }
  }

  if (loading && !state) {
    return <div className="expedition-shell"><div className="expedition-loading">Loading expedition...</div></div>;
  }

  const permissions = state?.permissions || {};
  const hasExpedition = Boolean(state?.expedition);
  const canPrepare = hasExpedition && !state?.member && permissions.canPrepare;
  const isPrepared = hasExpedition && Boolean(state?.member);

  return (
    <div className="expedition-shell">
      {!isPrepared && (
        <div className="expedition-entry-topbar">
          <button type="button" className="expedition-nav-button" onClick={onClose}>Back</button>
          <strong>Expeditions</strong>
        </div>
      )}

      {error && <div className="expedition-error">{error}</div>}

      {pendingRewardCount > 0 && (
        <button
          type="button"
          className="expedition-pending-rewards"
          onClick={handleOpenPendingRewards}
        >
          <span>Expedition rewards</span>
          <strong>Claim Rewards / {pendingRewardCount}</strong>
        </button>
      )}

      {!hasExpedition && finishMessage && (
        <>
          <div className="expedition-card expedition-finished-card">
            <div className="expedition-kicker">Expedition Complete</div>
            <h2>The dungeon is sealed.</h2>
            <p className="expedition-muted">
              Final rewards and family records are archived in expedition history. Refresh or begin the next run when your family is ready.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-full expedition-cta"
              onClick={handleStart}
              disabled={mutating || !permissions?.canStart}
            >
              {mutating ? 'Opening gate...' : permissions?.canStart ? 'Start Next Expedition' : 'Waiting for permission'}
            </button>
          </div>
          <ExpeditionArchivePanel
            archive={archive}
            currentInventory={state?.artifactInventory}
            familyMembers={state?.familyMembers}
          />
        </>
      )}

      {!hasExpedition && !finishMessage && (
        <>
          <ExpeditionIntro loading={mutating} onStart={handleStart} permissions={permissions} />
          <ExpeditionArchivePanel
            archive={archive}
            currentInventory={state?.artifactInventory}
            familyMembers={state?.familyMembers}
          />
        </>
      )}

      {canPrepare && (
        <PreparationFlow state={state} loading={mutating} onPrepare={handlePrepare} />
      )}

      {hasExpedition && !canPrepare && !isPrepared && (
        <div className="expedition-card">
          <div className="expedition-kicker">Expedition Active</div>
          <h2>Preparation is closed</h2>
          <p className="expedition-muted">You are not prepared for this run, but you can still follow family progress here.</p>
          <ExpeditionDashboard
            state={state}
            archive={archive}
            mutating={mutating}
            onAttempt={handleAttemptRoom}
            onAssist={handleAssistRoom}
            onScoutChoice={handleScoutChoice}
            onMinigameStart={handleMinigameStart}
            onMinigameFinish={handleMinigameFinish}
            onUseArtifact={handleUseArtifact}
            onRoleAbility={handleRoleAbility}
            onFinish={handleFinishExpedition}
            finishMessage={finishMessage}
            onClose={onClose}
          />
        </div>
      )}

      {isPrepared && (
        <ExpeditionDashboard
          state={state}
          archive={archive}
          mutating={mutating}
          onAttempt={handleAttemptRoom}
          onAssist={handleAssistRoom}
          onScoutChoice={handleScoutChoice}
          onMinigameStart={handleMinigameStart}
          onMinigameFinish={handleMinigameFinish}
          onUseArtifact={handleUseArtifact}
          onRoleAbility={handleRoleAbility}
          onFinish={handleFinishExpedition}
          finishMessage={finishMessage}
          onClose={onClose}
        />
      )}

      {rewardSheet && (
        <RewardClaimSheet
          reward={rewardSheet}
          resolveArtifact={resolveRewardArtifact}
          claiming={rewardClaiming}
          claimed={rewardClaimed}
          error={rewardError}
          onClaim={handleClaimPendingReward}
          onClose={handleCloseRewardSheet}
        />
      )}

      {personalEvent && (
        <ExpeditionCombatFx
          key={`${personalEvent.id}:${personalFxReplay}`}
          personalEvent={personalEvent}
          memberHp={state?.member?.heroHp}
          onComplete={handlePersonalFxComplete}
        />
      )}
    </div>
  );
}
