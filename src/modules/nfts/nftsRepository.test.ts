import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { NftEntry } from '../../interfaces/index.ts';

type NftsRepositoryModule = typeof import('./nftsRepository.js');
let deduplicateNftEntries: NftsRepositoryModule['deduplicateNftEntries'];

before(async () => {
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.BOT_INTERNAL_SECRET = 'y'.repeat(16);
  const mod = await import('./nftsRepository.ts');
  deduplicateNftEntries = mod.deduplicateNftEntries;
});

function buildEntry(overrides: Partial<NftEntry> = {}): NftEntry {
  return {
    collection: 'collectibles',
    externalId: 1,
    name: 'Golden Cow',
    boostText: 'Feed cows for free!',
    floor: 10,
    lastSalePrice: 9,
    supply: 50,
    ...overrides,
  };
}

test('deduplicateNftEntries treats the same id in different collections as different NFTs', () => {
  const entries = [buildEntry({ collection: 'collectibles' }), buildEntry({ collection: 'wearables' })];

  assert.deepEqual(deduplicateNftEntries(entries), entries);
});

test('deduplicateNftEntries keeps the last entry for a repeated key', () => {
  const first = buildEntry({ floor: 10 });
  const last = buildEntry({ floor: 20 });

  assert.deepEqual(deduplicateNftEntries([first, last]), [last]);
});
