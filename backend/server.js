require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { getTelegramWebhookSecret } = require('./telegramWebhookAuth');

const app = express();

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(cors({
  origin: [
    'https://peeper.frenzyradio.online',
    'http://localhost:5173',  // Vite dev server
    'http://127.0.0.1:5173',
    'http://localhost:3000',
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Telegram-Init-Data'],
}));

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth',  require('./routes/auth'));
app.use('/api/game',  require('./routes/game'));
app.use('/api/shop',  require('./routes/shop'));
app.use('/api/gifts', require('./routes/gifts'));
app.use('/api/users', require('./routes/users'));
app.use('/api/admin',   require('./routes/admin'));
app.use('/api/chat',    require('./routes/globalChat'));
app.use('/api/webhook', require('./routes/webhook'));
app.use('/api/family',  require('./routes/familyManagement'));
app.use('/api/family',  require('./routes/family'));
app.use('/api/home',    require('./routes/home'));
app.use('/api/blackjack', require('./routes/blackjack'));
app.use('/api/arena', require('./routes/arena'));
app.use('/api/farm', require('./routes/farm'));
app.use('/api/support', require('./routes/support'));
app.use('/api/expeditions', require('./routes/expeditions'));

// Items catalog (no auth needed for the list itself)
const { CLOTHING_ITEMS, GIFT_ITEMS } = require('./items');
app.get('/api/items', (_req, res) => {
  res.json({ clothing: CLOTHING_ITEMS, gifts: GIFT_ITEMS });
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', ts: Date.now() });
});

// ── Error handler ───────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🐸 Peeper backend running on port ${PORT}`);
  console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'development'}`);

  // Start notification worker
  const notifier = require('./notifier');
  notifier.start(process.env.BOT_TOKEN);

  // Register Telegram webhook
  const token = process.env.BOT_TOKEN;
  if (token && token !== 'dev') {
    const webhookUrl = `https://peeper.frenzyradio.online/api/webhook`;
    const webhookSecret = getTelegramWebhookSecret(token);
    fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        url: webhookUrl,
        secret_token: webhookSecret,
        allowed_updates: ['message', 'callback_query', 'inline_query', 'pre_checkout_query'],
      }),
    })
      .then(r => r.json())
      .then(d => console.log('[webhook] registered:', d.description || d.ok))
      .catch(e => console.warn('[webhook] registration failed:', e.message));
  }
});
