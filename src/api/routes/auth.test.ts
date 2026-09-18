import { test, before } from 'node:test';
import assert from 'node:assert/strict';

type AuthRoutesModule = typeof import('./auth.js');
let isValidBotSecret: AuthRoutesModule['isValidBotSecret'];

before(async () => {
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.BOT_INTERNAL_SECRET = 'y'.repeat(16);
  const mod = await import('./auth.ts');
  isValidBotSecret = mod.isValidBotSecret;
});

test('returns true for the correct secret', () => {
  assert.equal(isValidBotSecret('y'.repeat(16)), true);
});

test('returns false for an incorrect secret', () => {
  assert.equal(isValidBotSecret('wrong-secret'), false);
});

test('returns false for undefined', () => {
  assert.equal(isValidBotSecret(undefined), false);
});
