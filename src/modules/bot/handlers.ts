import { formatPrices } from './formatPrices.ts';
import type { BotApiClient } from './apiClient.ts';

export async function handleStart(
  client: BotApiClient,
  telegramId: string,
  username: string | null
): Promise<string> {
  await client.loginByTelegram(telegramId, username);
  return 'Welcome! You are registered.\nUse /prices to see current prices.';
}

export async function handlePrices(
  client: BotApiClient,
  telegramId: string,
  username: string | null
): Promise<string[]> {
  const records = await client.fetchPrices(telegramId, username);
  return formatPrices(records);
}
