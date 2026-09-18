import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { SflPricesApiResponse } from '../../interfaces/index.js';

type PricesFetcherModule = typeof import('./pricesFetcher.js');
let fetchPrices: PricesFetcherModule['fetchPrices'];

before(async () => {
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.BOT_INTERNAL_SECRET = 'y'.repeat(16);
  const mod = await import('./pricesFetcher.ts');
  fetchPrices = mod.fetchPrices;
});

test('maps SFL API response to PriceEntry array', async (t) => {
  const updatedAt = 1_700_000_000_000;
  const fakeApiResponse: SflPricesApiResponse = {
    updatedAt,
    updated_text: 'some text',
    data: {
      p2p: { Wood: 1.5, Stone: 2.0 },
      seq: {},
      ge: {},
    },
  };

  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    statusText: 'OK',
    async json() {
      return fakeApiResponse;
    },
  }));

  const result = await fetchPrices();

  assert.equal(result.length, 2);

  const wood = result.find((e) => e.itemName === 'Wood');
  assert.ok(wood);
  assert.equal(wood.price, 1.5);
  assert.deepEqual(wood.fetchedAt, new Date(updatedAt));

  const stone = result.find((e) => e.itemName === 'Stone');
  assert.ok(stone);
  assert.equal(stone.price, 2.0);
  assert.deepEqual(stone.fetchedAt, new Date(updatedAt));
});

test('throws when response is not ok', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    statusText: 'Service Unavailable',
    async json() {
      return {};
    },
  }));

  await assert.rejects(
    () => fetchPrices(),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Service Unavailable/);
      return true;
    }
  );
});
