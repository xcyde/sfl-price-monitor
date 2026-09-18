import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleStart, handlePrices } from './handlers.ts';
import type { UsersRepo, PricesRepo } from './handlers.ts';

test('handleStart: calls upsertByTelegramId with correct telegramId and username', async () => {
  const calls: Array<[string, string | null]> = [];
  const users: UsersRepo = {
    async upsertByTelegramId(telegramId, username) {
      calls.push([telegramId, username]);
    },
  };

  await handleStart(users, '123456789', 'testuser');

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '123456789');
  assert.equal(calls[0][1], 'testuser');
});

test('handleStart: passes null when username is absent', async () => {
  const calls: Array<[string, string | null]> = [];
  const users: UsersRepo = {
    async upsertByTelegramId(telegramId, username) {
      calls.push([telegramId, username]);
    },
  };

  await handleStart(users, '999', null);

  assert.strictEqual(calls[0][1], null);
});

test('handleStart: returns non-empty confirmation string', async () => {
  const users: UsersRepo = {
    async upsertByTelegramId() {},
  };

  const reply = await handleStart(users, '1', null);

  assert.ok(typeof reply === 'string' && reply.length > 0);
});

test('handlePrices: calls findLatestPrices once', async () => {
  let callCount = 0;
  const prices: PricesRepo = {
    async findLatestPrices() {
      callCount++;
      return [];
    },
  };

  await handlePrices(prices);

  assert.equal(callCount, 1);
});

test('handlePrices: returns formatted messages from prices', async () => {
  const prices: PricesRepo = {
    async findLatestPrices() {
      return [
        { itemName: 'Apple', price: 5, fetchedAt: new Date() },
        { itemName: 'Banana', price: 3, fetchedAt: new Date() },
      ];
    },
  };

  const messages = await handlePrices(prices);

  assert.equal(messages.length, 1);
  assert.ok(messages[0].includes('Apple'));
  assert.ok(messages[0].includes('Banana'));
});

test('handlePrices: returns placeholder when price list is empty', async () => {
  const prices: PricesRepo = {
    async findLatestPrices() {
      return [];
    },
  };

  const messages = await handlePrices(prices);

  assert.equal(messages.length, 1);
  assert.equal(messages[0], 'No prices available yet.');
});
