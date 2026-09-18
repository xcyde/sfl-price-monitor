import { test, before } from 'node:test';
import assert from 'node:assert/strict';

type EnvModule = typeof import('./env.js');
let parseEnv: EnvModule['parseEnv'];

before(async () => {
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.BOT_INTERNAL_SECRET = 'y'.repeat(16);
  const mod = await import('./env.ts');
  parseEnv = mod.parseEnv;
});

test('applies defaults for optional fields', () => {
  const result = parseEnv({
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    JWT_SECRET: 'x'.repeat(32),
    BOT_INTERNAL_SECRET: 'y'.repeat(16),
  });
  assert.equal(result.PORT, 3000);
  assert.equal(result.REFRESH_TOKEN_TTL_DAYS, 30);
  assert.equal(result.JWT_ACCESS_TTL, '15m');
  assert.equal(result.PRICES_API_URL, 'https://sfl.world/api/v1/prices');
});

test('throws when DATABASE_URL is missing', () => {
  assert.throws(() =>
    parseEnv({
      JWT_SECRET: 'x'.repeat(32),
      BOT_INTERNAL_SECRET: 'y'.repeat(16),
    })
  );
});

test('throws when JWT_SECRET is shorter than 32 characters', () => {
  assert.throws(() =>
    parseEnv({
      DATABASE_URL: 'postgres://test',
      JWT_SECRET: 'x'.repeat(31),
      BOT_INTERNAL_SECRET: 'y'.repeat(16),
    })
  );
});

test('throws when BOT_INTERNAL_SECRET is shorter than 16 characters', () => {
  assert.throws(() =>
    parseEnv({
      DATABASE_URL: 'postgres://test',
      JWT_SECRET: 'x'.repeat(32),
      BOT_INTERNAL_SECRET: 'y'.repeat(15),
    })
  );
});

test('coerces PORT and REFRESH_TOKEN_TTL_DAYS from strings to numbers', () => {
  const result = parseEnv({
    DATABASE_URL: 'postgres://test',
    JWT_SECRET: 'x'.repeat(32),
    BOT_INTERNAL_SECRET: 'y'.repeat(16),
    PORT: '8080',
    REFRESH_TOKEN_TTL_DAYS: '7',
  });
  assert.equal(result.PORT, 8080);
  assert.strictEqual(typeof result.PORT, 'number');
  assert.equal(result.REFRESH_TOKEN_TTL_DAYS, 7);
  assert.strictEqual(typeof result.REFRESH_TOKEN_TTL_DAYS, 'number');
});
