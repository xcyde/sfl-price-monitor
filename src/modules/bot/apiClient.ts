import type { PriceRecord } from './formatPrices.ts';

export interface BotApiClient {
  loginByTelegram(telegramId: string, username: string | null): Promise<string>;
  fetchPrices(telegramId: string, username: string | null): Promise<PriceRecord[]>;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

export interface ApiClientDeps {
  baseUrl: string;
  botSecret: string;
  fetch?: typeof globalThis.fetch;
}

function parseTokenExpiry(token: string): number {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  return (payload.exp as number) * 1000;
}

export function createApiClient({ baseUrl, botSecret, fetch: fetchFn = globalThis.fetch }: ApiClientDeps): BotApiClient {
  const tokenCache = new Map<string, CachedToken>();

  async function loginByTelegram(telegramId: string, username: string | null): Promise<string> {
    const res = await fetchFn(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bot-secret': botSecret,
      },
      body: JSON.stringify({ telegramId, username }),
    });
    if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
    const { accessToken } = (await res.json()) as { accessToken: string };
    tokenCache.set(telegramId, {
      accessToken,
      expiresAt: parseTokenExpiry(accessToken) - 30_000,
    });
    return accessToken;
  }

  async function getToken(telegramId: string, username: string | null): Promise<string> {
    const cached = tokenCache.get(telegramId);
    if (cached && cached.expiresAt > Date.now()) return cached.accessToken;
    return loginByTelegram(telegramId, username);
  }

  async function requestPrices(token: string): Promise<Response> {
    return fetchFn(`${baseUrl}/api/prices/latest`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  async function fetchPrices(telegramId: string, username: string | null): Promise<PriceRecord[]> {
    let token = await getToken(telegramId, username);
    let res = await requestPrices(token);

    if (res.status === 401) {
      tokenCache.delete(telegramId);
      token = await loginByTelegram(telegramId, username);
      res = await requestPrices(token);
    }

    if (!res.ok) throw new Error(`Prices fetch failed: ${res.status}`);

    const rows = (await res.json()) as Array<{ itemName: string; price: number; fetchedAt: string }>;
    return rows.map((row) => ({ itemName: row.itemName, price: row.price, fetchedAt: new Date(row.fetchedAt) }));
  }

  return { loginByTelegram, fetchPrices };
}
