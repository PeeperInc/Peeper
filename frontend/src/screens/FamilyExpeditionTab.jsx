import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ProfileName } from '../components/ProfileCustomization';
import * as api from '../api';
import assetCatalog from '../assets/expeditions/root-king/asset-catalog.json';
import ArtifactDetailSheet from '../components/expedition/ArtifactDetailSheet';
import ExpeditionCombatFx from '../components/expedition/ExpeditionCombatFx';
import PersistedRoomMiniGame from '../components/expedition/PersistedRoomMiniGame';
import RewardClaimSheet from '../components/expedition/RewardClaimSheet';
import RoomEffectsBar from '../components/expedition/RoomEffectsBar';
import { preferredExpeditionRoomKey } from '../utils/expeditionRoomSelection.mjs';
import './FamilyExpeditionTab.css';

const EXPEDITION_SPRITE_BASE = '/sprites/expeditions/root-king';
const roomImages = 'rooms';
const bossImages = 'bosses';
const enemyImages = 'enemies';
const provisionImages = 'provisions';
const ROOM_ART_FILES = new Set([
  'bone_archive.webp',
  'boss_sanctum.webp',
  'camp_chamber.webp',
  'collapsed_gallery.webp',
  'crypt_gate.webp',
  'cursed_armory.webp',
  'flooded_catacomb.webp',
  'root_shrine.webp',
]);
const scoutFocusHoldPreview = `${EXPEDITION_SPRITE_BASE}/ui/scout_focus_hold_preview.png`;
const scoutRootCrossingPreview = `${EXPEDITION_SPRITE_BASE}/ui/scout_root_crossing_preview.png`;
const scoutShadeHuntPreview = `${EXPEDITION_SPRITE_BASE}/ui/scout_shade_hunt_preview.png`;
const scoutTimingWindowPreview = `${EXPEDITION_SPRITE_BASE}/ui/scout_timing_window_preview.png`;

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

function assetById(directory, id) {
  if (!id) return null;
  return `${EXPEDITION_SPRITE_BASE}/${directory}/${id}.png`;
}

function roleImage(role) {
  return assetById('ui', `role_${role}`);
}

function artifactImage(artifactId) {
  return assetById('artifacts', artifactId);
}

function normalizeEntries(value) {
  if (Array.isArray(value)) return value.map(item => [item.id, item]);
  return Object.entries(value || {});
}

function artifactIdFromLoadoutSlot(slot) {
  return slot?.artifactId ?? slot;
}

function hasArmedArtifact(member, effectKind, roomKey) {
  return (member?.triggerHistory || []).some(entry => (
    entry?.scope === 'armed'
    && entry?.effectKind === effectKind
    && entry?.roomKey === roomKey
    && Number(entry?.remainingUses || 0) > 0
  ));
}

function artifactUseReason({ artifact, room, member, mutating = false }) {
  if (!artifact || artifact.useType !== 'active') return '';
  if (mutating) return 'Another expedition action is still resolving.';
  if (!room) return 'Choose a current open room first.';
  if (room.state !== 'unlocked') return 'Active artifacts can only be used in the current open room.';
  if (Number(member?.heroHp ?? 3) <= 0 && artifact.id !== 'phoenix_feather') {
    return 'Your hero is knocked out. Only a Phoenix Feather can be used during recovery.';
  }

  const combat = room.type === 'boss' || ['combat', 'boss'].includes(room.encounterType || room.type);
  const hasMinigame = Boolean(room.miniGame);
  const armed = effectKind => hasArmedArtifact(member, effectKind, room.key);
  const hasRoomEffect = effectType => (room.activeEffects || []).some(effect => (
    effect?.effectType === effectType && Number(effect?.remainingUses || 0) > 0
  ));
  const rules = {
    chalk_rune: () => !hasMinigame
      ? 'Chalk Rune can only be used in a mini-game room.'
      : armed('minigame_time_once')
        ? 'A Chalk Rune bonus is already waiting for the next attempt in this room.'
        : '',
    bone_die: () => !combat
      ? 'Bone Die can only be armed in a combat room.'
      : armed('combat_roll_floor') ? 'A damage floor is already armed for this room.' : '',
    wooden_shield: () => !combat
      ? 'Wooden Shield can only be used in a combat room.'
      : armed('prevent_personal_damage') ? 'Your hero already has personal protection armed in this room.' : '',
    tiny_shovel: () => room.type === 'boss'
      ? 'Tiny Shovel cannot damage a boss.'
      : Number(room.progress || 0) >= Number(room.progressTarget || 0)
        ? 'This room no longer needs progress.'
        : '',
    ration_box: () => Number(member?.heroHp ?? 3) >= 3 ? 'Your hero already has full HP.' : '',
    rusty_lockpick: () => !hasMinigame || combat
      ? 'Rusty Lockpick can only be used in a noncombat mini-game room.'
      : armed('minigame_auto_success') ? 'An automatic mini-game success is already armed in this room.' : '',
    loaded_die: () => !combat ? 'Loaded Die can only be used in a combat room.' : '',
    warding_nail: () => !combat
      ? 'Warding Nail can only be placed in a combat room.'
      : hasRoomEffect('knight_shield') ? 'A shared shield is already active in this room.' : '',
    second_chance_coin: () => !hasMinigame || combat
      ? 'Second Chance Coin can only be placed in a noncombat mini-game room.'
      : hasRoomEffect('bend_fate') ? 'A shared free retry is already active in this room.' : '',
    campfire_charm: () => Number(member?.roleCharge || 0) >= 1 ? 'Your class ability is already ready.' : '',
    phoenix_feather: () => Number(member?.heroHp ?? 3) > 0 || !member?.heroRecoverAt
      ? 'Phoenix Feather can only be used while your hero is knocked out.'
      : '',
    hourglass_shard: () => Number(member?.ap || 0) >= 5 ? 'Your AP is already full.' : '',
    crooked_compass: () => armed('bonus_artifact_roll')
      ? 'An extra artifact reward is already armed for this room.'
      : '',
    fates_broken_die: () => !combat ? "Fate's Broken Die can only be used in a combat room." : '',
  };
  return rules[artifact.id]?.() || '';
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

function combatRollPreview(attackTarget = 10) {
  return [
    { roll: '1-4', outcome: { detail: 'Countered: lose 1 HP' } },
    { roll: `5-${Math.max(5, attackTarget - 1)}`, outcome: { detail: 'Miss: no damage roll' } },
    { roll: `${attackTarget}-18`, outcome: { detail: 'Hit: roll 1d6 damage' } },
    { roll: '19', outcome: { detail: 'Critical: roll 2d6 damage' } },
    { roll: '20', outcome: { detail: 'Devastating: roll 3d6 damage' } },
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
  return room?.type === 'boss' || ['combat', 'boss'].includes(room?.encounterType || room?.type);
}

function provisionUseReason({ provisionId, available, member, room, mutating }) {
  if (!available) return 'This provision has already been used.';
  if (mutating) return 'Another expedition action is still resolving.';
  if (!room) return 'Open the current room before using this provision.';
  if (room.state !== 'unlocked') return 'Provisions can only be used in the current open room.';
  if (Number(member?.heroHp ?? 3) <= 0) return 'Your hero cannot eat while knocked out.';

  if (provisionId === 'carrot_rations' && Number(member?.ap || 0) >= 5) {
    return 'Your AP is already full.';
  }
  if (provisionId === 'tomato_soup' && Number(member?.heroHp ?? 3) >= 3) {
    return 'Your HP is already full.';
  }
  if (provisionId === 'warm_milk' && Number(member?.roleCharge || 0) >= 1) {
    return 'Your class ability is already ready.';
  }
  if (['hearty_potato_meal', 'magic_squash_pie'].includes(provisionId) && !isCombatRoom(room)) {
    return 'Damage provisions can only be used during combat.';
  }
  if (provisionId === 'lucky_breakfast' && (!room.miniGame || isCombatRoom(room))) {
    return 'Lucky Breakfast can only be used in a mini-game room.';
  }
  return '';
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
      body: `Roll d20 against AC ${room.attackTarget || (room.type === 'boss' ? 12 : 10)}. Rolls 1-4 hurt your hero. A normal hit rolls 1d6, 19 rolls 2d6, and 20 rolls 3d6. Only an ally's Arcane Link can raise the attack roll.`,
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

function isVisibleRoom(room) {
  return room && !['hidden', 'locked'].includes(room.state);
}

function isActionableRoom(room) {
  return room?.state === 'unlocked' && !room.clearedAt && !room.bossDefeated;
}

function findAssetModule(directory, filename) {
  if (!filename) return null;
  if (directory === roomImages && !ROOM_ART_FILES.has(filename)) return null;
  return `${EXPEDITION_SPRITE_BASE}/${directory}/${filename}`;
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

function useLazyAsset(directory, filename) {
  return findAssetModule(directory, filename);
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

function formatDuration(seconds) {
  const total = Math.max(0, Math.ceil(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.ceil((total % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${Math.max(1, minutes)}m`;
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
    const canonical = Array.isArray(canonicalArtifacts) ? canonicalArtifacts : [];
    const artifactSource = canonical.length > 0 ? canonical : (assetCatalog.artifacts || []);
    const assetMetadata = new Map((assetCatalog.artifacts || []).map(item => [item.id, item]));
    const artifacts = new Map(artifactSource.map(item => [
      item.id,
      { ...(assetMetadata.get(item.id) || {}), ...item },
    ]));
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
  const [artifactIds, setArtifactIds] = useState([null, null, null]);
  const [picker, setPicker] = useState(null);
  const [artifactDetailId, setArtifactDetailId] = useState(null);
  const [artifactSlot, setArtifactSlot] = useState(0);
  const inventory = state.artifactInventory || [];
  const roleCopy = {
    knight: ['🛡️', 'Shield the family', 'Place a shield in the current battle. It blocks the next hit against any family hero. Recharges after 3 hours.'],
    scout: ['🧭', 'Choose the road', 'Once per expedition, reveal three possible next rooms and choose the family path. Warm Milk or a relic can restore it.'],
    mage: ['✨', 'Empower one strike', 'Create one shared +1 damage boost. Any family hero can spend it after a successful attack. Recharges after 3 hours.'],
    cleric: ['💚', 'Heal the wounded', 'Restore 1 HP to every wounded conscious hero. Knocked-out heroes still need their recovery time. Recharges after 3 hours.'],
  };
  Object.assign(roleCopy, {
    knight: ['DEF', 'Guard the next ally', 'Queue Thorn Guard for another family hero. Their next incoming hit is blocked and the enemy takes 3 damage. Recharges after 3 hours.'],
    scout: ['MAP', 'Choose the road', 'Once per expedition, inspect three exact encounters with enemies, AC and room challenges, then lock the family path.'],
    mage: ['ARC', 'Link the next ally', 'Queue Arcane Link for another hero: +3 to their next combat d20 and +2 damage on that same attack. Recharges after 3 hours.'],
    cleric: ['HP', 'Restore the whole party', 'Heal every family hero by 1 HP, including yourself, and shorten active knockouts by 15%. Recharges after 3 hours.'],
  });
  const provisionCopy = {
    carrot_rations: 'Restore all AP, up to 5/5.',
    tomato_soup: 'Restore all HP, up to 3/3.',
    hearty_potato_meal: 'Add +2 damage to every successful attack in the current combat room.',
    lucky_breakfast: 'Gain +1 extra room progress on every successful mini-game attempt in the current room.',
    warm_milk: 'Immediately restore your class ability.',
    truffle_treat: 'Upgrade the rarity table of your next artifact reward.',
    magic_squash_pie: 'Add +3 damage to every successful attack for the rest of the expedition.',
  };

  const selectedRole = roleEntries.find(([id]) => id === role)?.[1] || {};
  const selectedProvision = provisionEntries.find(([id]) => id === provisionId)?.[1] || null;
  const detailInventoryItem = inventory.find(item => item.artifactId === artifactDetailId);
  const detailMeta = artifactDetailId ? artifacts.get(artifactDetailId) : null;
  const detailSelectedCount = artifactIds.filter(id => id === artifactDetailId).length;
  const detailDisabledReason = detailInventoryItem && detailSelectedCount >= Number(detailInventoryItem.quantity || 0)
    ? 'Every owned copy is already in your loadout.'
    : '';

  function equipArtifact(id) {
    setArtifactIds(previous => previous.map((value, index) => (index === artifactSlot ? id : value)));
    setArtifactDetailId(null);
    setPicker(null);
  }

  return (
    <div className="expedition-prep expedition-prep-compact">
      <div className="expedition-card expedition-prep-header">
        <div><div className="expedition-kicker">Preparation</div><h2>Pack for the dungeon</h2></div>
      </div>

      <div className="expedition-prep-selectors">
        <button type="button" className="expedition-prep-selector" onClick={() => setPicker('role')}>
          {roleImage(role) ? <img src={roleImage(role)} alt="" /> : <span>{roleCopy[role]?.[0] || '⚔️'}</span>}
          <div><small>Class</small><strong>{titleize(role)}</strong><em>{roleCopy[role]?.[1]}</em></div>
          <b>Change</b>
        </button>
        <button type="button" className="expedition-prep-selector" onClick={() => setPicker('provision')}>
          {provisionId && assetById(provisionImages, provisionId) ? <img src={assetById(provisionImages, provisionId)} alt="" /> : <span>🍲</span>}
          <div><small>Provision</small><strong>{selectedProvision?.name || provisionNames.get(provisionId)?.name || 'Travel Light'}</strong><em>{provisionId ? provisionCopy[provisionId] : 'Enter without a consumable meal.'}</em></div>
          <b>Choose</b>
        </button>
        <div className="expedition-prep-artifact-block">
          <div><small>Artifacts</small><strong>Three expedition slots</strong></div>
          <div className="expedition-prep-artifact-slots">
            {artifactIds.map((id, index) => {
              const meta = id ? artifacts.get(id) : null;
              return (
                <button type="button" key={index} onClick={() => { setArtifactSlot(index); setPicker('artifact'); }}>
                  {id && artifactImage(id) ? <img src={artifactImage(id)} alt="" /> : <span>+</span>}
                  <small>{meta?.name || `Slot ${index + 1}`}</small>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <button type="button" className="btn btn-primary btn-full expedition-cta" onClick={() => onPrepare({ role, provisionId, artifactIds: artifactIds.filter(Boolean) })} disabled={loading || !role}>
        {loading ? 'Preparing...' : 'Enter Expedition'}
      </button>

      {picker === 'role' && (
        <ExpeditionOverlay title="Choose Class" kicker="Your expedition role" onClose={() => setPicker(null)}>
          <div className="expedition-picker-list">
            {roleEntries.map(([id]) => (
              <button type="button" key={id} className={role === id ? 'selected' : ''} onClick={() => { setRole(id); setPicker(null); }}>
                {roleImage(id) ? <img src={roleImage(id)} alt="" /> : <span>{roleCopy[id]?.[0]}</span>}
                <div><strong>{titleize(id)}</strong><p>{roleCopy[id]?.[2]}</p></div>
              </button>
            ))}
          </div>
        </ExpeditionOverlay>
      )}
      {picker === 'provision' && (
        <ExpeditionOverlay title="Choose Provision" kicker="One manual-use meal" onClose={() => setPicker(null)}>
          <div className="expedition-picker-list expedition-provision-picker">
            <button type="button" className={!provisionId ? 'selected' : ''} onClick={() => { setProvisionId(null); setPicker(null); }}><span>🎒</span><div><strong>Travel Light</strong><p>No provision is consumed.</p></div></button>
            {provisionEntries.map(([id, meta]) => {
              const recipe = meta?.recipe;
              const unavailable = Boolean(recipe && meta.available === false);
              return (
                <button type="button" key={id} className={provisionId === id ? 'selected' : ''} disabled={unavailable} onClick={() => { setProvisionId(id); setPicker(null); }}>
                  {assetById(provisionImages, id) ? <img src={assetById(provisionImages, id)} alt="" /> : <span>🍲</span>}
                  <div><strong>{meta?.name || titleize(id)}</strong><small>{recipe ? `${meta.ownedQuantity || 0}/${recipe.quantity} ${titleize(recipe.productId)}` : ''}</small><p>{unavailable ? 'You need more farm products.' : provisionCopy[id]}</p></div>
                </button>
              );
            })}
          </div>
        </ExpeditionOverlay>
      )}
      {picker === 'artifact' && (
        <ExpeditionOverlay title={`Artifact Slot ${artifactSlot + 1}`} kicker="Choose a relic" onClose={() => setPicker(null)}>
          <div className="expedition-picker-list expedition-artifact-picker">
            <button type="button" onClick={() => { setArtifactIds(previous => previous.map((value, index) => index === artifactSlot ? null : value)); setPicker(null); }}><span>×</span><div><strong>Leave Empty</strong><p>Save this slot for an artifact found during the run.</p></div></button>
            {inventory.map(item => {
              const meta = artifacts.get(item.artifactId);
              return <button type="button" key={item.artifactId} onClick={() => setArtifactDetailId(item.artifactId)}>{artifactImage(item.artifactId) ? <img src={artifactImage(item.artifactId)} alt="" /> : <span>R</span>}<div><strong>{meta?.name || titleize(item.artifactId)}</strong><small>{titleize(meta?.rarity || 'common')} · owned {item.quantity ?? 0}</small><p>{meta?.displayEffect || meta?.effect}</p></div></button>;
            })}
          </div>
        </ExpeditionOverlay>
      )}
      {artifactDetailId && detailMeta && (
        <ArtifactDetailSheet artifact={{ ...detailMeta, image: artifactImage(artifactDetailId), quantity: detailInventoryItem?.quantity || 0, selectedQuantity: detailSelectedCount }} mode="take" disabledReason={detailDisabledReason} onConfirm={() => equipArtifact(artifactDetailId)} onClose={() => setArtifactDetailId(null)} />
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
  const sections = [
    ['The family run', 'An expedition cannot fail or expire. One hero can finish it slowly, while an active family clears rooms much faster. Members may join after the run has started: they prepare a class, food and relics, then arrive in the family\'s current open room.'],
    ['Preparation', 'Choose one class, one optional provision and up to three artifacts. Your choices are personal: family members do not share inventories or prepared loadouts. New relics stay sealed in the final reward cache and cannot be equipped during the same run.'],
    ['AP and activity', 'Every combat roll or mini-game attempt costs 1 AP. You can hold 5 AP and recover 1 AP every hour. AP is spent when a mini-game begins, not after it ends. The final reward quietly scales with how actively each hero helped.'],
    ['Combat: d20 then damage', 'Each enemy shows its own Armor Class (AC). First roll d20: 1-4 causes a 1 HP counter, a final result below AC misses, and AC or higher hits. A hit up to 18 rolls 1d6 damage, 19 rolls 2d6, and 20 rolls 3d6. Damage bonuses affect only the damage total; only Arcane Link from another Mage can add +3 to the d20.'],
    ['Room mini-games', 'Noncombat rooms use one of five challenges: Dodge the Trap, Rune Sequence, Root Crossing, Focus Hold or Shade Hunt. Starting costs 1 AP. Success always adds exactly 1 room progress. Failure spends the AP but never damages HP, and another attempt becomes available immediately unless a free retry triggers.'],
    ['HP and knockout', 'Every hero has 3 HP and HP does not refill when the family enters a new room. At 0 HP the hero is knocked out for 6 hours and cannot act, then returns with all 3 HP. A Phoenix Feather revives immediately. Family Prayer heals wounded heroes and shortens every active knockout by 15%.'],
    ['Knight, Mage and Cleric', 'Thorn Guard protects the next ally who would take combat damage, blocks it and retaliates for 3 damage. Arcane Link gives the next ally +3 to one d20 and +2 damage if that attack hits. Family Prayer immediately heals every wounded hero by 1 HP, including the Cleric. These abilities recharge in 3 hours and cannot be consumed by their caster; queued ally buffs survive mini-game rooms.'],
    ['Scout', 'Pathfinder is used once per expedition. It reveals three possible next rooms with the exact enemy and AC or the exact mini-game, then lets the Scout choose the family route. Warm Milk or Campfire Charm can restore the spent Pathfinder ability.'],
    ['Provisions', 'Food is consumed only when you tap it. Carrot Rations fully restore AP, while Tomato Soup fully restores HP. Hearty Potato Meal adds +2 damage to every hit in the current combat room, and Magic Squash Pie adds +3 damage for the rest of the expedition; both can only be eaten during combat. Lucky Breakfast can only be eaten in a mini-game room and adds +1 extra progress to every successful attempt in that room. Warm Milk restores your class ability, and Truffle Treat upgrades the next artifact reward.'],
    ['Artifacts', 'Only your three equipped relics work. Passive relics activate automatically for the whole expedition and are consumed when it ends. Active relics are consumed when used. Tap any relic in the top bar to see its exact effect, valid room and current availability; an unavailable relic remains safe in its slot.'],
    ['Rooms and rewards', 'The map hides future rooms, while cleared and current rooms remain visible. Spend AP in a room to earn a personal relic chance when that room is cleared; spending more AP improves that chance. Loot stays hidden until the expedition ends, with a maximum of four relics per hero. Duplicate relics remain usable copies, and the final cache also has a 30% chance to contain one unowned outfit or home decoration. Unclaimed rewards remain available after the Root King falls.'],
  ];
  return (
    <div className="expedition-guide-accordion">
      {sections.map(([title, copy], index) => (
        <details key={title} open={index === 0}>
          <summary><span>{String(index + 1).padStart(2, '0')}</span><strong>{title}</strong><i>+</i></summary>
          <p>{copy}</p>
        </details>
      ))}
    </div>
  );
}

function DiceFace({ sides, value, className = '' }) {
  const isD20 = Number(sides) === 20;
  const points = isD20
    ? '50,2 78,10 96,34 96,66 78,90 50,98 22,90 4,66 4,34 22,10'
    : '50,3 97,94 3,94';
  return (
    <svg
      className={`expedition-die-face ${isD20 ? 'd20' : 'd6'} ${className}`.trim()}
      viewBox="0 0 100 100"
      aria-label={`d${sides} result ${value}`}
      role="img"
    >
      <polygon className="expedition-die-face__shell" points={points} />
      <polygon className="expedition-die-face__rim" points={points} />
      <text className="expedition-die-face__label" x="50" y={isD20 ? '28' : '39'}>d{sides}</text>
      <text className="expedition-die-face__value" x="50" y={isD20 ? '69' : '76'}>{value}</text>
    </svg>
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
    countered: 'Countered',
    miss: 'Miss',
    hit: 'Hit',
    critical_hit: 'Critical hit',
    devastating_hit: 'Devastating hit',
  }[combatEvent.outcome] || titleize(combatEvent.outcome) : null;

  return (
    <div className="expedition-last-roll">
      <DiceFace sides={20} value={combatEvent?.attackRoll ?? action.rawRoll ?? '?'} />
      {(combatEvent?.damageRolls || []).map((roll, index) => (
        <DiceFace sides={6} value={roll} className="damage" key={`damage-${index}`} />
      ))}
      <div className="expedition-last-roll-copy">
        <div>
          <strong>Last Roll</strong>
          {combatEvent ? (
            <span>
              {combatCopy} / d20 {combatEvent.attackRoll ?? action.rawRoll ?? '?'}{combatEvent.attackBonus ? ` (${combatEvent.naturalRoll} + ${combatEvent.attackBonus})` : ''} vs AC {combatEvent.attackTarget || '?'} / {combatEvent.progress || 0} total damage
              {damageEvent ? ` / HP ${damageEvent.heroHp}/3` : ''}
            </span>
          ) : (
            <span>Modified {action.modifiedRoll ?? '?'} / +{action.progressAwarded || 0} progress</span>
          )}
        </div>
        {(combatEvent || modifierParts.length > 0) && (
          <small>
            {combatEvent
              ? `Damage: ${(combatEvent.damageRolls || []).length ? `${combatEvent.damageRolls.join(' + ')}${combatEvent.damageBonus ? ` + ${combatEvent.damageBonus} bonus` : ''}` : 'no damage roll'}`
              : modifierParts.slice(0, 3).map(part => `${titleize(part.source)} ${signedNumber(part.amount)}`).join(' / ')}
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

function RoleAbilityGlyph({ role }) {
  if (role === 'knight') {
    return <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 5 52 13v17c0 13-8 23-20 29C20 53 12 43 12 30V13Z" /><path d="M22 29h20M32 18v24" /></svg>;
  }
  if (role === 'mage') {
    return <svg viewBox="0 0 64 64" aria-hidden="true"><path d="m32 5 5 17 17 5-17 5-5 17-5-17-17-5 17-5Z" /><path d="m48 41 2 7 7 2-7 2-2 7-2-7-7-2 7-2Z" /></svg>;
  }
  if (role === 'cleric') {
    return <svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="25" /><path d="M32 17v30M17 32h30" /></svg>;
  }
  return <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M9 49 29 9l5 20 21 5-40 20Z" /><circle cx="39" cy="25" r="5" /></svg>;
}

function RoleAbilityControl({ member, room, mutating, onUse }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const readyAt = Number(member?.roleChargeReadyAt || 0);
  const ready = Number(member?.roleCharge || 0) > 0 || (readyAt > 0 && readyAt <= now);

  useEffect(() => {
    if (ready || !readyAt) return undefined;
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [ready, readyAt]);

  if (!member?.role || member.role === 'scout' || !isActionableRoom(room)) return null;
  const copy = {
    mage: ['Arcane Link', 'Next ally gets +3 to d20 and +2 damage. Your own roll cannot consume it.'],
    knight: ['Thorn Guard', 'Blocks the next hit against an ally and strikes back for 3 damage.'],
    cleric: ['Family Prayer', 'Heals every hero +1 HP and shortens knockouts by 15%.'],
  }[member.role];
  if (!copy) return null;
  const cooldown = readyAt
    ? formatDuration(Math.max(0, readyAt - now))
    : 'Used for this expedition';

  return (
    <button
      type="button"
      className={`expedition-role-ability is-${member.role}${ready ? ' is-ready' : ' is-cooldown'}`}
      onClick={() => onUse(room.key)}
      disabled={!ready || mutating}
    >
      <span className="expedition-role-ability-icon"><RoleAbilityGlyph role={member.role} /></span>
      <span className="expedition-role-ability-copy">
        <small>{ready ? 'Ability ready' : 'Recharging'}</small>
        <strong>{copy[0]}</strong>
        <em>{ready ? copy[1] : `Ready in ${cooldown}`}</em>
      </span>
    </button>
  );
}

function ScoutMinigamePreview({ miniGame = {} }) {
  const rawKind = miniGame.kind || miniGame.type || 'timing_window';
  const kind = rawKind === 'path_pick'
    ? 'root_crossing'
    : rawKind === 'shadow_match'
      ? 'shadow_hunt'
      : rawKind;
  if (kind === 'rune_sequence') {
    return <div className="expedition-scout-minigame runes">{Array.from({ length: 9 }, (_, index) => <i key={index}>{['◇', '△', '○'][index % 3]}</i>)}</div>;
  }
  if (kind === 'root_crossing') {
    return <img className="expedition-scout-minigame crossing" src={scoutRootCrossingPreview} alt="Root Crossing preview" />;
  }
  if (kind === 'shadow_hunt') {
    return <img className="expedition-scout-minigame shadows" src={scoutShadeHuntPreview} alt="Shade Hunt preview" />;
  }
  if (kind === 'focus_hold') {
    return <img className="expedition-scout-minigame focus" src={scoutFocusHoldPreview} alt="Focus Hold preview" />;
  }
  return <img className="expedition-scout-minigame timing" src={scoutTimingWindowPreview} alt="Timing Window preview" />;
}

function ScoutChoicePreview({ choice, selected, onSelect }) {
  const choiceRoom = choice.room || {};
  const roomArt = useLazyAsset(roomImages, roomArtFile(choiceRoom));
  const enemyArt = useLazyAsset(enemyImages, enemyArtFile(choiceRoom));
  const combat = isCombatRoom(choiceRoom);
  return (
    <button
      type="button"
      className={`expedition-scout-preview${selected ? ' selected' : ''}`}
      onClick={onSelect}
    >
      <span className="expedition-scout-preview-art" style={roomArt ? { backgroundImage: `url(${roomArt})` } : undefined}>
        {combat && enemyArt && <img src={enemyArt} alt="" />}
        {!combat && <ScoutMinigamePreview miniGame={choiceRoom.miniGame} />}
      </span>
      <span className="expedition-scout-preview-copy">
        <small>{combat ? 'Combat room' : 'Room challenge'}</small>
        <strong>{choice.label || choiceRoom.name || titleize(choiceRoom.type || 'Path')}</strong>
        {combat ? (
          <em>{titleize(choiceRoom.enemyId || 'Dungeon enemy')} · AC {choiceRoom.attackTarget || 10}</em>
        ) : (
          <em>{choiceRoom.miniGame?.label || titleize(choiceRoom.miniGame?.kind || 'Unknown challenge')}</em>
        )}
      </span>
    </button>
  );
}

function ScoutChoicePanel({ room, member, roles, mutating, onScoutChoice }) {
  const choices = Array.isArray(room?.scoutChoices) ? room.scoutChoices : [];
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
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
    <>
      <button type="button" className="expedition-role-ability is-scout is-ready" onClick={() => setOpen(true)} disabled={mutating}>
        <span className="expedition-role-ability-icon"><RoleAbilityGlyph role="scout" /></span>
        <span className="expedition-role-ability-copy">
          <small>Once per expedition</small>
          <strong>Scout Ahead</strong>
          <em>Reveal three exact encounters and lock the safest route for your family.</em>
        </span>
      </button>
      {open && (
        <div className="expedition-scout-modal" role="dialog" aria-modal="true" aria-label="Scout the next room" onClick={() => setOpen(false)}>
          <div className="expedition-scout-modal-panel" onClick={event => event.stopPropagation()}>
            <header>
              <div><small>Scout ability</small><strong>Choose the next room</strong></div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close">×</button>
            </header>
            <p>You see what waits behind every route. Your choice becomes the family's next room.</p>
            <div className="expedition-scout-preview-list">
              {choices.map(choice => (
                <ScoutChoicePreview
                  key={choice.id}
                  choice={choice}
                  selected={selectedId === choice.id}
                  onSelect={() => setSelectedId(choice.id)}
                />
              ))}
            </div>
            <button
              type="button"
              className="btn btn-primary expedition-scout-confirm"
              disabled={!selectedId || mutating}
              onClick={async () => {
                await onScoutChoice(room.key, selectedId);
                setOpen(false);
              }}
            >
              {mutating ? 'Locking route...' : 'Choose this route'}
            </button>
          </div>
        </div>
      )}
    </>
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
  onScoutChoice,
  onMinigameStart,
  onMinigameFinish,
  onRoleAbility,
  onCombatExit,
  onRollFxComplete,
  currentMinigameAttempt,
  transitionPhase,
}) {
  const [showRoomInfo, setShowRoomInfo] = useState(false);
  const [combatReveal, setCombatReveal] = useState({ phase: 'idle', progressBefore: 0, action: null });
  const [rollingFaces, setRollingFaces] = useState([]);
  const selectedMechanicChoice = null;
  const roomArt = useLazyAsset(roomImages, roomArtFile(room));
  const bossArt = useLazyAsset(bossImages, bossArtFile(room));
  const enemyArt = useLazyAsset(enemyImages, enemyArtFile(room));
  const primaryAction = useMemo(() => primaryActionForRoom(room, member, roles), [room, member, roles]);
  const weakRoleLabels = (room?.weakRoles || []).map(role => roles?.[role]?.name || titleize(role));
  const mechanic = roomRuleCopy(room);
  const combatRoom = isCombatRoom(room);
  const eventRoom = !combatRoom && !['boss', 'camp'].includes(room?.type);
  const roomTraitChips = [
    room?.complication ? { key: 'complication', label: `Complication: ${titleize(room.complication)}`, danger: true } : null,
    member?.debuff?.type ? { key: 'debuff', label: `You: ${titleize(member.debuff.type)}`, danger: true } : null,
  ].filter(Boolean);
  const stageAction = lastRoll?.roomKey === room?.key ? lastRoll : null;
  const stageEvents = stageAction?.events || stageAction?.modifiers?.events || [];
  const stageCombatEvent = stageEvents.find(event => event.type === 'combat_roll');
  const stageDamageEvent = stageEvents.find(event => event.type === 'hero_damaged');
  const stageOutcome = stageCombatEvent?.outcome || null;
  const stageOutcomeCopy = {
    countered: ['Countered', 'hero hit'],
    miss: ['Miss', 'no damage'],
    hit: ['Hit', 'enemy damaged'],
    critical_hit: ['Critical', 'enemy damaged'],
    devastating_hit: ['Devastating', 'enemy crushed'],
  }[stageOutcome] || [titleize(stageOutcome), 'resolved'];
  const stageDamage = Number(stageCombatEvent?.progress || 0);
  const combatVisualResolved = !combatRoom || combatReveal.phase === 'resolved';
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
          body: `Roll a clean d20 against AC ${room?.attackTarget || (room?.type === 'boss' ? 12 : 10)}. A normal hit rolls 1d6 damage, 19 rolls 2d6, and 20 rolls 3d6.`,
        }
      : {
          title: mechanic.title,
          body: mechanic.body,
        };
  const sharedBuffAmount = 0;
  const provisionDamageBonus = member?.provisionState?.damageBonus
    && room?.key
    && member.provisionState.damageBonus.roomKey === room.key
    ? Number(member.provisionState.damageBonus.amount || 0)
    : 0;
  const totalDamageBonus = provisionDamageBonus + sharedBuffAmount;
  const heroRecoverAt = Number(member?.heroRecoverAt || 0);
  const heroRecovering = heroRecoverAt > Math.floor(Date.now() / 1000) || Number(member?.heroHp ?? 3) <= 0;
  const heroRecoverLabel = heroRecoverAt > 0 ? `Recovering until ${formatTime(heroRecoverAt)}` : 'Hero is recovering';
  useEffect(() => {
    setShowRoomInfo(false);
    setCombatReveal({ phase: 'idle', progressBefore: 0, action: null });
    setRollingFaces([]);
  }, [room?.key]);

  function animateRollNumbers(sides, count = 1) {
    setRollingFaces(Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides)));
    return new Promise(resolve => {
      const ticker = window.setInterval(() => {
        setRollingFaces(Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides)));
      }, 45);
      window.setTimeout(() => {
        window.clearInterval(ticker);
        setRollingFaces([]);
        resolve();
      }, 500);
    });
  }

  async function runAttackRoll() {
    const progressBefore = Number(room?.progress || 0);
    setCombatReveal({ phase: 'rolling-attack', progressBefore, action: null });
    try {
      const [action] = await Promise.all([
        onAttempt(room.key, null, {
          selectedSupport: 0,
          mechanicChoice: selectedMechanicChoice,
          useSharedBuff: false,
        }),
        animateRollNumbers(20, 1),
      ]);
      const combatEvent = (action?.events || action?.modifiers?.events || [])
        .find(event => event.type === 'combat_roll');
      setCombatReveal({
        phase: combatEvent?.damageRolls?.length ? 'awaiting-damage' : 'resolved',
        progressBefore,
        action,
      });
    } catch (error) {
      setCombatReveal({ phase: 'idle', progressBefore, action: null });
      throw error;
    }
  }

  async function runDamageRoll() {
    setCombatReveal(current => ({ ...current, phase: 'rolling-damage' }));
    await animateRollNumbers(6, Math.max(1, revealDamageDice));
    setCombatReveal(current => ({ ...current, phase: 'resolved' }));
    if (combatReveal.action?.roomCleared) onCombatExit?.(room.key);
  }

  if (!room) {
    return (
      <div className="expedition-card expedition-room-panel">
        <div className="expedition-empty">Select an open room to inspect the dungeon.</div>
      </div>
    );
  }

  const progressTarget = room.progressTarget || 1;
  const damagePending = ['rolling-attack', 'awaiting-damage', 'rolling-damage'].includes(combatReveal.phase);
  const revealEvents = combatReveal.action?.events || combatReveal.action?.modifiers?.events || [];
  const revealCombatEvent = revealEvents.find(event => event.type === 'combat_roll');
  const revealDamageDice = revealCombatEvent?.damageRolls?.length || 0;
  const visibleProgress = Math.max(0, Math.min(
    progressTarget,
    damagePending ? Number(combatReveal.progressBefore || 0) : Number(room.progress || 0),
  ));
  const progressPercent = Math.round((visibleProgress / progressTarget) * 100);
  const enemyHp = Math.max(0, progressTarget - visibleProgress);
  const enemyHpPercent = Math.round((enemyHp / progressTarget) * 100);
  const foregroundArt = bossArt || (combatRoom ? enemyArt : null);
  const locked = room.state === 'locked';
  const hidden = room.state === 'hidden';
  const combatResolutionPending = combatRoom
    && ['rolling-attack', 'awaiting-damage', 'rolling-damage'].includes(combatReveal.phase);
  const actionable = isActionableRoom(room) || combatResolutionPending;

  return (
    <div className={`expedition-card expedition-room-panel state-${room.state || 'unknown'}${transitionPhase ? ` transition-${transitionPhase}` : ''}`}>
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
        {stageOutcome && combatVisualResolved && (
          <div className={`expedition-stage-impact ${stageDamage > 0 ? 'damage' : stageOutcome}`}>
            <strong>{stageDamage > 0 ? `-${stageDamage}` : stageOutcomeCopy[0]}</strong>
            <span>{stageDamage > 0 ? 'enemy HP' : stageOutcomeCopy[1]}</span>
          </div>
        )}
        {stageDamageEvent && combatVisualResolved && (
          <div className="expedition-hero-hurt">
            <strong>-1 HP</strong>
            <span>hero hurt</span>
          </div>
        )}
        {transitionPhase === 'defeat' && (
          <div className="expedition-enemy-defeat" aria-live="polite">
            <div>{Array.from({ length: 10 }, (_, index) => <i key={index} style={{ '--particle': index }} />)}</div>
            <strong>Enemy defeated</strong>
            <span>The path opens</span>
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

      <RoomEffectsBar
        effects={room.activeEffects || []}
        sharedBuffs={expedition?.sharedBuffs}
        viewerUserId={member?.userId}
      />

      {hidden || locked ? (
        <div className="expedition-room-locked">
          <strong>{hidden ? 'The passage is still under root-fog.' : 'This room is sealed.'}</strong>
          <span>{hidden ? 'Use a Scout reveal from a connected room.' : 'Clear connected rooms to unlock it.'}</span>
        </div>
      ) : (
        <>
          <div className="expedition-room-meter">
            <div>
              <span>{combatRoom ? 'Enemy HP' : 'Progress'}</span>
              <strong>{combatRoom ? `${enemyHp}/${progressTarget}` : `${visibleProgress}/${progressTarget}`}</strong>
              <button
                type="button"
                className={`expedition-room-info-toggle${showRoomInfo ? ' active' : ''}`}
                onClick={() => setShowRoomInfo(value => !value)}
                aria-expanded={showRoomInfo}
              >
                {showRoomInfo ? 'Hide info' : 'Room info'}
              </button>
            </div>
            <i><b style={{ width: `${combatRoom ? enemyHpPercent : progressPercent}%` }} /></i>
          </div>

          {roomTraitChips.length > 0 && (
            <div className="expedition-room-traits">
              {roomTraitChips.map(chip => (
                <span key={chip.key} className={chip.danger ? 'danger' : ''}>{chip.label}</span>
              ))}
            </div>
          )}

          {showRoomInfo && (
            <div className="expedition-encounter-director">
              <div className="expedition-encounter-row">
                <div>
                  <span>Encounter</span>
                  <strong>{titleize(room.encounterType || room.type || 'room')}</strong>
                </div>
                {combatRoom && <div><span>Armor Class</span><strong>Hit on {room.attackTarget || (room.type === 'boss' ? 12 : 10)}+</strong></div>}
              </div>
              <div className="expedition-mechanic-card">
                <strong>{encounterGuide.title}</strong>
                <span>{encounterGuide.body}</span>
              </div>
              {primaryAction && !eventRoom && (
                <div className="expedition-roll-preview expedition-roll-preview-info">
                  {(combatRoom ? combatRollPreview(room.attackTarget || (room.type === 'boss' ? 12 : 10)) : expectedProgressForAction(
                    primaryAction,
                    member,
                    roleMeta,
                    0,
                    sharedBuffAmount,
                  )).map(item => (
                    <span key={item.roll}>
                      <b>{item.roll}</b>
                      {item.outcome.detail}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {!eventRoom && (!combatRoom || combatReveal.phase === 'resolved') && <LastRollPanel action={lastRoll} />}

          {heroRecovering && (
            <div className="expedition-room-locked expedition-hero-recovery" role="status">
              <i aria-hidden="true">☠️</i>
              <div>
                <strong>Hero knocked out</strong>
                <span>{heroRecoverLabel}. Expedition actions unlock after recovery.</span>
              </div>
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

              <div className="expedition-power-grid">
                <RoleAbilityControl
                  member={member}
                  room={room}
                  mutating={mutating}
                  onUse={onRoleAbility}
                />
              </div>

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
                  {primaryAction ? (
                    <div className={`expedition-one-roll-card${mutating ? ' is-rolling' : ''}`}>
                      {['rolling-attack', 'rolling-damage'].includes(combatReveal.phase) && (
                        <div className={`expedition-roll-ticker ${combatReveal.phase === 'rolling-damage' ? 'damage' : 'attack'}`} role="status">
                          <div>
                            {(rollingFaces.length ? rollingFaces : [1]).map((face, index) => (
                              <DiceFace
                                sides={combatReveal.phase === 'rolling-damage' ? 6 : 20}
                                value={face}
                                key={`${combatReveal.phase}-${index}`}
                              />
                            ))}
                          </div>
                          <small>{combatReveal.phase === 'rolling-damage' ? 'Damage' : 'Attack'}</small>
                        </div>
                      )}
                      {combatReveal.phase === 'awaiting-damage' && revealCombatEvent && (
                        <div className="expedition-attack-result" role="status">
                          <DiceFace sides={20} value={revealCombatEvent.attackRoll} />
                          <div>
                            <strong>{revealCombatEvent.outcome === 'devastating_hit' ? 'Devastating hit' : revealCombatEvent.outcome === 'critical_hit' ? 'Critical hit' : 'Armor broken'}</strong>
                            <span>AC {revealCombatEvent.attackTarget} beaten. Roll {revealDamageDice}d6 damage.</span>
                          </div>
                        </div>
                      )}
                      <div className="expedition-one-roll-main">
                        <div>
                          <span>Attack check</span>
                          <strong>Hit on {room.attackTarget || (room.type === 'boss' ? 12 : 10)}+</strong>
                          <small>d20 check, then 1d6 / 2d6 / 3d6 damage · 1 AP</small>
                        </div>
                        <div className="expedition-roll-score">
                          <span>Damage bonus</span>
                          <strong>{signedNumber(totalDamageBonus)}</strong>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary expedition-roll-button"
                        onClick={combatReveal.phase === 'awaiting-damage' ? runDamageRoll : runAttackRoll}
                        disabled={mutating || ['rolling-attack', 'rolling-damage'].includes(combatReveal.phase) || ((member?.ap || 0) <= 0 && combatReveal.phase !== 'awaiting-damage') || heroRecovering}
                      >
                        {combatReveal.phase === 'awaiting-damage'
                          ? `Roll ${revealDamageDice || 1}d6 damage`
                          : ['rolling-attack', 'rolling-damage'].includes(combatReveal.phase) || mutating
                            ? 'Rolling...'
                            : 'Roll d20 attack'}
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
  onScoutChoice,
  onMinigameStart,
  onMinigameFinish,
  onUseArtifact,
  onUseProvision,
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
  const [roomTransition, setRoomTransition] = useState(null);
  const [showArchive, setShowArchive] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [artifactUseId, setArtifactUseId] = useState(null);
  const [showProvision, setShowProvision] = useState(false);
  const rooms = state.map?.rooms || [];
  const edges = state.map?.edges || [];
  const roomCounts = rooms.reduce((counts, room) => {
    counts.total += 1;
    counts[room.state || 'unknown'] = (counts[room.state || 'unknown'] || 0) + 1;
    return counts;
  }, { total: 0 });
  const member = state.member;
  const roleMeta = state.catalog?.roles?.[member?.role] || {};
  const provision = member?.provisionId ? provisions.get(member.provisionId) : null;
  const provisionAvailable = Boolean(member?.provisionId && member?.provisionState?.available && !member?.provisionState?.used);
  const selectedRoom = rooms.find(room => room.key === selectedRoomKey) || null;
  const provisionDisabledReason = provisionUseReason({
    provisionId: member?.provisionId,
    available: provisionAvailable,
    member,
    room: selectedRoom,
    mutating,
  });
  const equippedRelics = Array.from({ length: 3 }, (_, slotIndex) => {
    const slot = member?.loadout?.[slotIndex] || null;
    const artifactId = artifactIdFromLoadoutSlot(slot);
    const meta = artifacts.get(artifactId);
    return artifactId && meta ? { artifactId, slotIndex, meta } : null;
  });
  const heroRecoverAt = Number(member?.heroRecoverAt || 0);
  const heroRecovering = heroRecoverAt > Math.floor(Date.now() / 1000) || Number(member?.heroHp ?? 3) <= 0;
  const currentMinigameAttempt = state.currentMinigameAttempt || null;

  useEffect(() => {
    if (lastRoll?.pending || roomTransition) return;
    const preferred = preferredExpeditionRoomKey(
      rooms,
      selectedRoomKey,
      currentMinigameAttempt?.roomKey || null,
    );
    if (preferred !== selectedRoomKey) setSelectedRoomKey(preferred);
  }, [rooms, selectedRoomKey, currentMinigameAttempt?.roomKey, lastRoll?.pending, roomTransition]);

  useEffect(() => {
    if (selectedRoom?.miniGame && lastRoll?.actionType === 'attempt') setLastRoll(null);
  }, [lastRoll?.actionType, selectedRoom?.key, selectedRoom?.miniGame]);

  async function handleAttempt(roomKey, actionId, options) {
    setLastRoll({ roomKey, pending: true });
    try {
      const next = await onAttempt(roomKey, actionId, options);
      const action = latestAction(next?.recentActions);
      if (action?.actionType === 'attempt') {
        const resolvedRoom = next?.map?.rooms?.find(candidate => candidate.key === roomKey);
        const resolvedAction = {
          ...action,
          roomKey,
          roomCleared: resolvedRoom?.state === 'cleared',
          events: next?.visualEvents || action.events || action.modifiers?.events || [],
        };
        setLastRoll(resolvedAction);
        if (resolvedAction.roomCleared && isCombatRoom(resolvedRoom)) {
          setRoomTransition({ phase: 'awaiting-damage', roomKey });
        }
        return resolvedAction;
      } else {
        setLastRoll(null);
        return null;
      }
    } catch (error) {
      setLastRoll(null);
      throw error;
    }
  }

  async function handleCombatExit(roomKey) {
    setRoomTransition({ phase: 'defeat', roomKey });
    await new Promise(resolve => window.setTimeout(resolve, 900));
    const nextRoomKey = preferredExpeditionRoomKey(rooms, roomKey);
    setLastRoll(null);
    if (!nextRoomKey || nextRoomKey === roomKey) {
      setRoomTransition(null);
      return;
    }
    setSelectedRoomKey(nextRoomKey);
    setRoomTransition({ phase: 'enter', roomKey: nextRoomKey });
    window.setTimeout(() => setRoomTransition(null), 480);
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

  const artifactUse = equippedRelics.find(item => item?.artifactId === artifactUseId);
  const artifactUseDisabledReason = artifactUseReason({
    artifact: artifactUse ? { id: artifactUse.artifactId, ...artifactUse.meta } : null,
    room: selectedRoom,
    member,
    mutating,
  });

  return (
    <div className="expedition-dashboard">
      <div className="expedition-game-topbar">
        <button type="button" className="expedition-nav-button" onClick={onClose}>Back</button>
        <div className="expedition-game-title">
          <span>Family Expedition</span>
          <strong>Root King</strong>
        </div>
        <div className="expedition-game-actions">
          <button type="button" className="expedition-nav-button" onClick={() => setShowMenu(true)}>Menu</button>
        </div>
      </div>

      <div className="expedition-player-hud">
        <div className={`expedition-hud-stat hp${heroRecovering ? ' danger' : ''}`}>
          <span>HP</span>
          <strong>{heroRecovering ? 'KO' : `${member?.heroHp ?? 3}/3`}</strong>
        </div>
        <div className="expedition-hud-stat ap">
          <span>AP</span>
          <strong>{member?.ap ?? 0}/5</strong>
        </div>
        <div className="expedition-hud-role">
          <span>⚔️ {titleize(member?.role || 'Hero')}</span>
          <small>Class</small>
        </div>
        <button type="button" className={`expedition-hud-provision${provisionAvailable ? ' ready' : ''}`} onClick={() => setShowProvision(true)} disabled={!member?.provisionId}>
          {member?.provisionId && assetById(provisionImages, member.provisionId) ? <img src={assetById(provisionImages, member.provisionId)} alt="" /> : <span>🍲</span>}
          <small>Food</small>
        </button>
        <div className="expedition-hud-relics" aria-label="Equipped relics">
          {equippedRelics.map((item, slotIndex) => item ? (
            <button
              type="button"
              key={`${item.artifactId}-${slotIndex}`}
              className={`rarity-${item.meta.rarity || 'common'}`}
              onClick={() => setArtifactUseId(item.artifactId)}
              aria-label={`${item.meta.name || titleize(item.artifactId)} relic`}
            >
              {artifactImage(item.artifactId)
                ? <img src={artifactImage(item.artifactId)} alt="" />
                : <span>R</span>}
              {item.meta.useType === 'active' && <i aria-hidden="true" />}
            </button>
          ) : (
            <span key={`empty-relic-${slotIndex}`} aria-label="Empty relic slot" />
          ))}
        </div>
      </div>

      {state.permissions?.canFinish && (
        <button
          type="button"
          className="btn btn-primary expedition-finish-button expedition-finish-wide"
          onClick={onFinish}
          disabled={mutating}
        >
          {mutating ? 'Sealing...' : 'Finish Expedition'}
        </button>
      )}

      {finishMessage && <p className="expedition-finish-hint">Expedition archived. History will show the final family record.</p>}

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
        onScoutChoice={onScoutChoice}
        onMinigameStart={onMinigameStart}
        onMinigameFinish={handleRoomMinigameFinish}
        onRoleAbility={onRoleAbility}
        onCombatExit={handleCombatExit}
        onRollFxComplete={() => {}}
        currentMinigameAttempt={currentMinigameAttempt}
        transitionPhase={roomTransition?.roomKey === selectedRoomKey ? roomTransition.phase : null}
      />

      {showMenu && (
        <ExpeditionOverlay title="Expedition Menu" kicker="Records & rules" onClose={() => setShowMenu(false)}>
          <div className="expedition-mobile-menu">
            <button type="button" onClick={() => { setShowMenu(false); setShowArchive(true); }}>
              <strong>Vault</strong>
              <span>Relics, family prep and expedition history.</span>
            </button>
            <button type="button" onClick={() => { setShowMenu(false); setShowGuide(true); }}>
              <strong>Guide</strong>
              <span>Combat, rooms, roles and rewards.</span>
            </button>
            <div>
              <span>Dungeon progress</span>
              <strong>{roomCounts.cleared || 0} cleared · {roomCounts.unlocked || 0} open</strong>
              <small>{provision?.name || titleize(member?.provisionId || 'No provision')}</small>
            </div>
          </div>
        </ExpeditionOverlay>
      )}

      {showArchive && (
        <ExpeditionOverlay title="Vault & Ledger" kicker="Archive" onClose={() => setShowArchive(false)} wide>
          <section>
            <div className="expedition-section-title">Family Prep</div>
            <div className="expedition-member-list">
              {(state.familyMembers || []).map(memberRow => {
                const heroHp = Math.max(0, Math.min(3, Number(memberRow.heroHp ?? 3)));
                const healthState = heroHp <= 0
                  ? 'knocked-out'
                  : heroHp < 3
                    ? 'wounded'
                    : 'healthy';
                return (
                  <div key={memberRow.userId} className="expedition-member-row">
                    <ProfileName user={memberRow}>{memberRow.firstName || memberRow.username || 'Family member'}</ProfileName>
                    <div className="expedition-member-status">
                      <strong>{memberRow.prepared ? titleize(memberRow.role) : 'Not ready'}</strong>
                      {memberRow.prepared && (
                        <small className={`expedition-member-hp is-${healthState}`}>
                          {healthState === 'knocked-out' ? 'KO' : 'HP'} {heroHp}/3
                        </small>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <ExpeditionArchivePanel
            archive={archive}
            currentInventory={state.artifactInventory}
            familyMembers={state.familyMembers}
            canonicalArtifacts={state.catalog?.artifacts}
          />

          <details className="expedition-recent-actions">
            <summary>
              <strong>Recent Actions</strong>
              <span>{(state.recentActions || []).length} entries</span>
            </summary>
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
          </details>
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
          mode={artifactUse.meta.useType === 'active' ? 'use' : 'inspect'}
          disabledReason={artifactUseDisabledReason}
          onConfirm={() => handleUseArtifact(artifactUse.artifactId)}
          onClose={() => setArtifactUseId(null)}
        />
      )}
      {showProvision && member?.provisionId && (
        <ExpeditionOverlay title={provision?.name || titleize(member.provisionId)} kicker="Expedition provision" onClose={() => setShowProvision(false)}>
          <div className="expedition-provision-use">
            {assetById(provisionImages, member.provisionId) && <img src={assetById(provisionImages, member.provisionId)} alt="" />}
            <p>{provision?.description || {
              carrot_rations: 'Restore all AP now.', tomato_soup: 'Restore all HP now.', hearty_potato_meal: 'Add +2 damage to every successful attack in this combat room.', lucky_breakfast: 'Gain +1 extra progress on every successful mini-game attempt in this room.', warm_milk: 'Restore your class ability immediately.', truffle_treat: 'Upgrade your next artifact reward.', magic_squash_pie: 'Add +3 damage to every successful attack for the rest of this expedition.',
            }[member.provisionId]}</p>
            {provisionDisabledReason && <p className="expedition-provision-reason">{provisionDisabledReason}</p>}
            <button type="button" className="btn btn-primary btn-full" disabled={Boolean(provisionDisabledReason)} onClick={async () => { const next = await onUseProvision(selectedRoom.key); if (next) setShowProvision(false); }}>
              {provisionAvailable ? 'Use Provision' : 'Already Used'}
            </button>
          </div>
        </ExpeditionOverlay>
      )}
    </div>
  );
}

function ExpeditionArchivePanel({ archive, currentInventory = [], familyMembers = [], canonicalArtifacts = [] }) {
  const { artifacts } = useCatalogMaps(canonicalArtifacts);
  const [openPanel, setOpenPanel] = useState(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState(null);
  const [selectedRun, setSelectedRun] = useState(null);
  const memberNameById = useMemo(() => new Map(
    (familyMembers || []).map(member => [member.userId, member.firstName || member.username || 'Family']),
  ), [familyMembers]);
  const inventory = (currentInventory?.length ? currentInventory : archive?.artifactInventory || [])
    .filter(item => Number(item.quantity || 0) > 0)
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
    <>
      <section className="expedition-archive-launchers">
        <button type="button" onClick={() => setOpenPanel('vault')}><span>◆</span><div><small>Personal</small><strong>Relic Vault</strong><em>{ownedCount}/{catalogCount} discovered</em></div><b>Open</b></button>
        <button type="button" onClick={() => setOpenPanel('archive')}><span>▤</span><div><small>Family</small><strong>Expedition Archive</strong><em>{history.length} completed runs</em></div><b>Open</b></button>
      </section>

      {openPanel === 'vault' && (
        <ExpeditionOverlay title="Relic Vault" kicker={`${ownedCount}/${catalogCount} discovered`} onClose={() => setOpenPanel(null)}>
          <div className="expedition-vault-inventory">
            {inventory.length ? inventory.map(item => {
              const meta = artifacts.get(item.artifactId);
              return <button type="button" key={item.artifactId} className={`rarity-${meta?.rarity || 'common'}`} onClick={() => setSelectedArtifactId(item.artifactId)}>{artifactImage(item.artifactId) ? <img src={artifactImage(item.artifactId)} alt="" /> : <span>R</span>}<strong>{meta?.name || titleize(item.artifactId)}</strong><small>x{item.quantity ?? 0}</small></button>;
            }) : <div className="expedition-empty">No relics found yet.</div>}
          </div>
        </ExpeditionOverlay>
      )}
      {openPanel === 'archive' && (
        <ExpeditionOverlay title="Expedition Archive" kicker="Family history" onClose={() => { setOpenPanel(null); setSelectedRun(null); }}>
          <div className="expedition-archive-list">
            {history.length ? history.map(entry => <button type="button" key={entry.id} onClick={() => setSelectedRun(entry)}><div><strong>Expedition #{entry.expeditionId}</strong><small>{formatTime(entry.finishedAt)}</small></div><span>{entry.summary?.roomsCleared || 0} rooms</span></button>) : <div className="expedition-empty">No completed expeditions yet.</div>}
          </div>
        </ExpeditionOverlay>
      )}
      {selectedRun && (
        <ExpeditionOverlay title={`Expedition #${selectedRun.expeditionId}`} kicker="Run details" onClose={() => setSelectedRun(null)}>
          <div className="expedition-run-details"><strong>{selectedRun.summary?.roomsCleared || 0} rooms cleared</strong><small>Finished {formatTime(selectedRun.finishedAt)}</small>{(selectedRun.summary?.members || []).slice().sort((a,b) => (b.progress || 0) - (a.progress || 0)).map((row,index) => <div key={row.userId}><span>#{index + 1} {memberNameById.get(row.userId) || 'Hero'}</span><b>+{row.progress || 0} progress</b></div>)}</div>
        </ExpeditionOverlay>
      )}
      {selectedArtifactId && artifacts.get(selectedArtifactId) && <ArtifactDetailSheet artifact={{ ...artifacts.get(selectedArtifactId), image: artifactImage(selectedArtifactId), quantity: inventory.find(item => item.artifactId === selectedArtifactId)?.quantity || 0 }} mode="inspect" onClose={() => setSelectedArtifactId(null)} />}
    </>
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
  const scoutChoiceIdempotencyKeysRef = useRef(new Map());
  const minigameStartIdempotencyKeysRef = useRef(new Map());
  const minigameFinishIdempotencyKeysRef = useRef(new Map());
  const artifactUseIdempotencyKeysRef = useRef(new Map());
  const roleAbilityIdempotencyKeysRef = useRef(new Map());
  const provisionUseIdempotencyKeysRef = useRef(new Map());
  const eventAckIdempotencyKeysRef = useRef(new Map());
  const loadSequenceRef = useRef(0);
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
    const requestId = ++loadSequenceRef.current;
    if (!silent) setLoading(true);
    setError('');
    try {
      const nextState = await api.getExpeditionCurrent();
      if (requestId !== loadSequenceRef.current) return false;
      setState(nextState);
      return true;
    } catch (err) {
      if (requestId === loadSequenceRef.current) {
        setError(err.message || 'Could not load expedition');
      }
      return false;
    } finally {
      if (!silent && requestId === loadSequenceRef.current) setLoading(false);
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
    const root = document.documentElement;
    root.classList.add('expedition-ui-open');
    return () => {
      root.classList.remove('expedition-ui-open');
    };
  }, []);

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
    loadSequenceRef.current += 1;
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
    loadSequenceRef.current += 1;
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
    loadSequenceRef.current += 1;
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
    loadSequenceRef.current += 1;
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
    loadSequenceRef.current += 1;
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
    if (!state?.expedition?.id) return null;
    loadSequenceRef.current += 1;
    setMutating(true);
    setError('');
    try {
      const next = await api.useExpeditionArtifact(
        state.expedition.id,
        roomKey,
        artifactId,
        getPendingMutationKey(artifactUseIdempotencyKeysRef, signature, 'expedition-artifact'),
      );
      setState(next);
      setState(await api.getExpeditionCurrent());
      clearPendingMutationKey(artifactUseIdempotencyKeysRef, signature);
      onExpeditionChange?.();
      return next;
    } catch (err) {
      if (err.status === 400 || err.status === 409) {
        await load({ silent: true });
        return null;
      }
      setError(err.message || 'Could not use artifact');
      return null;
    } finally {
      setMutating(false);
    }
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

  async function handleUseProvision(roomKey) {
    const signature = JSON.stringify({ expeditionId: state?.expedition?.id || null, roomKey, provisionId: state?.member?.provisionId });
    const next = await mutateExpedition(expeditionId => api.useExpeditionProvision(
      expeditionId,
      roomKey,
      getPendingMutationKey(provisionUseIdempotencyKeysRef, signature, 'expedition-provision'),
    ), 'Could not use provision');
    if (next) clearPendingMutationKey(provisionUseIdempotencyKeysRef, signature);
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
            canonicalArtifacts={state?.catalog?.artifacts}
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
            canonicalArtifacts={state?.catalog?.artifacts}
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
            onScoutChoice={handleScoutChoice}
            onMinigameStart={handleMinigameStart}
            onMinigameFinish={handleMinigameFinish}
            onUseArtifact={handleUseArtifact}
            onUseProvision={handleUseProvision}
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
          onScoutChoice={handleScoutChoice}
          onMinigameStart={handleMinigameStart}
          onMinigameFinish={handleMinigameFinish}
          onUseArtifact={handleUseArtifact}
          onUseProvision={handleUseProvision}
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
