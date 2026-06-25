import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api';
import assetCatalog from '../assets/expeditions/root-king/asset-catalog.json';
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

function isVisibleRoom(room) {
  return room && room.state !== 'hidden';
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
  const visibleRooms = rooms.slice().sort((a, b) => (a.depth || 0) - (b.depth || 0) || String(a.key).localeCompare(String(b.key)));
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
    const lanes = row.length === 1 ? [0] : row.length === 2 ? [-0.9, 0.9] : [-1.15, 0, 1.15, -1.75, 1.75];
    row.forEach((room, index) => {
      const lane = lanes[index % lanes.length] + (room.optional ? (index % 2 === 0 ? -0.18 : 0.18) : 0);
      positions.set(room.key, {
        x: Math.max(14, Math.min(86, 50 + lane * 26)),
        y: 34 + rowIndex * 92,
        rowIndex,
      });
    });
  });

  const height = Math.max(174, 80 + Math.max(0, depths.length - 1) * 92);
  const paths = edges
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

function hiddenNeighbors(room, rooms = [], edges = []) {
  if (!room) return [];
  const roomByKey = new Map(rooms.map(candidate => [candidate.key, candidate]));
  return edges
    .filter(edge => edge.from === room.key)
    .map(edge => roomByKey.get(edge.to))
    .filter(candidate => candidate?.state === 'hidden');
}

function useCatalogMaps() {
  return useMemo(() => {
    const artifacts = new Map((assetCatalog.artifacts || []).map(item => [item.id, item]));
    const provisions = new Map((assetCatalog.provisions || []).map(item => [item.id, item]));
    return { artifacts, provisions };
  }, []);
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
  const { artifacts, provisions: provisionNames } = useCatalogMaps();
  const roleEntries = normalizeEntries(state.catalog?.roles);
  const provisionEntries = normalizeEntries(state.catalog?.provisions);
  const [role, setRole] = useState(() => roleEntries[0]?.[0] || 'knight');
  const [provisionId, setProvisionId] = useState(() => provisionEntries[0]?.[0] || null);
  const [artifactIds, setArtifactIds] = useState([]);

  useEffect(() => {
    if (!roleEntries.some(([id]) => id === role)) setRole(roleEntries[0]?.[0] || 'knight');
    if (provisionId && !provisionEntries.some(([id]) => id === provisionId)) setProvisionId(provisionEntries[0]?.[0] || null);
  }, [provisionEntries, provisionId, role, roleEntries]);

  function toggleArtifact(id) {
    setArtifactIds(prev => {
      if (prev.includes(id)) return prev.filter(item => item !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
  }

  const inventory = state.artifactInventory || [];

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
            return (
              <button
                type="button"
                key={id}
                className={`expedition-choice expedition-provision-card${provisionId === id ? ' selected' : ''}`}
                onClick={() => setProvisionId(id)}
              >
                {image && <img src={image} alt="" />}
                <strong>{meta?.name || named?.name || titleize(id)}</strong>
                <small>{titleize(meta?.effect?.type || 'provision')}</small>
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
              <div key={index} className={`expedition-loadout-slot${id ? ' filled' : ''}`}>
                {id ? item?.name || titleize(id) : `Slot ${index + 1}`}
              </div>
            );
          })}
        </div>
        {inventory.length > 0 ? (
          <div className="expedition-artifact-grid">
            {inventory.map(item => {
              const id = item.artifactId;
              const meta = artifacts.get(id);
              const selected = artifactIds.includes(id);
              const image = assetById(artifactImages, id);
              return (
                <button
                  type="button"
                  key={id}
                  className={`expedition-choice expedition-artifact-card rarity-${meta?.rarity || 'common'}${selected ? ' selected' : ''}`}
                  onClick={() => toggleArtifact(id)}
                >
                  {image && <img src={image} alt="" />}
                  <strong>{meta?.name || titleize(id)}</strong>
                  <small>{meta?.effect || `Owned x${item.quantity || 1}`}</small>
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
    </div>
  );
}

function DungeonMap({ rooms, edges, selectedKey, onSelect }) {
  const { positions, paths, height } = useMemo(() => buildRoomLayout(rooms, edges), [rooms, edges]);
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
        <span>{rooms.length} rooms</span>
      </div>

      <div className="expedition-map-scroll">
        <div className="expedition-map-stage" style={{ height }}>
          <svg className="expedition-map-edges" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true">
            {paths.map(path => <path key={path.key} d={path.d} />)}
          </svg>
          {rooms.map(room => {
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
        <span><i className="legend-hidden" /> Hidden</span>
      </div>
    </div>
  );
}

function LastRollPanel({ action }) {
  if (!action || action.actionType !== 'attempt') return null;
  const loot = action.loot || {};
  const modifierParts = action.modifiers?.parts || [];

  return (
    <div className="expedition-last-roll">
      <div className="expedition-last-roll-die">
        <span>d20</span>
        <strong>{action.rawRoll ?? '?'}</strong>
      </div>
      <div className="expedition-last-roll-copy">
        <div>
          <strong>Last Roll</strong>
          <span>Modified {action.modifiedRoll ?? '?'} / +{action.progressAwarded || 0} progress</span>
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

function RoleAbilityControl({ member, room, enabled, onToggle }) {
  if (!member?.role || member.roleAbilityUsed || member.role === 'scout' || !isActionableRoom(room)) return null;
  const copy = {
    mage: ['Mage Reroll', 'Keep the higher d20.'],
    knight: ['Knight Shield', 'A miss still carves +1 progress.'],
    cleric: ['Cleric Blessing', 'Create a shared +3 roll boon.'],
  }[member.role];
  if (!copy) return null;

  return (
    <button
      type="button"
      className={`expedition-toggle-tile${enabled ? ' active' : ''}`}
      onClick={() => onToggle(!enabled)}
    >
      <strong>{copy[0]}</strong>
      <span>{copy[1]}</span>
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

function RoomPanel({
  room,
  rooms,
  edges,
  member,
  expedition,
  mutating,
  lastRoll,
  onAttempt,
  onAssist,
  onReveal,
}) {
  const [selectedSupport, setSelectedSupport] = useState(0);
  const [useRoleAbility, setUseRoleAbility] = useState(false);
  const [useSharedBuff, setUseSharedBuff] = useState(false);
  const roomArt = useLazyAsset(roomImages, roomArtFile(room));
  const bossArt = useLazyAsset(bossImages, bossArtFile(room));
  const revealable = useMemo(() => hiddenNeighbors(room, rooms, edges), [room, rooms, edges]);
  const rollBonus = expedition?.sharedBuffs?.rollBonus;
  const canUseSharedBuff = Boolean(rollBonus && (rollBonus.uses ?? 0) > 0 && isActionableRoom(room));
  const canAssist = isActionableRoom(room) && (member?.ap || 0) > 0 && (room?.support || 0) < MAX_ROOM_SUPPORT;
  const assistReason = room?.state === 'cleared'
    ? 'Room cleared'
    : (member?.ap || 0) <= 0
      ? 'No AP'
      : (room?.support || 0) >= MAX_ROOM_SUPPORT
        ? 'Support capped'
        : 'Add family support';

  useEffect(() => {
    setSelectedSupport(0);
    setUseRoleAbility(false);
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
  const art = bossArt || roomArt;
  const locked = room.state === 'locked';
  const hidden = room.state === 'hidden';
  const actionable = isActionableRoom(room);

  return (
    <div className={`expedition-card expedition-room-panel state-${room.state || 'unknown'}`}>
      <div className="expedition-room-art">
        {art ? <img src={art} alt="" /> : <span />}
        <div className="expedition-room-art-scrim" />
        <div className="expedition-room-title">
          <div className="expedition-kicker">{hidden ? 'Uncharted' : titleize(room.type || 'Room')}</div>
          <h3>{hidden ? 'Veiled Door' : room.name || titleize(room.type || 'Room')}</h3>
        </div>
      </div>

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
            {(room.tags || []).slice(0, 5).map(tag => <span key={tag}>{titleize(tag)}</span>)}
            {room.complication && <span className="danger">Complication: {titleize(room.complication)}</span>}
            {member?.debuff?.type && <span className="danger">You: {titleize(member.debuff.type)}</span>}
            <span>Support +{room.support || 0}</span>
          </div>

          <LastRollPanel action={lastRoll} />

          {actionable ? (
            <>
              <SupportPicker support={room.support || 0} selected={selectedSupport} onChange={setSelectedSupport} />

              <div className="expedition-power-grid">
                <RoleAbilityControl
                  member={member}
                  room={room}
                  enabled={useRoleAbility}
                  onToggle={setUseRoleAbility}
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

              <div className="expedition-action-tiles">
                {(room.actions || []).map(action => (
                  <div key={action.id || action.label || action.stat} className="expedition-action-tile">
                    <div>
                      <strong>{actionLabel(action)}</strong>
                      <span>{titleize(action.stat || 'stat')} / {formatDifficulty(action.difficulty)}</span>
                    </div>
                    <small>{signedNumber(action.modifier || 0)} mod / 1 AP</small>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => onAttempt(room.key, action.id, {
                        selectedSupport,
                        useRoleAbility,
                        useSharedBuff,
                      })}
                      disabled={mutating || (member?.ap || 0) <= 0}
                    >
                      {mutating ? 'Rolling...' : 'Roll d20'}
                    </button>
                  </div>
                ))}
              </div>
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
            disabled={mutating || !canAssist}
          >
            Assist +support <span>{assistReason}</span>
          </button>

          {member?.role === 'scout' && !member.roleAbilityUsed && ['unlocked', 'cleared'].includes(room.state) && revealable.length > 0 && (
            <div className="expedition-scout-reveal">
              <div className="expedition-section-title">Scout Reveal</div>
              {revealable.map(target => (
                <button
                  type="button"
                  key={target.key}
                  onClick={() => onReveal(target.key, room.key)}
                  disabled={mutating}
                >
                  Reveal hidden passage at depth {target.depth ?? '?'}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ExpeditionDashboard({
  state,
  mutating,
  onAttempt,
  onAssist,
  onReveal,
  onFinish,
  finishMessage,
}) {
  const { artifacts, provisions } = useCatalogMaps();
  const memberNameById = useMemo(() => new Map(
    (state.familyMembers || []).map(member => [member.userId, member.firstName || member.username || 'Family']),
  ), [state.familyMembers]);
  const [selectedRoomKey, setSelectedRoomKey] = useState(null);
  const [lastRoll, setLastRoll] = useState(null);
  const rooms = state.map?.rooms || [];
  const edges = state.map?.edges || [];
  const roomCounts = rooms.reduce((counts, room) => {
    counts.total += 1;
    counts[room.state || 'unknown'] = (counts[room.state || 'unknown'] || 0) + 1;
    return counts;
  }, { total: 0 });
  const member = state.member;
  const loadout = (member?.loadout || [])
    .map(artifactIdFromLoadoutSlot)
    .filter(Boolean);
  const provision = member?.provisionId ? provisions.get(member.provisionId) : null;
  const selectedRoom = rooms.find(room => room.key === selectedRoomKey) || null;

  useEffect(() => {
    if (selectedRoomKey && rooms.some(room => room.key === selectedRoomKey && isVisibleRoom(room))) return;
    const preferred = rooms.find(room => room.state === 'unlocked')
      || rooms.find(room => room.state === 'cleared')
      || rooms.find(room => isVisibleRoom(room));
    setSelectedRoomKey(preferred?.key || null);
  }, [rooms, selectedRoomKey]);

  async function handleAttempt(roomKey, actionId, options) {
    const next = await onAttempt(roomKey, actionId, options);
    const action = latestAction(next?.recentActions);
    if (action?.actionType === 'attempt') setLastRoll(action);
  }

  return (
    <div className="expedition-dashboard">
      <div className="expedition-card expedition-status-card">
        <div>
          <div className="expedition-kicker">Active Expedition</div>
          <h2>{titleize(state.expedition?.status || 'running')}</h2>
          {finishMessage && <p className="expedition-finish-hint">Expedition archived. History will show the final family record.</p>}
        </div>
        <div className="expedition-status-actions">
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

      <div className="expedition-card expedition-loadout-card">
        <div className="expedition-dashboard-row">
          <span>Role</span>
          <strong>{titleize(member?.role || 'Unassigned')}</strong>
        </div>
        <div className="expedition-dashboard-row">
          <span>Provision</span>
          <strong>{provision?.name || titleize(member?.provisionId || 'None')}</strong>
        </div>
        <div className="expedition-mini-loadout">
          {loadout.length > 0 ? loadout.map((id, index) => {
            const meta = artifacts.get(id);
            return <span key={`${id}-${index}`}>{meta?.name || titleize(id)}</span>;
          }) : <span>No artifacts equipped</span>}
        </div>
      </div>

      <DungeonMap
        rooms={rooms}
        edges={edges}
        selectedKey={selectedRoomKey}
        onSelect={setSelectedRoomKey}
      />

      <div className="expedition-map-counts">
        <span>{roomCounts.unlocked || 0} open</span>
        <span>{roomCounts.cleared || 0} cleared</span>
        <span>{roomCounts.hidden || 0} hidden</span>
      </div>

      <RoomPanel
        room={selectedRoom}
        rooms={rooms}
        edges={edges}
        member={member}
        expedition={state.expedition}
        mutating={mutating}
        lastRoll={lastRoll}
        onAttempt={handleAttempt}
        onAssist={onAssist}
        onReveal={onReveal}
      />

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
    </div>
  );
}

export default function FamilyExpeditionTab() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState('');
  const [finishMessage, setFinishMessage] = useState(false);
  const startIdempotencyKeyRef = useRef(null);
  const prepareIdempotencyKeyRef = useRef(null);
  const finishIdempotencyKeyRef = useRef(null);

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

  useEffect(() => { load(); }, [load]);

  async function handleStart() {
    setMutating(true);
    setError('');
    startIdempotencyKeyRef.current ||= makeIdempotencyKey('expedition-start');
    try {
      setState(await api.startExpedition(startIdempotencyKeyRef.current));
      if (await load()) {
        startIdempotencyKeyRef.current = null;
        setFinishMessage(false);
      }
    } catch (err) {
      if (err.status === 409) {
        if (await load()) startIdempotencyKeyRef.current = null;
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
      if (await load()) prepareIdempotencyKeyRef.current = null;
    } catch (err) {
      if (err.status === 409) {
        if (await load()) prepareIdempotencyKeyRef.current = null;
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
      return next;
    } catch (err) {
      if (err.status === 409) {
        await load({ silent: true });
        return null;
      }
      setError(err.message || fallbackMessage);
      return null;
    } finally {
      setMutating(false);
    }
  }

  async function handleAttemptRoom(roomKey, actionId, options = {}) {
    return mutateExpedition(expeditionId => api.attemptExpeditionRoom(expeditionId, roomKey, {
      actionId,
      selectedSupport: options.selectedSupport || 0,
      useRoleAbility: Boolean(options.useRoleAbility),
      useSharedBuff: Boolean(options.useSharedBuff),
      idempotencyKey: makeIdempotencyKey('expedition-attempt'),
    }), 'Could not attempt room');
  }

  async function handleAssistRoom(roomKey) {
    return mutateExpedition(expeditionId => api.assistExpeditionRoom(
      expeditionId,
      roomKey,
      makeIdempotencyKey('expedition-assist'),
    ), 'Could not assist room');
  }

  async function handleRevealRoom(targetKey, fromRoomKey) {
    return mutateExpedition(expeditionId => api.revealExpeditionRoom(expeditionId, targetKey, {
      fromRoomKey,
      idempotencyKey: makeIdempotencyKey('expedition-reveal'),
    }), 'Could not reveal room');
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
      <div className="expedition-topbar">
        <button type="button" className="btn btn-secondary" onClick={load} disabled={loading || mutating}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error && <div className="expedition-error">{error}</div>}

      {!hasExpedition && finishMessage && (
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
      )}

      {!hasExpedition && !finishMessage && (
        <ExpeditionIntro loading={mutating} onStart={handleStart} permissions={permissions} />
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
            mutating={mutating}
            onAttempt={handleAttemptRoom}
            onAssist={handleAssistRoom}
            onReveal={handleRevealRoom}
            onFinish={handleFinishExpedition}
            finishMessage={finishMessage}
          />
        </div>
      )}

      {isPrepared && (
        <ExpeditionDashboard
          state={state}
          mutating={mutating}
          onAttempt={handleAttemptRoom}
          onAssist={handleAssistRoom}
          onReveal={handleRevealRoom}
          onFinish={handleFinishExpedition}
          finishMessage={finishMessage}
        />
      )}
    </div>
  );
}
