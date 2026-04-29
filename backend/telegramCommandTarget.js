function firstNameLabel(user) {
  return user?.first_name || user?.username || null;
}

function getCommandEndOffset(text, commandName) {
  const start = String(text || '').search(/\S/);
  if (start < 0) return 0;

  const rest = text.slice(start);
  const match = rest.match(/^\/[A-Za-z0-9_]+(?:@[A-Za-z0-9_]+)?/);
  if (!match) return start;

  const commandToken = match[0];
  const bareCommand = commandToken.replace(/@[A-Za-z0-9_]+$/, '');
  if (bareCommand.toLowerCase() !== commandName.toLowerCase()) return start;
  return start + commandToken.length;
}

function entityText(text, entity) {
  return String(text || '').slice(entity.offset, entity.offset + entity.length);
}

function isAfterCommand(entity, commandEndOffset) {
  return Number(entity?.offset) >= commandEndOffset;
}

function parseCommandTarget(message, commandName) {
  const text = String(message?.text || '');
  const entities = Array.isArray(message?.entities) ? message.entities : [];
  const commandEndOffset = getCommandEndOffset(text, commandName);

  const explicitTarget = entities
    .filter((entity) => isAfterCommand(entity, commandEndOffset))
    .sort((a, b) => a.offset - b.offset)
    .find((entity) => entity.type === 'text_mention' || entity.type === 'mention');

  if (explicitTarget?.type === 'text_mention' && explicitTarget.user?.id && !explicitTarget.user?.is_bot) {
    return {
      type: 'telegramId',
      telegramId: String(explicitTarget.user.id),
      label: firstNameLabel(explicitTarget.user),
      source: 'text_mention',
    };
  }

  if (explicitTarget?.type === 'mention') {
    const username = entityText(text, explicitTarget).replace(/^@/, '').trim().toLowerCase();
    if (username) {
      return {
        type: 'username',
        username,
        label: `@${username}`,
        source: 'mention',
      };
    }
  }

  const replyUser = message?.reply_to_message?.from;
  if (replyUser?.id && !replyUser?.is_bot) {
    return {
      type: 'telegramId',
      telegramId: String(replyUser.id),
      label: firstNameLabel(replyUser),
      source: 'reply',
    };
  }

  return null;
}

function buildTargetLabel(target) {
  if (!target) return 'this player';
  if (target.type === 'username' && target.username) return `@${target.username}`;
  if (target.label) return target.label;
  return 'this player';
}

function resolveTargetUser(db, target) {
  if (!target) return null;
  if (target.type === 'telegramId') {
    return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(target.telegramId));
  }
  if (target.type === 'username') {
    return db.prepare('SELECT * FROM users WHERE LOWER(username) = ?').get(String(target.username).toLowerCase());
  }
  return null;
}

module.exports = {
  buildTargetLabel,
  parseCommandTarget,
  resolveTargetUser,
};
