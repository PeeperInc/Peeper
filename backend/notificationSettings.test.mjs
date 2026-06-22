import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tempDirectory = mkdtempSync(path.join(tmpdir(), 'peeper-notification-settings-'));
process.env.PEEPER_DB_PATH = path.join(tempDirectory, 'peeper.test.db');
const notifications = require('./notificationSettings.js');
const db = require('./database.js');
delete process.env.PEEPER_DB_PATH;

after(() => {
  db.close();
  rmSync(tempDirectory, { recursive: true, force: true });
});

test('farm animal notifications default to off while crop farm alerts stay on', () => {
  const missingUserId = -991_771;
  const settings = notifications.getNotificationSettings(missingUserId);

  assert.equal(settings.farm_notifications, 1);
  assert.equal(settings.farm_animal_notifications, 0);
  assert.equal(notifications.isNotificationEnabled(missingUserId, 'farm_notifications'), true);
  assert.equal(notifications.isNotificationEnabled(missingUserId, 'farm_animal_notifications'), false);
});

test('expedition notifications default to enabled', () => {
  const settings = notifications.getNotificationSettings(-999_999);

  assert.equal(settings.expedition_notifications, 1);
  assert.equal(
    notifications.NOTIFICATION_SETTING_META.expedition_notifications.label,
    'Expedition alerts',
  );
});
