import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchNfts, isBoostedNft, parseNftsResponse, type SflNftRecord } from './nftsFetcher.ts';

const updatedAt = 1_791_813_564_296;

function buildRecord(overrides: Partial<SflNftRecord> = {}): SflNftRecord {
  return {
    id: 1,
    collection: 'collectibles',
    floor: 10.5,
    lastSalePrice: 9.25,
    supply: 100,
    name: 'Golden Cow',
    have_boost: 1,
    boost_text: 'Feed cows for free!',
    ...overrides,
  };
}

test('isBoostedNft is true only when have_boost equals 1', () => {
  assert.equal(isBoostedNft(buildRecord({ have_boost: 1 })), true);
  assert.equal(isBoostedNft(buildRecord({ have_boost: 0 })), false);
  assert.equal(isBoostedNft(buildRecord({ have_boost: 2 })), false);
  assert.equal(isBoostedNft(buildRecord({ have_boost: undefined })), false);
});

test('parseNftsResponse keeps boosted records from both collections and rejects malformed ones', () => {
  const recordWithoutOptionalFields = { id: 1250, floor: 0.1279, lastSalePrice: 0.02, supply: 46076, collection: 'collectibles' };

  const result = parseNftsResponse({
    updatedAt,
    collectibles: [
      buildRecord({ id: 1 }),
      buildRecord({ id: 2, have_boost: 0, boost_text: '' }),
      recordWithoutOptionalFields,
      { ...buildRecord({ id: 3 }), floor: 'abc' },
      { ...buildRecord(), id: undefined },
      buildRecord({ id: 4, supply: -1 }),
      buildRecord({ id: 5, floor: 1e17 }),
      null,
    ],
    wearables: [buildRecord({ id: 1, collection: 'wearables', name: 'Devil Wings', boost_text: '+3 Crops' })],
  });

  assert.deepEqual(result.fetchedAt, new Date(updatedAt));
  assert.equal(result.rejectedCount, 5);
  assert.deepEqual(result.entries, [
    {
      collection: 'collectibles',
      externalId: 1,
      name: 'Golden Cow',
      boostText: 'Feed cows for free!',
      floor: 10.5,
      lastSalePrice: 9.25,
      supply: 100,
    },
    {
      collection: 'wearables',
      externalId: 1,
      name: 'Devil Wings',
      boostText: '+3 Crops',
      floor: 10.5,
      lastSalePrice: 9.25,
      supply: 100,
    },
  ]);
});

test('parseNftsResponse maps empty name and boost_text to null', () => {
  const result = parseNftsResponse({
    updatedAt,
    collectibles: [buildRecord({ name: '', boost_text: '' })],
    wearables: [],
  });

  assert.equal(result.entries[0].name, null);
  assert.equal(result.entries[0].boostText, null);
});

test('parseNftsResponse throws when updatedAt is missing', () => {
  assert.throws(() => parseNftsResponse({ collectibles: [], wearables: [] }));
});

test('parseNftsResponse throws when collectibles array is missing', () => {
  assert.throws(() => parseNftsResponse({ updatedAt, wearables: [] }));
});

test('fetchNfts requests the given url and parses the response', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    statusText: 'OK',
    async json() {
      return { updatedAt, collectibles: [buildRecord()], wearables: [] };
    },
  }));

  const result = await fetchNfts('https://example.test/nfts');

  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(fetchMock.mock.calls[0].arguments[0], 'https://example.test/nfts');
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.fetchedAt, new Date(updatedAt));
});

test('fetchNfts throws when response is not ok', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    statusText: 'Service Unavailable',
    async json() {
      return {};
    },
  }));

  await assert.rejects(() => fetchNfts('https://example.test/nfts'), /Service Unavailable/);
});
