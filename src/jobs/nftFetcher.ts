import cron, { type ScheduledTask } from 'node-cron';

import type { ParsedNftSnapshot } from '../modules/nfts/nftsFetcher.ts';
import type { NftSnapshotRepository } from '../modules/nfts/nftsRepository.ts';

export const NFT_SNAPSHOT_INTERVAL_MS = 12 * 60 * 60 * 1000;
export const NFT_FETCH_CRON = '5 0,12 * * *';

export function isNftCatchUpNeeded(lastSnapshotAt: Date | null, now: Date): boolean {
  if (lastSnapshotAt === null) return true;
  return now.getTime() - lastSnapshotAt.getTime() >= NFT_SNAPSHOT_INTERVAL_MS;
}

export interface NftFetchDependencies {
  fetchSnapshot: () => Promise<ParsedNftSnapshot>;
  repository: NftSnapshotRepository;
  now: () => Date;
  logger: Pick<Console, 'log' | 'error'>;
}

export type NftFetchResult =
  | { status: 'saved'; fetchedAt: Date; received: number; inserted: number; rejected: number }
  | { status: 'skipped'; reason: 'already-running' | 'snapshot-fresh' };

export interface NftFetchJob {
  runNftFetch(): Promise<NftFetchResult>;
  runNftCatchUpIfNeeded(): Promise<NftFetchResult>;
}

export function createNftFetchJob(deps: NftFetchDependencies): NftFetchJob {
  let isRunning = false;

  async function runNftFetch(): Promise<NftFetchResult> {
    if (isRunning) {
      deps.logger.log('[nftFetcher] skipped: previous run still in progress');
      return { status: 'skipped', reason: 'already-running' };
    }

    isRunning = true;
    try {
      const snapshot = await deps.fetchSnapshot();
      const inserted = await deps.repository.saveNftSnapshot(snapshot.entries, snapshot.fetchedAt);
      const result: NftFetchResult = {
        status: 'saved',
        fetchedAt: snapshot.fetchedAt,
        received: snapshot.entries.length,
        inserted,
        rejected: snapshot.rejectedCount,
      };
      deps.logger.log(
        `[nftFetcher] snapshot ${result.fetchedAt.toISOString()}: ` +
          `received ${result.received}, inserted ${result.inserted}, rejected ${result.rejected}`
      );
      return result;
    } finally {
      isRunning = false;
    }
  }

  async function runNftCatchUpIfNeeded(): Promise<NftFetchResult> {
    const lastSnapshotAt = await deps.repository.findLastNftSnapshotTime();
    const lastSnapshotLabel = lastSnapshotAt?.toISOString() ?? 'none';
    if (!isNftCatchUpNeeded(lastSnapshotAt, deps.now())) {
      deps.logger.log(`[nftFetcher] catch-up not needed, last snapshot ${lastSnapshotLabel}`);
      return { status: 'skipped', reason: 'snapshot-fresh' };
    }
    deps.logger.log(`[nftFetcher] catch-up started, last snapshot ${lastSnapshotLabel}`);
    return runNftFetch();
  }

  return { runNftFetch, runNftCatchUpIfNeeded };
}

export function startNftFetcherCron(job: NftFetchJob): ScheduledTask {
  return cron.schedule(
    NFT_FETCH_CRON,
    async () => {
      try {
        await job.runNftFetch();
      } catch (err) {
        console.error('[nftFetcher] failed:', err);
      }
    },
    { timezone: 'UTC', name: 'nft-fetch' }
  );
}
