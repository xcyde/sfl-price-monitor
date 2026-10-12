import { z } from 'zod';

import type { NftEntry } from '../../interfaces/index.ts';

const MAX_STORABLE_PRICE = 1e16;
const MAX_POSTGRES_INTEGER = 2_147_483_647;

const nftPriceSchema = z.number().nonnegative().lt(MAX_STORABLE_PRICE);

export const sflNftRecordSchema = z.object({
  id: z.number().int().nonnegative(),
  collection: z.string().min(1),
  floor: nftPriceSchema,
  lastSalePrice: nftPriceSchema,
  supply: z.number().int().nonnegative().max(MAX_POSTGRES_INTEGER),
  name: z.string().optional(),
  have_boost: z.number().optional(),
  boost_text: z.string().optional(),
});

export type SflNftRecord = z.infer<typeof sflNftRecordSchema>;

export const sflNftsResponseSchema = z.object({
  collectibles: z.array(z.unknown()),
  wearables: z.array(z.unknown()),
  updatedAt: z.number().int().positive(),
});

export interface ParsedNftSnapshot {
  fetchedAt: Date;
  entries: NftEntry[];
  rejectedCount: number;
}

export function isBoostedNft(record: SflNftRecord): boolean {
  return record.have_boost === 1;
}

function toNullIfEmpty(value: string | undefined): string | null {
  return value ? value : null;
}

function toNftEntry(record: SflNftRecord): NftEntry {
  return {
    collection: record.collection,
    externalId: record.id,
    name: toNullIfEmpty(record.name),
    boostText: toNullIfEmpty(record.boost_text),
    floor: record.floor,
    lastSalePrice: record.lastSalePrice,
    supply: record.supply,
  };
}

export function parseNftsResponse(raw: unknown): ParsedNftSnapshot {
  const response = sflNftsResponseSchema.parse(raw);

  const validRecords: SflNftRecord[] = [];
  let rejectedCount = 0;

  for (const rawRecord of [...response.collectibles, ...response.wearables]) {
    const result = sflNftRecordSchema.safeParse(rawRecord);
    if (result.success) {
      validRecords.push(result.data);
    } else {
      rejectedCount += 1;
    }
  }

  return {
    fetchedAt: new Date(response.updatedAt),
    entries: validRecords.filter(isBoostedNft).map(toNftEntry),
    rejectedCount,
  };
}

export async function fetchNfts(apiUrl: string): Promise<ParsedNftSnapshot> {
  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch NFTs: ${response.statusText}`);
  }
  return parseNftsResponse(await response.json());
}
