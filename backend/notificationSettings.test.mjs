import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const notifications = require('./notificationSettings.js');

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
