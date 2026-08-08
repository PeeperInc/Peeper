const db = require('./database');

const NOTIFICATION_SETTING_KEYS = [
  'care_notifications',
  'family_notifications',
  'gift_notifications',
  'jackpot_notifications',
  'farm_notifications',
  'farm_animal_notifications',
  'expedition_notifications',
];

const NOTIFICATION_SETTING_META = {
  care_notifications: {
    label: 'Care alerts',
    description: 'Hunger, HP, dirt and danger reminders',
  },
  family_notifications: {
    label: 'Family alerts',
    description: 'Feeds, feasts and family invites',
  },
  gift_notifications: {
    label: 'Gift alerts',
    description: 'Telegram messages when someone sends you a gift',
  },
  jackpot_notifications: {
    label: 'Jackpot alerts',
    description: 'Broadcasts when someone hits the caSino jackpot',
  },
  farm_notifications: {
    label: 'Farm alerts',
    description: 'Telegram messages when all planted crops are ready',
  },
  farm_animal_notifications: {
    label: 'Animal farm alerts',
    description: 'Telegram messages when fed animals have products ready',
    defaultEnabled: 0,
  },
  expedition_notifications: {
    label: 'Expedition alerts',
    description: 'Full AP and completed expedition reward alerts',
  },
};

function ts() {
  return Math.floor(Date.now() / 1000);
}

function normalizeSettingKey(key) {
  return NOTIFICATION_SETTING_KEYS.includes(key) ? key : null;
}

function ensureNotificationSettingsRow(userId) {
  db.prepare(`
    INSERT INTO user_notification_settings (user_id)
    VALUES (?)
    ON CONFLICT(user_id) DO NOTHING
  `).run(userId);
}

function getNotificationSettings(userId) {
  const row = db.prepare(`
    SELECT *
    FROM user_notification_settings
    WHERE user_id = ?
  `).get(userId);

  return {
    care_notifications: Number(row?.care_notifications ?? 1),
    family_notifications: Number(row?.family_notifications ?? 1),
    gift_notifications: Number(row?.gift_notifications ?? 1),
    jackpot_notifications: Number(row?.jackpot_notifications ?? 1),
    farm_notifications: Number(row?.farm_notifications ?? 1),
    farm_animal_notifications: Number(row?.farm_animal_notifications ?? 0),
    expedition_notifications: Number(row?.expedition_notifications ?? 1),
  };
}

function isNotificationEnabled(userId, key) {
  const normalizedKey = normalizeSettingKey(key);
  if (!normalizedKey || !userId) return true;
  const defaultEnabled = NOTIFICATION_SETTING_META[normalizedKey]?.defaultEnabled ?? 1;
  const row = db.prepare(`
    SELECT ${normalizedKey} AS enabled
    FROM user_notification_settings
    WHERE user_id = ?
  `).get(userId);
  return Number(row?.enabled ?? defaultEnabled) === 1;
}

function toggleNotificationSetting(userId, key) {
  const normalizedKey = normalizeSettingKey(key);
  if (!normalizedKey) throw new Error('Invalid notification setting');

  ensureNotificationSettingsRow(userId);
  const current = isNotificationEnabled(userId, normalizedKey) ? 1 : 0;
  const next = current ? 0 : 1;

  db.prepare(`
    UPDATE user_notification_settings
    SET ${normalizedKey} = ?, updated_at = ?
    WHERE user_id = ?
  `).run(next, ts(), userId);

  return getNotificationSettings(userId);
}

function buildNotificationSettingsText(firstName, settings) {
  const displayName = firstName || 'your account';
  const lines = [
    `🔔 <b>${displayName} notification settings</b>`,
    '',
    'Choose which Telegram alerts you want to receive:',
    '',
  ];

  for (const key of NOTIFICATION_SETTING_KEYS) {
    const meta = NOTIFICATION_SETTING_META[key];
    const enabled = Number(settings[key] ?? (meta.defaultEnabled ?? 1)) === 1;
    lines.push(`${enabled ? '🟢' : '⚫'} <b>${meta.label}</b>`);
    lines.push(`${meta.description}`);
    lines.push('');
  }

  lines.push('Changes are saved instantly.');
  return lines.join('\n');
}

function buildNotificationSettingsMarkup(settings) {
  return {
    inline_keyboard: NOTIFICATION_SETTING_KEYS.map((key) => {
      const meta = NOTIFICATION_SETTING_META[key];
      const enabled = Number(settings[key] ?? (meta.defaultEnabled ?? 1)) === 1;
      return [{
        text: `${enabled ? '✅' : '☑️'} ${meta.label}`,
        callback_data: `notif_toggle:${key}`,
      }];
    }),
  };
}

module.exports = {
  NOTIFICATION_SETTING_KEYS,
  NOTIFICATION_SETTING_META,
  ensureNotificationSettingsRow,
  getNotificationSettings,
  isNotificationEnabled,
  toggleNotificationSetting,
  buildNotificationSettingsText,
  buildNotificationSettingsMarkup,
};
