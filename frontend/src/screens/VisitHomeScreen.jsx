import React, { useEffect, useState, useCallback } from 'react';
import * as api from '../api';
import VisitHomeScene from '../components/VisitHomeScene';
import { useApp } from '../context/AppContext';

export default function VisitHomeScreen({ userId, onBack }) {
  const { peeper, showToast, applyAssetVersion } = useApp();
  const [visitState, setVisitState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sendingPhoto, setSendingPhoto] = useState(false);

  const loadVisitHome = useCallback(async () => {
    if (!userId) return;

    setLoading(true);
    setError(null);
    try {
      const data = await api.getVisitHome(userId);
      setVisitState(data);
      if (data?.assetVersion) {
        applyAssetVersion(data.assetVersion);
      }
    } catch (err) {
      setError(err.message || 'Could not open this home');
    } finally {
      setLoading(false);
    }
  }, [applyAssetVersion, userId]);

  useEffect(() => {
    loadVisitHome();
  }, [loadVisitHome]);

  async function handleTakePhoto() {
    if (!userId || sendingPhoto) return;

    setSendingPhoto(true);
    try {
      const data = await api.sendVisitHomePhoto(userId);
      if (data?.assetVersion) {
        applyAssetVersion(data.assetVersion);
      }
      showToast(data.message || 'Photo sent to your bot chat!');
    } catch (err) {
      showToast(err.message || 'Could not send photo');
    } finally {
      setSendingPhoto(false);
    }
  }

  return (
    <div className="personal-home-shell personal-home-shell-immersive visit-home-shell">
      <div className="personal-home-topbar visit-home-topbar">
        <button className="btn btn-ghost personal-home-back app-back-button" onClick={onBack}>
          Back
        </button>
      </div>

      <div className="personal-home-stage visit-home-stage">
        {loading && (
          <div className="personal-home-overlay-card">
            <div style={{ fontSize: 15, fontWeight: 700 }}>Loading home…</div>
          </div>
        )}

        {!loading && error && (
          <div className="personal-home-overlay-card">
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--danger)' }}>{error}</div>
            <button
              className="btn btn-secondary"
              style={{ marginTop: 14 }}
              onClick={loadVisitHome}
            >
              Try Again
            </button>
          </div>
        )}

        {!loading && !error && visitState?.home && (
          <VisitHomeScene
            home={visitState.home}
            viewerPeeper={peeper}
            ownerPeeper={visitState.ownerPeeper}
          />
        )}
      </div>

      {!loading && !error && visitState?.home && (
        <div className="personal-home-actions visit-home-actions">
          <button
            className="btn btn-primary personal-home-action-btn visit-home-photo-btn"
            onClick={handleTakePhoto}
            disabled={sendingPhoto}
          >
            {sendingPhoto ? 'Sending…' : '📸 Take Photo'}
          </button>
        </div>
      )}
    </div>
  );
}
