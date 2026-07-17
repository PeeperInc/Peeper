import React, { useEffect, useMemo, useState } from 'react';
import BottomSheet from '../BottomSheet';
import './ExpeditionSheets.css';

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => (
    typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  ));

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  return reduced;
}

function resolveRewardArtifact(entry, resolver) {
  const artifactId = entry?.artifactId || entry?.artifact_id || entry?.id;
  const resolved = resolver?.(artifactId, entry) || entry?.artifact || {};
  return {
    ...entry,
    ...resolved,
    artifactId,
    name: resolved.name || entry?.name || artifactId || 'Unknown artifact',
    rarity: resolved.rarity || entry?.rarity || 'common',
    image: resolved.image || resolved.imageUrl || entry?.image || entry?.imageUrl,
  };
}

export default function RewardClaimSheet({
  reward,
  resolveArtifact,
  claiming = false,
  claimed = false,
  error = null,
  onClaim,
  onClose,
}) {
  const reducedMotion = useReducedMotion();
  const payload = reward?.payload || reward || {};
  const rewardId = reward?.id ?? payload.id ?? 'reward';
  const artifactEntries = Array.isArray(payload.artifacts) ? payload.artifacts : [];
  const cosmetic = payload.cosmetic || null;
  const artifacts = useMemo(
    () => artifactEntries.map(entry => resolveRewardArtifact(entry, resolveArtifact)),
    [artifactEntries, resolveArtifact],
  );
  const [revealedCount, setRevealedCount] = useState(reducedMotion ? artifacts.length : 0);

  useEffect(() => {
    setRevealedCount(reducedMotion ? artifacts.length : 0);
  }, [rewardId, artifacts.length, reducedMotion]);

  useEffect(() => {
    if (reducedMotion || revealedCount >= artifacts.length) return undefined;
    const timer = window.setTimeout(() => {
      setRevealedCount(count => Math.min(count + 1, artifacts.length));
    }, revealedCount === 0 ? 260 : 440);
    return () => window.clearTimeout(timer);
  }, [artifacts.length, reducedMotion, revealedCount]);

  if (!reward) return null;

  const allRevealed = revealedCount >= artifacts.length;
  const completedAt = payload.completedAt
    ? new Date(Number(payload.completedAt) * (Number(payload.completedAt) < 1_000_000_000_000 ? 1000 : 1))
      .toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
    : null;

  return (
    <BottomSheet
      onClose={claiming ? undefined : onClose}
      closeOnBackdrop={!claiming}
      bodyClassName="sheet-body expedition-sheet-body"
      backdropClassName="sheet-backdrop expedition-sheet-backdrop"
    >
      <section className={`expedition-reward-sheet${claimed ? ' is-claimed' : ''}`}>
        <header className="expedition-sheet-header">
          <div>
            <span className="expedition-sheet-eyebrow">Expedition complete</span>
            <h2>{payload.expeditionTitle || 'Recovered spoils'}</h2>
          </div>
          <button
            className="expedition-sheet-close"
            type="button"
            onClick={onClose}
            disabled={claiming}
            aria-label="Close"
          >
            X
          </button>
        </header>

        <div className="expedition-reward-status">
          <div className="expedition-reward-sigil" aria-hidden="true">*</div>
          <div>
            <span>{claimed ? 'Claim secured' : 'Personal reward cache'}</span>
            <strong>{payload.totalCoins ?? 0} coins</strong>
            {completedAt ? <small>Completed {completedAt}</small> : null}
          </div>
        </div>

        <div className="expedition-reward-ledger" aria-label="Reward breakdown">
          <div>
            <span>Contribution</span>
            <strong>{payload.contributionAp ?? 0} AP</strong>
          </div>
          <div>
            <span>Rooms</span>
            <strong>+{payload.roomCoins ?? 0}</strong>
          </div>
          <div>
            <span>Final cache</span>
            <strong>+{payload.finalCoins ?? 0}</strong>
          </div>
          <div className="is-total">
            <span>Total</span>
            <strong>{payload.totalCoins ?? 0}</strong>
          </div>
        </div>

        <div className="expedition-reward-artifacts">
          <div className="expedition-reward-section-title">
            <span>Recovered artifacts</span>
            <small>{artifacts.length}</small>
          </div>
          {artifacts.length ? (
            <div className="expedition-reward-artifact-list" aria-live="polite">
              {artifacts.map((artifact, index) => {
                const visible = index < revealedCount;
                const rarity = String(artifact.rarity || 'common').toLowerCase();
                return (
                  <article
                    className={`expedition-reward-artifact rarity-${rarity}${visible ? ' is-revealed' : ''}`}
                    key={`${artifact.artifactId || artifact.name}-${index}`}
                    aria-hidden={!visible}
                  >
                    <div className="expedition-reward-artifact-image" aria-hidden="true">
                      {artifact.image ? <img src={artifact.image} alt="" /> : <span>R</span>}
                    </div>
                    <div>
                      <strong>{artifact.name}</strong>
                      <span>{rarity}</span>
                    </div>
                    {artifact.duplicate ? (
                      <small>Duplicate / +{artifact.coins ?? 0} coins</small>
                    ) : (
                      <small>Added to vault</small>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="expedition-reward-empty">No artifacts recovered this time.</p>
          )}
        </div>

        {cosmetic ? (
          <div className="expedition-reward-cosmetic">
            <div className="expedition-reward-section-title">
              <span>Rare find</span>
              <small>30%</small>
            </div>
            <article>
              <div aria-hidden="true">
                {cosmetic.imageUrl ? <img src={cosmetic.imageUrl} alt="" /> : <span>+</span>}
              </div>
              <div>
                <strong>{cosmetic.name}</strong>
                <span>{cosmetic.kind === 'home_decor' ? 'Home decor' : 'Peeper outfit'}</span>
              </div>
              <small>New item</small>
            </article>
          </div>
        ) : null}

        {error ? <p className="expedition-sheet-error" role="alert">{error}</p> : null}

        <div className="expedition-sheet-actions">
          {claimed ? (
            <button className="expedition-sheet-primary" type="button" onClick={onClose}>
              Close
            </button>
          ) : (
            <button
              className="expedition-sheet-primary"
              type="button"
              disabled={claiming || !allRevealed}
              onClick={() => onClaim?.(reward)}
            >
              {claiming ? 'Securing reward...' : allRevealed ? `Claim ${payload.totalCoins ?? 0} coins` : 'Revealing artifacts...'}
            </button>
          )}
        </div>
      </section>
    </BottomSheet>
  );
}
