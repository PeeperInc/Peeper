import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

function ExpeditionDashboard({ state }) {
  const { artifacts, provisions } = useCatalogMaps();
  const memberNameById = useMemo(() => new Map(
    (state.familyMembers || []).map(member => [member.userId, member.firstName || member.username || 'Family']),
  ), [state.familyMembers]);
  const rooms = state.map?.rooms || [];
  const roomCounts = rooms.reduce((counts, room) => {
    counts.total += 1;
    counts[room.state || 'unknown'] = (counts[room.state || 'unknown'] || 0) + 1;
    return counts;
  }, { total: 0 });
  const member = state.member;
  const loadout = (member?.loadout || []).filter(Boolean);
  const provision = member?.provisionId ? provisions.get(member.provisionId) : null;

  return (
    <div className="expedition-dashboard">
      <div className="expedition-card expedition-status-card">
        <div>
          <div className="expedition-kicker">Active Expedition</div>
          <h2>{titleize(state.expedition?.status || 'running')}</h2>
        </div>
        <div className="expedition-ap-chip">{member?.ap ?? 0} AP</div>
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
          {loadout.length > 0 ? loadout.map(id => {
            const meta = artifacts.get(id);
            return <span key={id}>{meta?.name || titleize(id)}</span>;
          }) : <span>No artifacts equipped</span>}
        </div>
      </div>

      <div className="expedition-card expedition-map-placeholder">
        <div>
          <div className="expedition-kicker">Dungeon Map</div>
          <strong>Map opens in next build</strong>
          <p>
            {roomCounts.total > 0
              ? `${roomCounts.total} rooms / ${roomCounts.unlocked || 0} unlocked / ${roomCounts.cleared || 0} cleared`
              : 'No rooms have been revealed yet.'}
          </p>
        </div>
      </div>

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

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setState(await api.getExpeditionCurrent());
    } catch (err) {
      setError(err.message || 'Could not load expedition');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleStart() {
    setMutating(true);
    setError('');
    try {
      setState(await api.startExpedition(makeIdempotencyKey('expedition-start')));
      await load();
    } catch (err) {
      setError(err.message || 'Could not start expedition');
    } finally {
      setMutating(false);
    }
  }

  async function handlePrepare(payload) {
    if (!state?.expedition?.id) return;
    setMutating(true);
    setError('');
    try {
      setState(await api.prepareExpedition(state.expedition.id, {
        ...payload,
        idempotencyKey: makeIdempotencyKey('expedition-prepare'),
      }));
      await load();
    } catch (err) {
      setError(err.message || 'Could not prepare expedition');
    } finally {
      setMutating(false);
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

      {!hasExpedition && (
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
          <ExpeditionDashboard state={state} />
        </div>
      )}

      {isPrepared && <ExpeditionDashboard state={state} />}
    </div>
  );
}
