// !! Telegram IDs of admins !!
// To find your ID: message @userinfobot in Telegram
export const ADMIN_TELEGRAM_IDS = [
  '179221945',    // MrVivor
  '6041075358',   // Corny
  '5331682988',   // Sunny
  '6290708617',   // Hanni
];

const DEV_ADMIN_ID = '999999';

export function isAdmin(user) {
  if (!user) return false;
  const telegramId = String(user.telegram_id);
  const isLocalDev =
    import.meta.env.DEV ||
    (typeof window !== 'undefined' && ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname));

  return ADMIN_TELEGRAM_IDS.includes(telegramId) || (isLocalDev && telegramId === DEV_ADMIN_ID);
}
