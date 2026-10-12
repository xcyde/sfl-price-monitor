import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createNftFetchJob, isNftCatchUpNeeded, NFT_SNAPSHOT_INTERVAL_MS } from './nftFetcher.ts';
import type { ParsedNftSnapshot } from '../modules/nfts/nftsFetcher.ts';
import type { NftSnapshotRepository } from '../modules/nfts/nftsRepository.ts';
import type { NftEntry } from '../interfaces/index.ts';

const now = new Date('2026-10-12T12:05:00Z');
const minuteMs = 60 * 1000;

function createInMemoryNftRepository(): NftSnapshotRepository & { storedRecordCount(): number } {
  const recordKeys = new Set<string>();
  let lastSnapshotAt: Date | null = null;

  return {
    async saveNftSnapshot(entries: NftEntry[], fetchedAt: Date): Promise<number> {
      let inserted = 0;
      for (const entry of entries) {
        const recordKey = `${entry.collection}:${entry.externalId}|${fetchedAt.toISOString()}`;
        if (!recordKeys.has(recordKey)) {
          recordKeys.add(recordKey);
          inserted += 1;
        }
      }
      if (entries.length > 0 && (lastSnapshotAt === null || fetchedAt > lastSnapshotAt)) {
        lastSnapshotAt = fetchedAt;
      }
      return inserted;
    },
    async findLastNftSnapshotTime(): Promise<Date | null> {
      return lastSnapshotAt;
    },
    storedRecordCount: () => recordKeys.size,
  };
}

function buildSnapshot(fetchedAt: Date): ParsedNftSnapshot {
  const entries: NftEntry[] = [
    { collection: 'collectibles', externalId: 1, name: 'Golden Cow', boostText: 'Feed cows for free!', floor: 65000, lastSalePrice: 65000, supply: 50 },
    { collection: 'wearables', externalId: 72, name: 'Devil Wings', boostText: '+3 Crops', floor: 66666, lastSalePrice: 24500, supply: 25 },
  ];
  return { fetchedAt, entries, rejectedCount: 1 };
}

const silentLogger = { log: () => {}, error: () => {} };

test('isNftCatchUpNeeded is true when there is no snapshot', () => {
  assert.equal(isNftCatchUpNeeded(null, now), true);
});

test('isNftCatchUpNeeded is false for a snapshot younger than the interval', () => {
  const lastSnapshotAt = new Date(now.getTime() - NFT_SNAPSHOT_INTERVAL_MS + minuteMs);
  assert.equal(isNftCatchUpNeeded(lastSnapshotAt, now), false);
});

test('isNftCatchUpNeeded is true for a snapshot exactly one interval old', () => {
  const lastSnapshotAt = new Date(now.getTime() - NFT_SNAPSHOT_INTERVAL_MS);
  assert.equal(isNftCatchUpNeeded(lastSnapshotAt, now), true);
});

test('isNftCatchUpNeeded is true for a snapshot older than the interval', () => {
  const lastSnapshotAt = new Date(now.getTime() - NFT_SNAPSHOT_INTERVAL_MS - 60 * minuteMs);
  assert.equal(isNftCatchUpNeeded(lastSnapshotAt, now), true);
});

test('isNftCatchUpNeeded is false for a snapshot in the future', () => {
  const lastSnapshotAt = new Date(now.getTime() + 60 * minuteMs);
  assert.equal(isNftCatchUpNeeded(lastSnapshotAt, now), false);
});

test('runNftFetch saves the snapshot and reports counts', async () => {
  const repository = createInMemoryNftRepository();
  const fetchedAt = new Date('2026-10-12T11:59:24Z');
  const job = createNftFetchJob({
    fetchSnapshot: async () => buildSnapshot(fetchedAt),
    repository,
    now: () => now,
    logger: silentLogger,
  });

  const result = await job.runNftFetch();

  assert.deepEqual(result, { status: 'saved', fetchedAt, received: 2, inserted: 2, rejected: 1 });
  assert.equal(repository.storedRecordCount(), 2);
});

test('runNftFetch repeated with an unchanged source updatedAt inserts nothing', async () => {
  const repository = createInMemoryNftRepository();
  const fetchedAt = new Date('2026-10-12T11:59:24Z');
  const job = createNftFetchJob({
    fetchSnapshot: async () => buildSnapshot(fetchedAt),
    repository,
    now: () => now,
    logger: silentLogger,
  });

  await job.runNftFetch();
  const repeatedResult = await job.runNftFetch();

  assert.equal(repeatedResult.status, 'saved');
  assert.equal(repeatedResult.status === 'saved' && repeatedResult.inserted, 0);
  assert.equal(repository.storedRecordCount(), 2);
});

test('runNftFetch with a new source updatedAt adds a new snapshot', async () => {
  const repository = createInMemoryNftRepository();
  const snapshotTimes = [new Date('2026-10-12T00:01:00Z'), new Date('2026-10-12T12:01:00Z')];
  let callIndex = 0;
  const job = createNftFetchJob({
    fetchSnapshot: async () => buildSnapshot(snapshotTimes[callIndex++]),
    repository,
    now: () => now,
    logger: silentLogger,
  });

  await job.runNftFetch();
  await job.runNftFetch();

  assert.equal(repository.storedRecordCount(), 4);
});

test('runNftCatchUpIfNeeded skips fetching when the last snapshot is fresh', async (t) => {
  const repository = createInMemoryNftRepository();
  await repository.saveNftSnapshot(buildSnapshot(now).entries, new Date(now.getTime() - 60 * minuteMs));
  const fetchSnapshot = t.mock.fn(async () => buildSnapshot(now));
  const job = createNftFetchJob({ fetchSnapshot, repository, now: () => now, logger: silentLogger });

  const result = await job.runNftCatchUpIfNeeded();

  assert.deepEqual(result, { status: 'skipped', reason: 'snapshot-fresh' });
  assert.equal(fetchSnapshot.mock.callCount(), 0);
});

test('runNftCatchUpIfNeeded fetches when there is no snapshot', async (t) => {
  const repository = createInMemoryNftRepository();
  const fetchSnapshot = t.mock.fn(async () => buildSnapshot(now));
  const job = createNftFetchJob({ fetchSnapshot, repository, now: () => now, logger: silentLogger });

  const result = await job.runNftCatchUpIfNeeded();

  assert.equal(result.status, 'saved');
  assert.equal(fetchSnapshot.mock.callCount(), 1);
});

test('runNftCatchUpIfNeeded fetches when the last snapshot is stale', async (t) => {
  const repository = createInMemoryNftRepository();
  const staleSnapshotAt = new Date(now.getTime() - NFT_SNAPSHOT_INTERVAL_MS - minuteMs);
  await repository.saveNftSnapshot(buildSnapshot(staleSnapshotAt).entries, staleSnapshotAt);
  const fetchSnapshot = t.mock.fn(async () => buildSnapshot(now));
  const job = createNftFetchJob({ fetchSnapshot, repository, now: () => now, logger: silentLogger });

  const result = await job.runNftCatchUpIfNeeded();

  assert.equal(result.status, 'saved');
  assert.equal(fetchSnapshot.mock.callCount(), 1);
});

test('runNftFetch skips a run that starts while the previous one is in progress', async () => {
  const repository = createInMemoryNftRepository();
  let releaseFetch: (snapshot: ParsedNftSnapshot) => void = () => {};
  const pendingSnapshot = new Promise<ParsedNftSnapshot>((resolve) => {
    releaseFetch = resolve;
  });
  const job = createNftFetchJob({
    fetchSnapshot: () => pendingSnapshot,
    repository,
    now: () => now,
    logger: silentLogger,
  });

  const firstRun = job.runNftFetch();
  const overlappingResult = await job.runNftFetch();
  releaseFetch(buildSnapshot(now));
  const firstResult = await firstRun;

  assert.deepEqual(overlappingResult, { status: 'skipped', reason: 'already-running' });
  assert.equal(firstResult.status, 'saved');
});

test('runNftFetch propagates fetch errors and allows the next run', async () => {
  const repository = createInMemoryNftRepository();
  let shouldFail = true;
  const job = createNftFetchJob({
    fetchSnapshot: async () => {
      if (shouldFail) throw new Error('source unavailable');
      return buildSnapshot(now);
    },
    repository,
    now: () => now,
    logger: silentLogger,
  });

  await assert.rejects(() => job.runNftFetch(), /source unavailable/);
  shouldFail = false;
  const result = await job.runNftFetch();

  assert.equal(result.status, 'saved');
});
