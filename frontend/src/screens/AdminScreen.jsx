import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { isAdmin } from '../adminConfig';

const CLOTHING_SLOTS = ['head', 'body', 'hands', 'fren', 'face'];
const ALL_SLOT_TABS  = ['all', 'head', 'body', 'hands', 'fren', 'face', 'gift'];
const HOME_SLOTS = ['wall_base', 'floor_base', 'floor_cover', 'back_decor', 'foreground_item'];
const ALL_HOME_SLOT_TABS = ['all', ...HOME_SLOTS];

function getInitData() {
  if (typeof window !== 'undefined' && window.Telegram?.WebApp?.initData) {
    return window.Telegram.WebApp.initData;
  }

  return 'dev_mode=1&user=%7B%22id%22%3A999999%2C%22first_name%22%3A%22Dev%22%2C%22username%22%3A%22devuser%22%7D&auth_date=9999999999&hash=devhash';
}

async function adminFetch(method, path, body) {
  const opts = { method, headers: { 'X-Telegram-Init-Data': getInitData() } };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const resp = await fetch(`/api/admin${path}`, opts);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `Request failed (HTTP ${resp.status})`);
  return data;
}

function Msg({ msg }) {
  if (!msg) return null;
  return (
    <div style={{
      padding: '8px 12px', borderRadius: 8, fontSize: 13, marginTop: 8,
      background: msg.type === 'error' ? 'var(--danger-light)' : 'var(--accent-light)',
      color: msg.type === 'error' ? 'var(--danger)' : 'var(--accent)',
    }}>
      {msg.text}
    </div>
  );
}

function ItemSprite({ itemId, size = 48 }) {
  const [err, setErr] = useState(false);
  if (!err) {
    return (
      <img src={`/sprites/${itemId}.png?v=${Date.now()}`} alt="" onError={() => setErr(true)}
        style={{ width: size, height: size, objectFit: 'contain', borderRadius: 6, background: 'var(--bg-secondary)' }} />
    );
  }
  return (
    <div style={{ width: size, height: size, borderRadius: 6, background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-hint)' }}>
      no sprite
    </div>
  );
}

function GiftSprite({ itemId, filePath, size = 48, cacheBust }) {
  const [err, setErr] = useState(false);

  // When filePath or cacheBust changes (after upload), reset error so img retries
  const prevKey = (filePath || '') + (cacheBust || '');
  const keyRef  = React.useRef(prevKey);
  if (keyRef.current !== prevKey) { keyRef.current = prevKey; if (err) setErr(false); }

  // No file uploaded yet and no cache bust — show placeholder
  if (!filePath && !cacheBust) {
    return (
      <div style={{ width: size, height: size, borderRadius: 6, background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
        🎁
      </div>
    );
  }

  // Add ?t= to bust browser cache after upload
  const base = filePath || `/gifts/${itemId}.webp`; // file_path from DB has correct ext
  const src  = cacheBust ? `${base}?t=${cacheBust}` : base;

  if (!err) {
    return (
      <img src={src} alt="" onError={() => setErr(true)}
        style={{ width: size, height: size, objectFit: 'contain', borderRadius: 6, background: 'var(--bg-secondary)' }} />
    );
  }
  return (
    <div style={{ width: size, height: size, borderRadius: 6, background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
      🎁
    </div>
  );
}

function HomeDecorPreview({ filePath, size = 64, cacheBust }) {
  const [err, setErr] = useState(false);
  const key = (filePath || '') + (cacheBust || '');
  const keyRef = React.useRef(key);
  if (keyRef.current !== key) {
    keyRef.current = key;
    if (err) setErr(false);
  }

  if (!filePath || err) {
    return (
      <div style={{
        width: size,
        height: Math.round((size * 840) / 600),
        borderRadius: 10,
        background: 'linear-gradient(180deg, #f4efe5 0%, #eadfce 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        color: 'var(--text-hint)',
        textAlign: 'center',
        padding: 6,
      }}>
        no decor
      </div>
    );
  }

  const src = cacheBust ? `${filePath}?t=${cacheBust}` : filePath;
  return (
    <img
      src={src}
      alt=""
      onError={() => setErr(true)}
      style={{
        width: size,
        height: Math.round((size * 840) / 600),
        objectFit: 'cover',
        borderRadius: 10,
        background: 'var(--bg-secondary)',
      }}
    />
  );
}

function formatHomeSlot(slot) {
  return slot
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

const selectStyle = {
  flex: 1, padding: '10px 12px', border: '1.5px solid var(--border)',
  borderRadius: 'var(--radius-md)', background: 'var(--bg-card)',
  color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', fontSize: 14, outline: 'none',
};

// ── Add Clothing Item form ────────────────────────────────────────────────────
function AddItemForm({ onCreated }) {
  const [name,    setName]    = useState('');
  const [slot,    setSlot]    = useState('head');
  const [price,   setPrice]   = useState('100');
  const [isFree,  setIsFree]  = useState(false);
  const [file,    setFile]    = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [msg,     setMsg]     = useState(null);

  async function handleSubmit() {
    if (!name.trim()) return setMsg({ type: 'error', text: 'Name is required' });
    setSaving(true); setMsg(null);
    try {
      if (slot === 'gift') {
        // Create gift catalog entry
        const res = await adminFetch('POST', '/gift-items', {
          name: name.trim(), price: parseInt(price) || 50,
        });
        const itemId = res.item.item_id;
        if (file) {
          const fd = new FormData();
          fd.append('itemId', itemId);
          fd.append('file', file);
          await adminFetch('POST', '/gift-items/upload', fd);
        }
        setMsg({ type: 'success', text: `Gift "${name}" created! ID: ${itemId}` });
      } else {
        // Create clothing item
        const res = await adminFetch('POST', '/items', {
          name: name.trim(), slot, price: parseInt(price) || 0, is_free: isFree,
        });
        const itemId = res.item.item_id;
        if (file) {
          const fd = new FormData();
          fd.append('itemId', itemId);
          fd.append('file', file);
          await adminFetch('POST', '/sprites/upload', fd);
        }
        setMsg({ type: 'success', text: `"${name}" created! ID: ${itemId}` });
      }
      setName(''); setPrice('100'); setFile(null); setIsFree(false);
      onCreated();
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    } finally { setSaving(false); }
  }

  return (
    <div className="card" style={{ margin: '0 16px 16px' }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Add New Item</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          className="search-input"
          placeholder="Item name (e.g. Cool Hat)"
          value={name}
          onChange={e => setName(e.target.value)}
        />

        <div style={{ display: 'flex', gap: 8 }}>
          <select value={slot} onChange={e => setSlot(e.target.value)} style={selectStyle}>
            {CLOTHING_SLOTS.map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
            <option value="gift">Gift 🎁</option>
          </select>

          <input
            type="number"
            className="search-input"
            placeholder="Price (✦)"
            value={price}
            onChange={e => setPrice(e.target.value)}
            disabled={isFree}
            style={{ flex: 1 }}
          />
        </div>

        {slot !== 'gift' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={isFree} onChange={e => setIsFree(e.target.checked)} />
            Free item (given to all players automatically)
          </label>
        )}

        {slot === 'gift' ? (
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-hint)', marginBottom: 4 }}>
              WebP / PNG / GIF (up to 512×512, optional — upload later)
            </div>
            <input
              type="file" accept="image/webp,image/png,image/gif"
              onChange={e => setFile(e.target.files[0] || null)}
              style={{ fontSize: 13, color: 'var(--text-secondary)' }}
            />
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-hint)', marginBottom: 4 }}>Sprite PNG (500×500, optional — upload later)</div>
            <input
              type="file" accept="image/png"
              onChange={e => setFile(e.target.files[0] || null)}
              style={{ fontSize: 13, color: 'var(--text-secondary)' }}
            />
          </div>
        )}

        <button
          className="btn btn-primary btn-full"
          onClick={handleSubmit}
          disabled={saving || !name.trim()}
        >
          {saving ? 'Creating…' : slot === 'gift' ? '+ Add Gift' : '+ Add Item'}
        </button>
      </div>
      <Msg msg={msg} />
    </div>
  );
}

// ── Clothing Item Row ─────────────────────────────────────────────────────────
function ItemRow({ item, onDeleted, onSpriteUploaded }) {
  const [editing,   setEditing]   = useState(false);
  const [name,      setName]      = useState(item.name);
  const [price,     setPrice]     = useState(String(item.price));
  const [isFree,    setIsFree]    = useState(Boolean(item.is_free));
  const [file,      setFile]      = useState(null);
  const [saving,    setSaving]    = useState(false);
  const [msg,       setMsg]       = useState(null);

  async function handleSave() {
    setSaving(true); setMsg(null);
    try {
      await adminFetch('PATCH', `/items/${item.item_id}`, { name, price: parseInt(price) || item.price, is_free: isFree });
      if (file) {
        const fd = new FormData();
        fd.append('itemId', item.item_id);
        fd.append('file', file);
        await adminFetch('POST', '/sprites/upload', fd);
        onSpriteUploaded();
      }
      setMsg({ type: 'success', text: 'Saved!' });
      setEditing(false);
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${item.name}"? This removes it from all wardrobes.`)) return;
    try {
      await adminFetch('DELETE', `/items/${item.item_id}`);
      onDeleted(item.item_id);
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
  }

  return (
    <div className="card" style={{ margin: '0 16px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <ItemSprite itemId={item.item_id} size={52} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <input className="search-input" value={name} onChange={e => setName(e.target.value)} style={{ marginBottom: 4 }} />
          ) : (
            <div style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-hint)' }}>
            {item.slot} · {item.item_id}
            {item.is_free ? ' · Free' : ` · ✦ ${item.price}`}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button className="btn btn-secondary" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => setEditing(e => !e)}>
            {editing ? 'Cancel' : 'Edit'}
          </button>
          <button
            className="btn"
            style={{ padding: '5px 10px', fontSize: 12, background: 'var(--danger-light)', color: 'var(--danger)', border: 'none' }}
            onClick={handleDelete}
          >
            Delete
          </button>
        </div>
      </div>

      {editing && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            type="number"
            className="search-input"
            placeholder="Price"
            value={price}
            disabled={isFree}
            onChange={e => setPrice(e.target.value)}
            style={{ flex: 1, opacity: isFree ? 0.5 : 1 }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={isFree} onChange={e => setIsFree(e.target.checked)} />
            Free item
          </label>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-hint)', marginBottom: 4 }}>Replace sprite PNG (500×500)</div>
            <input type="file" accept="image/png" onChange={e => setFile(e.target.files[0] || null)}
              style={{ fontSize: 13, color: 'var(--text-secondary)' }} />
          </div>
          <button className="btn btn-primary btn-full" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      )}
      <Msg msg={msg} />
    </div>
  );
}

// ── Gift Item Row ─────────────────────────────────────────────────────────────
function GiftRow({ gift, onDeleted, onRefresh }) {
  const [editing,   setEditing]   = useState(false);
  const [name,      setName]      = useState(gift.name);
  const [price,     setPrice]     = useState(String(gift.price));
  const [file,      setFile]      = useState(null);
  const [saving,    setSaving]    = useState(false);
  const [msg,       setMsg]       = useState(null);
  const [cacheBust, setCacheBust] = useState(null);

  async function handleSave() {
    setSaving(true); setMsg(null);
    try {
      await adminFetch('PATCH', `/gift-items/${gift.item_id}`, { name, price: parseInt(price) || gift.price });
      if (file) {
        const fd = new FormData();
        fd.append('itemId', gift.item_id);
        fd.append('file', file);
        await adminFetch('POST', '/gift-items/upload', fd);
        // Force image reload by busting browser cache
        setCacheBust(Date.now());
      }
      setMsg({ type: 'success', text: 'Saved!' });
      setEditing(false);
      setFile(null);
      onRefresh();
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!confirm(`Delete gift "${gift.name}"?`)) return;
    try {
      await adminFetch('DELETE', `/gift-items/${gift.item_id}`);
      onDeleted(gift.item_id);
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
  }

  return (
    <div className="card" style={{ margin: '0 16px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <GiftSprite itemId={gift.item_id} filePath={gift.file_path} size={52} cacheBust={cacheBust} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <input className="search-input" value={name} onChange={e => setName(e.target.value)} style={{ marginBottom: 4 }} />
          ) : (
            <div style={{ fontWeight: 600, fontSize: 14 }}>{gift.name}</div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-hint)' }}>
            gift · {gift.item_id} · ✦ {gift.price}
            {gift.file_path ? ' · WebP ✓' : ' · no image'}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button className="btn btn-secondary" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => setEditing(e => !e)}>
            {editing ? 'Cancel' : 'Edit'}
          </button>
          <button
            className="btn"
            style={{ padding: '5px 10px', fontSize: 12, background: 'var(--danger-light)', color: 'var(--danger)', border: 'none' }}
            onClick={handleDelete}
          >
            Delete
          </button>
        </div>
      </div>

      {editing && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="number"
              className="search-input"
              placeholder="Price (✦)"
              value={price}
              onChange={e => setPrice(e.target.value)}
              style={{ flex: 1 }}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-hint)', marginBottom: 4 }}>
              Replace animated WebP (512×512)
            </div>
            <input type="file" accept=".webp,image/webp" onChange={e => setFile(e.target.files[0] || null)}
              style={{ fontSize: 13, color: 'var(--text-secondary)' }} />
          </div>
          <button className="btn btn-primary btn-full" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      )}
      <Msg msg={msg} />
    </div>
  );
}

// ── Main admin screen ──────────────────────────────────────────────────────
function AddHomeItemForm({ onCreated }) {
  const [name, setName] = useState('');
  const [slot, setSlot] = useState('wall_base');
  const [price, setPrice] = useState('100');
  const [isFree, setIsFree] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  async function handleSubmit() {
    if (!name.trim()) return setMsg({ type: 'error', text: 'Name is required' });
    setSaving(true);
    setMsg(null);
    try {
      const res = await adminFetch('POST', '/home-items', {
        name: name.trim(),
        slot,
        price: parseInt(price, 10) || 0,
        is_free: isFree,
        is_active: isActive,
      });

      if (file) {
        const fd = new FormData();
        fd.append('itemId', res.item.item_id);
        fd.append('file', file);
        await adminFetch('POST', '/home-items/upload', fd);
      }

      setMsg({ type: 'success', text: `Home decor "${name}" created!` });
      setName('');
      setPrice('100');
      setSlot('wall_base');
      setFile(null);
      setIsFree(false);
      setIsActive(true);
      onCreated();
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ margin: '0 16px 16px' }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Add Home Decor</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          className="search-input"
          placeholder="Decor name (e.g. Cozy Bed)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div style={{ display: 'flex', gap: 8 }}>
          <select value={slot} onChange={(e) => setSlot(e.target.value)} style={selectStyle}>
            {HOME_SLOTS.map((homeSlot) => (
              <option key={homeSlot} value={homeSlot}>{formatHomeSlot(homeSlot)}</option>
            ))}
          </select>

          <input
            type="number"
            className="search-input"
            placeholder="Price (✦)"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            disabled={isFree}
            style={{ flex: 1, opacity: isFree ? 0.55 : 1 }}
          />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={isFree} onChange={(e) => setIsFree(e.target.checked)} />
          Free decor item
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Visible in decor shop
        </label>

        <div>
          <div style={{ fontSize: 12, color: 'var(--text-hint)', marginBottom: 4 }}>
            Home PNG or GIF exactly 600x840 (optional now, upload later if needed)
          </div>
          <input
            type="file"
            accept="image/png,image/gif"
            onChange={(e) => setFile(e.target.files[0] || null)}
            style={{ fontSize: 13, color: 'var(--text-secondary)' }}
          />
        </div>

        <button className="btn btn-primary btn-full" onClick={handleSubmit} disabled={saving || !name.trim()}>
          {saving ? 'Creating...' : '+ Add Home Decor'}
        </button>
      </div>

      <Msg msg={msg} />
    </div>
  );
}

function HomeItemRow({ item, onDeleted, onRefresh }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(String(item.price));
  const [isFree, setIsFree] = useState(Boolean(item.is_free));
  const [isActive, setIsActive] = useState(Boolean(item.is_active));
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [cacheBust, setCacheBust] = useState(null);

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      await adminFetch('PATCH', `/home-items/${item.item_id}`, {
        name,
        price: parseInt(price, 10) || 0,
        is_free: isFree,
        is_active: isActive,
      });

      if (file) {
        const fd = new FormData();
        fd.append('itemId', item.item_id);
        fd.append('file', file);
        await adminFetch('POST', '/home-items/upload', fd);
        setCacheBust(Date.now());
      }

      setEditing(false);
      setFile(null);
      setMsg({ type: 'success', text: 'Saved!' });
      onRefresh();
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete home decor "${item.name}"?`)) return;
    try {
      await adminFetch('DELETE', `/home-items/${item.item_id}`);
      onDeleted(item.item_id);
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    }
  }

  return (
    <div className="card" style={{ margin: '0 16px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <HomeDecorPreview filePath={item.file_path} size={56} cacheBust={cacheBust} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <input className="search-input" value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 4 }} />
          ) : (
            <div style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-hint)' }}>
            {formatHomeSlot(item.slot)} · {item.item_id}
            {item.is_free ? ' · Free' : ` · ✦ ${item.price}`}
            {item.is_active ? ' · Active' : ' · Hidden'}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button className="btn btn-secondary" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => setEditing((value) => !value)}>
            {editing ? 'Cancel' : 'Edit'}
          </button>
          <button
            className="btn"
            style={{ padding: '5px 10px', fontSize: 12, background: 'var(--danger-light)', color: 'var(--danger)', border: 'none' }}
            onClick={handleDelete}
          >
            Delete
          </button>
        </div>
      </div>

      {editing && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            type="number"
            className="search-input"
            placeholder="Price"
            value={price}
            disabled={isFree}
            onChange={(e) => setPrice(e.target.value)}
            style={{ opacity: isFree ? 0.55 : 1 }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={isFree} onChange={(e) => setIsFree(e.target.checked)} />
            Free decor
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Visible in shop
          </label>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-hint)', marginBottom: 4 }}>Replace home PNG or GIF (exactly 600x840)</div>
            <input
              type="file"
              accept="image/png,image/gif"
              onChange={(e) => setFile(e.target.files[0] || null)}
              style={{ fontSize: 13, color: 'var(--text-secondary)' }}
            />
          </div>
          <button className="btn btn-primary btn-full" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}
      <Msg msg={msg} />
    </div>
  );
}

function StatsPanel() {
  const [stats, setStats]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminFetch('GET', '/stats')
      .then(d => setStats(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const CARDS = stats ? [
    { emoji: '👥', label: 'Active users (24h)',    value: stats.dau },
    { emoji: '🎁', label: 'Gifts sent (24h)',       value: stats.gifts24h },
    { emoji: '💚', label: 'Alive Peepers',          value: stats.alivePeepers },
    { emoji: '🐸', label: 'Total Peepers ever',     value: stats.totalPeepers },
  ] : [];

  if (loading) return (
    <div style={{ textAlign:'center', padding:'48px 0', color:'var(--text-hint)' }}>
      Loading stats…
    </div>
  );

  return (
    <div style={{ padding:'16px 16px 32px' }}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        {CARDS.map(c => (
          <div key={c.label} style={{
            background:'var(--bg-secondary)', borderRadius:16,
            padding:'20px 16px', textAlign:'center',
          }}>
            <div style={{ fontSize:36, marginBottom:6 }}>{c.emoji}</div>
            <div style={{ fontSize:32, fontWeight:900, color:'var(--accent)' }}>{c.value}</div>
            <div style={{ fontSize:12, color:'var(--text-hint)', marginTop:4, lineHeight:1.3 }}>{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminScreen() {
  const { user, assetVersion, applyAssetVersion } = useApp();
  const [adminSection, setAdminSection] = useState('items'); // 'items' | 'home' | 'stats'
  const [items,      setItems]      = useState([]);
  const [giftItems,  setGiftItems]  = useState([]);
  const [homeItems,  setHomeItems]  = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [activeSlot, setActiveSlot] = useState('all');
  const [activeHomeSlot, setActiveHomeSlot] = useState('all');
  const [bustingAssetCache, setBustingAssetCache] = useState(false);
  const [cacheMsg, setCacheMsg] = useState(null);

  if (!isAdmin(user)) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 24px', color: 'var(--text-hint)' }}>
        <div style={{ fontSize: 48 }}>🔒</div>
        <div style={{ marginTop: 12 }}>Admin access only</div>
      </div>
    );
  }

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const [shopData, giftData, homeData, cacheData] = await Promise.all([
        adminFetch('GET', '/items'),
        adminFetch('GET', '/gift-items'),
        adminFetch('GET', '/home-items'),
        adminFetch('GET', '/cache-settings').catch(() => ({ assetVersion })),
      ]);
      setItems(shopData.items || []);
      setGiftItems(giftData.items || []);
      setHomeItems(homeData.items || []);
      applyAssetVersion(cacheData.assetVersion);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [applyAssetVersion, assetVersion]);

  useEffect(() => { loadItems(); }, [loadItems]);

  async function handleBustAssetCache() {
    if (!confirm('Force clients to redownload updated sprites and home art on next sync?')) return;
    setBustingAssetCache(true);
    setCacheMsg(null);
    try {
      const result = await adminFetch('POST', '/cache/bust-assets');
      applyAssetVersion(result.assetVersion);
      setCacheMsg({ type: 'success', text: result.message || 'Asset cache updated.' });
    } catch (e) {
      setCacheMsg({ type: 'error', text: e.message || 'Could not update asset cache.' });
    } finally {
      setBustingAssetCache(false);
    }
  }

  const totalCount = items.length + giftItems.length;
  const totalHomeCount = homeItems.length;

  // What to show based on active tab
  const showGifts    = activeSlot === 'gift';
  const displayItems = activeSlot === 'all'
    ? items
    : activeSlot === 'gift'
      ? []
      : items.filter(i => i.slot === activeSlot);
  const displayHomeItems = activeHomeSlot === 'all'
    ? homeItems
    : homeItems.filter((item) => item.slot === activeHomeSlot);

  return (
    <div style={{ paddingBottom: 24 }}>
      <div className="page-header">Admin Panel 🛠️</div>

      {/* Main tabs */}
      <div style={{ display:'flex', gap:8, padding:'0 16px 12px' }}>
        {[['items','🛍️ Items'],['stats','📊 Stats']].map(([id,label]) => (
          <button key={id}
            className={`inner-tab${adminSection === id ? ' active' : ''}`}
            style={{ flex:1 }}
            onClick={() => setAdminSection(id)}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '0 16px 12px' }}>
        <button
          className={`inner-tab${adminSection === 'home' ? ' active' : ''}`}
          style={{ flex: 1 }}
          onClick={() => setAdminSection('home')}
        >
          🏠 Home Decor
        </button>
      </div>

      <div className="card" style={{ margin: '0 16px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Asset Cache</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
              Immutable sprite and home art URLs use this version. Bump it to force clients to redownload updated PNG files.
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 6, wordBreak: 'break-all' }}>
              Current version: {assetVersion}
            </div>
          </div>
          <button
            className="btn btn-primary"
            style={{ padding: '8px 12px', fontSize: 12, flexShrink: 0 }}
            onClick={handleBustAssetCache}
            disabled={bustingAssetCache}
          >
            {bustingAssetCache ? 'Updating...' : 'Reset Cache'}
          </button>
        </div>
        <Msg msg={cacheMsg} />
      </div>

      {adminSection === 'stats' && <StatsPanel />}

      {adminSection === 'items' && (
        <>
          <AddItemForm onCreated={loadItems} />

          <div className="section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 16 }}>
            <span>Items ({totalCount})</span>
            <button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={loadItems}>↻</button>
          </div>

          <div className="inner-tabs" style={{ marginBottom: 8 }}>
            {ALL_SLOT_TABS.map(s => (
              <button
                key={s}
                className={`inner-tab${activeSlot === s ? ' active' : ''}`}
                onClick={() => setActiveSlot(s)}
              >
                {s === 'gift' ? '🎁 Gift' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          {loading && (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-hint)', fontSize: 13 }}>Loading…</div>
          )}

          {!loading && !showGifts && (
            <>
              {displayItems.length === 0 && (
                <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-hint)', fontSize: 13 }}>
                  No items yet — add one above!
                </div>
              )}
              {displayItems.map(item => (
                <ItemRow
                  key={item.item_id}
                  item={item}
                  onDeleted={id => setItems(prev => prev.filter(i => i.item_id !== id))}
                  onSpriteUploaded={loadItems}
                />
              ))}
            </>
          )}

          {!loading && showGifts && (
            <>
              {giftItems.length === 0 && (
                <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-hint)', fontSize: 13 }}>
                  No gifts yet — add one above by selecting "Gift" slot!
                </div>
              )}
              {giftItems.map(gift => (
                <GiftRow
                  key={gift.item_id}
                  gift={gift}
                  onDeleted={id => setGiftItems(prev => prev.filter(g => g.item_id !== id))}
                  onRefresh={loadItems}
                />
              ))}
            </>
          )}
        </>
      )}

      {adminSection === 'home' && (
        <>
          <AddHomeItemForm onCreated={loadItems} />

          <div className="section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 16 }}>
            <span>Home Decor ({totalHomeCount})</span>
            <button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={loadItems}>↻</button>
          </div>

          <div className="inner-tabs" style={{ marginBottom: 8 }}>
            {ALL_HOME_SLOT_TABS.map((slot) => (
              <button
                key={slot}
                className={`inner-tab${activeHomeSlot === slot ? ' active' : ''}`}
                onClick={() => setActiveHomeSlot(slot)}
              >
                {slot === 'all' ? 'All' : formatHomeSlot(slot)}
              </button>
            ))}
          </div>

          {loading && (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-hint)', fontSize: 13 }}>Loading...</div>
          )}

          {!loading && displayHomeItems.length === 0 && (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-hint)', fontSize: 13 }}>
              No home decor yet — add one above.
            </div>
          )}

          {!loading && displayHomeItems.map((item) => (
            <HomeItemRow
              key={item.item_id}
              item={item}
              onDeleted={(itemId) => setHomeItems((prev) => prev.filter((entry) => entry.item_id !== itemId))}
              onRefresh={loadItems}
            />
          ))}
        </>
      )}
    </div>
  );
}
