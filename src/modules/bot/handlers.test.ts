import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleStart, handlePrices } from './handlers.ts';
import type { BotApiClient } from './apiClient.ts';

function makeClient(overrides: Partial<BotApiClient> = {}): BotApiClient {
  return {
    async loginByTelegram() { return 'tok'; },
    async fetchPrices() { return []; },
    ...overrides,
  };
}

test('handleStart: calls loginByTelegram with correct telegramId and username', async (t) => {
  const client = makeClient();
  const spy = t.mock.method(client, 'loginByTelegram');

  await handleStart(client, '123456789', 'testuser');

  assert.equal(spy.mock.calls.length, 1);
  assert.deepEqual(spy.mock.calls[0].arguments, ['123456789', 'testuser']);
});

test('handleStart: passes null when username is absent', async (t) => {
  const client = makeClient();
  const spy = t.mock.method(client, 'loginByTelegram');

  await handleStart(client, '999', null);

  assert.strictEqual(spy.mock.calls[0].arguments[1], null);
});

test('handleStart: returns non-empty confirmation string', async () => {
  const client = makeClient();
  const reply = await handleStart(client, '1', null);

  assert.ok(typeof reply === 'string' && reply.length > 0);
});

test('handlePrices: calls fetchPrices once with correct args', async (t) => {
  const client = makeClient();
  const spy = t.mock.method(client, 'fetchPrices');

  await handlePrices(client, '123', 'user');

  assert.equal(spy.mock.calls.length, 1);
  assert.deepEqual(spy.mock.calls[0].arguments, ['123', 'user']);
});

test('handlePrices: returns formatted messages from prices', async () => {
  const client = makeClient({
    async fetchPrices() {
      return [
        { itemName: 'Apple', price: 5, fetchedAt: new Date() },
        { itemName: 'Banana', price: 3, fetchedAt: new Date() },
      ];
    },
  });

  const messages = await handlePrices(client, '1', null);

  assert.equal(messages.length, 1);
  assert.ok(messages[0].includes('Apple'));
  assert.ok(messages[0].includes('Banana'));
});

test('handlePrices: returns placeholder when price list is empty', async () => {
  const client = makeClient();
  const messages = await handlePrices(client, '1', null);

  assert.equal(messages.length, 1);
  assert.equal(messages[0], 'No prices available yet.');
});
