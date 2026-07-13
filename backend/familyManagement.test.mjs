import assert from 'node:assert/strict';
import test from 'node:test';
import BetterSqlite3 from 'better-sqlite3';
import managementModule from './familyManagement.js';

const {
  FamilyManagementError,
  removeFamilyMember,
  renameFamily,
  transferFamilyOwnership,
} = managementModule;

function fixture() {
  const db = new BetterSqlite3(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, first_name TEXT, username TEXT, coins INTEGER NOT NULL);
    CREATE TABLE families (id INTEGER PRIMARY KEY, name TEXT NOT NULL, founder_id INTEGER NOT NULL);
    CREATE TABLE family_members (family_id INTEGER NOT NULL, user_id INTEGER UNIQUE NOT NULL);
    INSERT INTO users VALUES (1, 'Founder', 'founder', 500), (2, 'Member', 'member', 50), (3, 'Outsider', 'outsider', 500);
    INSERT INTO families VALUES (10, 'Old Name', 1);
    INSERT INTO family_members VALUES (10, 1), (10, 2);
  `);
  return db;
}

test('family rename charges the founder once and returns the updated family', () => {
  const db = fixture();
  const result = renameFamily(db, { actorUserId: 1, name: '  Root   Crew  ' });

  assert.equal(result.family.name, 'Root Crew');
  assert.equal(result.coins, 200);
  assert.equal(db.prepare('SELECT coins FROM users WHERE id = 1').pluck().get(), 200);
});

test('family rename rejects non-founders and insufficient funds without mutation', () => {
  const db = fixture();
  assert.throws(
    () => renameFamily(db, { actorUserId: 2, name: 'Stolen Name' }),
    error => error instanceof FamilyManagementError && error.statusCode === 403,
  );
  db.prepare('UPDATE users SET coins = 299 WHERE id = 1').run();
  assert.throws(() => renameFamily(db, { actorUserId: 1, name: 'New Name' }), /Not enough coins/);
  assert.equal(db.prepare('SELECT name FROM families WHERE id = 10').pluck().get(), 'Old Name');
  assert.equal(db.prepare('SELECT coins FROM users WHERE id = 1').pluck().get(), 299);
});

test('ownership transfer accepts only another member of the same family', () => {
  const db = fixture();
  const result = transferFamilyOwnership(db, { actorUserId: 1, targetUserId: 2 });
  assert.equal(result.family.founder_id, 2);
  assert.equal(result.newFounder.first_name, 'Member');

  assert.throws(
    () => transferFamilyOwnership(db, { actorUserId: 2, targetUserId: 3 }),
    error => error instanceof FamilyManagementError && error.statusCode === 404,
  );
});

test('member removal rejects the founder even when the target id is a string', () => {
  const db = fixture();

  assert.throws(
    () => removeFamilyMember(db, { actorUserId: 1, targetUserId: '1' }),
    /Choose another family member/,
  );
  assert.equal(db.prepare('SELECT COUNT(*) FROM family_members').pluck().get(), 2);

  const result = removeFamilyMember(db, { actorUserId: 1, targetUserId: '2' });
  assert.equal(result.removedUserId, 2);
  assert.equal(db.prepare('SELECT COUNT(*) FROM family_members').pluck().get(), 1);
});
