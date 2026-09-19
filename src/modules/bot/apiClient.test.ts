import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from './apiClient.ts';

function makeFakeJwt(expSeconds: number): string {
  const header = Buffer.from('{"alg":"HS256"}').toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url');
  return `${header}.${payload}.fakesig`;
}

const freshExp = () => Math.floor(Date.now() / 1000) + 3600;
const expiredExp = () => Math.floor(Date.now() / 1000) - 60;

const BASE = 'http://test';
const SECRET = 'test-secret';

function makeFetch(handlers: { login?: () => string; prices?: () => object }) {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes('/auth/login')) {
      const token = handlers.login ? handlers.login() : makeFakeJwt(freshExp());
      return new Response(JSON.stringify({ accessToken: token }));
    }
    const body = handlers.prices ? handlers.prices() : [];
    return new Response(JSON.stringify(body));
  };
}

test('loginByTelegram: caches token so fetchPrices does not re-login', async () => {
  let loginCount = 0;
  const fakeFetch = makeFetch({ login: () => { loginCount++; return makeFakeJwt(freshExp()); } });

  const client = createApiClient({ baseUrl: BASE, botSecret: SECRET, fetch: fakeFetch });
  await client.loginByTelegram('123', 'user');
  await client.fetchPrices('123', 'user');

  assert.equal(loginCount, 1);
});

test('fetchPrices: calls login on first fetch when no cached token', async () => {
  let loginCount = 0;
  const fakeFetch = makeFetch({ login: () => { loginCount++; return makeFakeJwt(freshExp()); } });

  const client = createApiClient({ baseUrl: BASE, botSecret: SECRET, fetch: fakeFetch });
  await client.fetchPrices('123', 'user');

  assert.equal(loginCount, 1);
});

test('fetchPrices: re-logins when cached token is expired', async () => {
  let loginCount = 0;
  const fakeFetch = makeFetch({
    login: () => {
      loginCount++;
      return loginCount === 1 ? makeFakeJwt(expiredExp()) : makeFakeJwt(freshExp());
    },
  });

  const client = createApiClient({ baseUrl: BASE, botSecret: SECRET, fetch: fakeFetch });
  await client.loginByTelegram('123', 'user');
  await client.fetchPrices('123', 'user');

  assert.equal(loginCount, 2);
});

test('fetchPrices: on 401 from prices API, re-logins and retries successfully', async () => {
  let loginCount = 0;
  let pricesCount = 0;

  const fakeFetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes('/auth/login')) {
      loginCount++;
      return new Response(JSON.stringify({ accessToken: makeFakeJwt(freshExp()) }));
    }
    pricesCount++;
    if (pricesCount === 1) {
      return new Response(JSON.stringify({ message: 'unauthorized' }), { status: 401 });
    }
    return new Response(
      JSON.stringify([{ itemName: 'Apple', price: 5, fetchedAt: new Date().toISOString() }])
    );
  };

  const client = createApiClient({ baseUrl: BASE, botSecret: SECRET, fetch: fakeFetch });
  const prices = await client.fetchPrices('123', 'user');

  assert.equal(loginCount, 2);
  assert.equal(pricesCount, 2);
  assert.equal(prices.length, 1);
  assert.equal(prices[0].itemName, 'Apple');
  assert.ok(prices[0].fetchedAt instanceof Date);
});

test('fetchPrices: tokens are cached independently per telegramId', async () => {
  let loginCount = 0;
  const fakeFetch = makeFetch({ login: () => { loginCount++; return makeFakeJwt(freshExp()); } });

  const client = createApiClient({ baseUrl: BASE, botSecret: SECRET, fetch: fakeFetch });
  await client.fetchPrices('111', 'alice');
  await client.fetchPrices('222', 'bob');
  await client.fetchPrices('111', 'alice');
  await client.fetchPrices('222', 'bob');

  assert.equal(loginCount, 2);
});
