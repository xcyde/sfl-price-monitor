import { formatPrices } from './formatPrices.ts';
import type { PriceRecord } from './formatPrices.ts';

export interface UsersRepo {
  upsertByTelegramId(telegramId: string, username: string | null): Promise<unknown>;
}

export interface PricesRepo {
  findLatestPrices(item?: string): Promise<PriceRecord[]>;
}

export async function handleStart(
  users: UsersRepo,
  telegramId: string,
  username: string | null
): Promise<string> {
  await users.upsertByTelegramId(telegramId, username);
  return 'Welcome! You are registered.\nUse /prices to see current prices.';
}

export async function handlePrices(prices: PricesRepo): Promise<string[]> {
  const records = await prices.findLatestPrices();
  return formatPrices(records);
}
