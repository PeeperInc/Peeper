const IDEMPOTENCY_RETENTION_SECONDS = 24 * 60 * 60;
const IDEMPOTENCY_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

function pruneExpeditionMinigameIdempotency(
  db,
  {
    nowSeconds = Math.floor(Date.now() / 1000),
    retentionSeconds = IDEMPOTENCY_RETENTION_SECONDS,
  } = {},
) {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('A SQLite database connection is required');
  }
  if (!Number.isInteger(nowSeconds) || !Number.isInteger(retentionSeconds) || retentionSeconds <= 0) {
    throw new TypeError('Retention timestamps must be positive integer seconds');
  }

  const cutoff = nowSeconds - retentionSeconds;
  const result = db.prepare(`
    DELETE FROM family_expedition_minigame_idempotency
    WHERE updated_at < ?
  `).run(cutoff);

  return { deletedRows: result.changes, cutoff };
}

function startExpeditionIdempotencyRetention(
  db,
  {
    now = () => Math.floor(Date.now() / 1000),
    logger = console,
    setIntervalFn = setInterval,
    cleanupIntervalMs = IDEMPOTENCY_CLEANUP_INTERVAL_MS,
  } = {},
) {
  const runCleanup = () => {
    try {
      const result = pruneExpeditionMinigameIdempotency(db, { nowSeconds: now() });
      logger.info?.(
        `[expeditions] idempotency cleanup deleted ${result.deletedRows} row(s) older than ${IDEMPOTENCY_RETENTION_SECONDS} seconds`,
      );
      return result;
    } catch (error) {
      logger.error?.('[expeditions] idempotency cleanup failed:', error);
      return null;
    }
  };

  runCleanup();
  const timer = setIntervalFn(runCleanup, cleanupIntervalMs);
  timer.unref?.();

  return { timer, runCleanup };
}

module.exports = {
  IDEMPOTENCY_RETENTION_SECONDS,
  IDEMPOTENCY_CLEANUP_INTERVAL_MS,
  pruneExpeditionMinigameIdempotency,
  startExpeditionIdempotencyRetention,
};
