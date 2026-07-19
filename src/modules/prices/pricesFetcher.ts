import { env } from '../../config/env';

import type { SflPricesApiResponse, PriceEntry } from '../../interfaces';

export async function fetchPrices(): Promise<PriceEntry[]> {
  const response = await fetch(env.PRICES_API_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch prices: ${response.statusText}`);
  }
  const data: SflPricesApiResponse = await response.json();

  const fetchedAt = new Date(data.updatedAt);

  return Object.entries(data.data.p2p).map(([itemName, price]) => ({
    itemName,
    price,
    fetchedAt,
  }));
}
