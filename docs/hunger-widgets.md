# Hunger notifications in Telegram

Hunger alerts at 30% and 0% now use Bot API 10.4 `sendWidget`. Existing notification preferences and cooldowns still apply. Failed sends do not consume the cooldown. Other notification types keep their existing format.

The widget repeats the Food menu's three meals: Apple (1 coin, +30%), Tendies (2 coins, +60%), and Pidser (3 coins, +100%, capped at 100%). The notification presents them as three compact buttons in one row, retaining the game's names, emoji, colors, prices and effects. It omits large cards and preview bars. Once hunger exceeds the feeding threshold, meal buttons disappear. The Energy Drink is not part of the hunger notification.

Fridge owners can buy the same 3-day (150 coins) or 7-day (500 coins) stock when empty. A stocked fridge shows its remaining time. Players without a fridge can purchase it for 500 coins after a confirmation explaining that food stock is a separate purchase. The permanent fridge decor grant is preserved.

`backend/careActions.js` is the shared transactional implementation for the Mini App's `/api/game/feed` endpoint and widget actions. Catalogs, prices, feeding restrictions, death checks and fridge expiry calculations come from the existing backend modules. Widgets never accept a client-provided cost, balance or hunger value.

`backend/widgets/hunger.html` is a self-contained widget with no external assets or network requests. Its deliberately compact source fits Telegram's 32 KB HTML / 4 KB zlib limits. Messages request a 300 px width and automatic height so the widget shrinks after feeding instead of retaining an empty menu. It uses Telegram theme variables, a narrow layout, a loading state, inline errors and a small refresh control in the header. State refreshes when first shown, on activation and once per minute while visible. The message includes a one-line caption and the existing Open Peeper button for clients without widget support.

`backend/hungerWidgets.js` creates its `hunger_widgets` table automatically. Records bind each random identifier to the owner, private chat and Telegram message, and expire after seven days. Every purchase attempt consumes a persistent revision inside the same transaction as the action. Duplicate deliveries and stale buttons cannot charge again. A failed Telegram reply/edit is recoverable with Refresh without repeating the purchase. Widget code ignores state updates older than the latest revision/timestamp.

On deployment, include `backend/widgets/hunger.html` and restart the backend. Startup registers `widget_query` in the webhook's `allowed_updates`. No new environment variables are needed. Existing deployment rsync includes the HTML file. The Telegram production feature currently operates in private chats with the bot. HTML in existing widget messages cannot be replaced; changed layouts apply to newly sent messages. An explicitly requested administrative preview can pass `onlyIfHungry: false` to resend a fed pet without modifying game state; the notification worker keeps the default hunger restriction.

Validation:

```powershell
node --test backend/hungerWidgets.test.mjs backend/fridgeState.test.mjs backend/notificationSettings.test.mjs backend/telegramWebhookAuth.test.mjs backend/expeditions/notifications.test.mjs backend/frontier/notificationDelivery.test.mjs
```

Tests cover purchases, balance/state changes, catalog parity, duplicate and stale requests, ownership, expired/dead pets, transaction rollback, HTTP endpoint compatibility, webhook authentication/dispatch, preferences, delivery failure and payload limits. Browser QA additionally checks light/dark themes, 200/320 px message widths, feeding, fridge confirmation/stock, insufficient balance and network-error recovery.

Initial live delivery, fridge purchasing and state updates were verified in production on November 10, 2026. Layout revisions still need checking in Telegram: local browser rendering emulates `TelegramWidget` and does not replace testing Telegram's native renderer.

References: [Telegram Widgets](https://core.telegram.org/bots/widgets), [sendWidget](https://core.telegram.org/bots/api#sendwidget), [widget queries](https://core.telegram.org/bots/api#widgetquery).
