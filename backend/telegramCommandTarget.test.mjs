import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildTargetLabel,
  parseCommandTarget,
} = require('./telegramCommandTarget.js');

test('parses clickable text_mention after command as telegram id', () => {
  const message = {
    text: '/visit Hanni',
    entities: [{
      type: 'text_mention',
      offset: 7,
      length: 5,
      user: { id: 6290708617, first_name: 'Hanni' },
    }],
  };

  assert.deepEqual(parseCommandTarget(message, '/visit'), {
    type: 'telegramId',
    telegramId: '6290708617',
    label: 'Hanni',
    source: 'text_mention',
  });
});

test('parses username mention after command', () => {
  const message = {
    text: '/together @friend_name',
    entities: [{
      type: 'mention',
      offset: 10,
      length: 12,
    }],
  };

  assert.deepEqual(parseCommandTarget(message, '/together'), {
    type: 'username',
    username: 'friend_name',
    label: '@friend_name',
    source: 'mention',
  });
});

test('uses reply author when command has no explicit target', () => {
  const message = {
    text: '/visit',
    reply_to_message: {
      from: { id: 179221945, first_name: 'Vivor' },
    },
  };

  assert.deepEqual(parseCommandTarget(message, '/visit'), {
    type: 'telegramId',
    telegramId: '179221945',
    label: 'Vivor',
    source: 'reply',
  });
});

test('ignores command bot mention and finds real target mention', () => {
  const text = '/visit@Peepergochi_bot @friend_name';
  const message = {
    text,
    entities: [{
      type: 'bot_command',
      offset: 0,
      length: 22,
    }, {
      type: 'mention',
      offset: 23,
      length: 12,
    }],
  };

  assert.equal(parseCommandTarget(message, '/visit').username, 'friend_name');
});

test('does not resolve plain text names', () => {
  assert.equal(parseCommandTarget({ text: '/visit Hanni' }, '/visit'), null);
});

test('ignores bot text mentions and bot reply authors', () => {
  assert.equal(parseCommandTarget({
    text: '/visit Peeper',
    entities: [{
      type: 'text_mention',
      offset: 7,
      length: 6,
      user: { id: 12345, first_name: 'Peeper', is_bot: true },
    }],
  }, '/visit'), null);

  assert.equal(parseCommandTarget({
    text: '/visit',
    reply_to_message: {
      from: { id: 12345, first_name: 'Peeper', is_bot: true },
    },
  }, '/visit'), null);
});

test('formats target labels for errors', () => {
  assert.equal(buildTargetLabel({ type: 'username', username: 'friend_name' }), '@friend_name');
  assert.equal(buildTargetLabel({ type: 'telegramId', label: 'Hanni' }), 'Hanni');
  assert.equal(buildTargetLabel({ type: 'telegramId', telegramId: '6290708617' }), 'this player');
});
