import sql from '../../db/index.ts';
import type { NftEntry } from '../../interfaces/index.ts';

export interface NftSnapshotRepository {
  saveNftSnapshot(entries: NftEntry[], fetchedAt: Date): Promise<number>;
  findLastNftSnapshotTime(): Promise<Date | null>;
}

function toNftKey(collection: string, externalId: number): string {
  return `${collection}:${externalId}`;
}

export function deduplicateNftEntries(entries: NftEntry[]): NftEntry[] {
  const entriesByKey = new Map<string, NftEntry>();
  for (const entry of entries) {
    entriesByKey.set(toNftKey(entry.collection, entry.externalId), entry);
  }
  return [...entriesByKey.values()];
}

export async function saveNftSnapshot(entries: NftEntry[], fetchedAt: Date): Promise<number> {
  const uniqueEntries = deduplicateNftEntries(entries);
  if (uniqueEntries.length === 0) return 0;

  return sql.begin(async (tx) => {
    const catalogRows = uniqueEntries.map((entry) => ({
      collection: entry.collection,
      external_id: entry.externalId,
      name: entry.name,
      boost_text: entry.boostText,
    }));

    const nfts = await tx<{ id: number; collection: string; external_id: number }[]>`
      INSERT INTO nfts ${tx(catalogRows, 'collection', 'external_id', 'name', 'boost_text')}
      ON CONFLICT (collection, external_id) DO UPDATE
        SET name = EXCLUDED.name, boost_text = EXCLUDED.boost_text
      RETURNING id, collection, external_id
    `;

    const nftIdByKey = new Map(nfts.map((row) => [toNftKey(row.collection, row.external_id), row.id]));

    const priceRows = uniqueEntries.map((entry) => ({
      nft_id: nftIdByKey.get(toNftKey(entry.collection, entry.externalId))!,
      floor: entry.floor,
      last_sale_price: entry.lastSalePrice,
      supply: entry.supply,
      fetched_at: fetchedAt,
    }));

    const inserted = await tx`
      INSERT INTO nft_price_records ${tx(priceRows, 'nft_id', 'floor', 'last_sale_price', 'supply', 'fetched_at')}
      ON CONFLICT (nft_id, fetched_at) DO NOTHING
    `;

    return inserted.count;
  });
}

export async function findLastNftSnapshotTime(): Promise<Date | null> {
  const [row] = await sql<{ last_fetched_at: Date | null }[]>`
    SELECT max(fetched_at) AS last_fetched_at FROM nft_price_records
  `;
  return row?.last_fetched_at ?? null;
}

export const nftSnapshotRepository: NftSnapshotRepository = {
  saveNftSnapshot,
  findLastNftSnapshotTime,
};
