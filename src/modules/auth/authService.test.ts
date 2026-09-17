import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { JWT } from '@fastify/jwt';
import type { User } from '../users/usersRepository';
import type { RefreshToken } from './refreshTokensRepository';
import type { AuthServiceDeps } from './authService';

// authService импортирует config/env, который парсит process.env при загрузке
// модуля. Поэтому переменные окружения выставляем ДО динамического импорта.
type AuthModule = typeof import('./authService');
let mod: AuthModule;

before(async () => {
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
  process.env.JWT_SECRET = 'x'.repeat(40);
  process.env.BOT_INTERNAL_SECRET = 'y'.repeat(20);
  process.env.REFRESH_TOKEN_TTL_DAYS = '30';
  mod = await import('./authService');
});

// --- in-memory фейки репозиториев (DI вместо БД) ---

function makeUsersRepo() {
  const store = new Map<number, User>();
  const byTelegram = new Map<string, User>();
  let seq = 0;
  return {
    store,
    async upsertByTelegramId(telegramId: string, username: string | null): Promise<User> {
      const existing = byTelegram.get(telegramId);
      if (existing) {
        existing.telegramUsername = username;
        return existing;
      }
      const user: User = {
        id: ++seq,
        telegramId,
        telegramUsername: username,
        createdAt: new Date(),
      };
      store.set(user.id, user);
      byTelegram.set(telegramId, user);
      return user;
    },
    async findById(id: number): Promise<User | null> {
      return store.get(id) ?? null;
    },
  };
}

function makeRefreshTokensRepo() {
  const byUser = new Map<number, RefreshToken>();
  let seq = 0;
  return {
    byUser,
    async save(userId: number, tokenHash: string, expiresAt: Date): Promise<void> {
      byUser.set(userId, { id: ++seq, userId, tokenHash, expiresAt, createdAt: new Date() });
    },
    async findByTokenHash(tokenHash: string): Promise<RefreshToken | null> {
      for (const rec of byUser.values()) {
        if (rec.tokenHash === tokenHash) return rec;
      }
      return null;
    },
    async deleteByUserId(userId: number): Promise<void> {
      byUser.delete(userId);
    },
  };
}

function makeUsedRepo() {
  const byHash = new Map<string, number>();
  return {
    byHash,
    async markUsed(userId: number, tokenHash: string): Promise<void> {
      byHash.set(tokenHash, userId);
    },
    async findByHash(tokenHash: string): Promise<{ userId: number } | null> {
      const userId = byHash.get(tokenHash);
      return userId === undefined ? null : { userId };
    },
  };
}

function makeJwt() {
  const calls: Array<{ userId: number; telegramId: string }> = [];
  const jwt = {
    calls,
    sign(payload: { userId: number; telegramId: string }): string {
      calls.push(payload);
      return 'signed-token';
    },
  };
  return jwt;
}

function setup() {
  const users = makeUsersRepo();
  const refreshTokens = makeRefreshTokensRepo();
  const usedRefreshTokens = makeUsedRepo();
  const jwt = makeJwt();
  const deps: AuthServiceDeps = { users, refreshTokens, usedRefreshTokens };
  const service = mod.createAuthService(jwt as unknown as JWT, deps);
  return { users, refreshTokens, usedRefreshTokens, jwt, service };
}

// helper: предикат ошибки для assert.rejects
function isAuthError(re: RegExp) {
  return (err: unknown): true => {
    assert.ok(err instanceof mod.AuthError, `ожидали AuthError, получили ${err}`);
    assert.match((err as Error).message, re);
    return true;
  };
}

// --- login ---

test('login: создаёт юзера, выдаёт пару и сохраняет ХЕШ refresh-токена', async () => {
  const { service, refreshTokens, jwt } = setup();

  const res = await service.login('12345', 'testuser');

  assert.equal(res.user.telegramId, '12345');
  assert.equal(res.user.telegramUsername, 'testuser');
  assert.equal(res.accessToken, 'signed-token');
  // refresh — 32 байта в hex
  assert.match(res.refreshToken, /^[0-9a-f]{64}$/);
  // access подписан с правильным payload
  assert.deepEqual(jwt.calls[0], { userId: res.user.id, telegramId: '12345' });
  // в БД лежит запись, и это ХЕШ, а не сам токен
  const stored = refreshTokens.byUser.get(res.user.id);
  assert.ok(stored, 'refresh-запись должна быть сохранена');
  assert.notEqual(stored!.tokenHash, res.refreshToken);
});

// --- refresh: happy path (ротация) ---

test('refresh: ротирует токен — новый != старый, старый помечен использованным', async () => {
  const { service, refreshTokens, usedRefreshTokens } = setup();
  const { user, refreshToken: r1 } = await service.login('1', null);
  const oldHash = refreshTokens.byUser.get(user.id)!.tokenHash;

  const res = await service.refresh(r1);

  assert.notEqual(res.refreshToken, r1);
  assert.ok(usedRefreshTokens.byHash.has(oldHash), 'старый хеш должен попасть в журнал');
  assert.notEqual(refreshTokens.byUser.get(user.id)!.tokenHash, oldHash, 'активный хеш ротирован');
});

// --- refresh: reuse-детекция ---

test('refresh: повтор ротированного токена → reuse detected + отзыв сессии', async () => {
  const { service, refreshTokens } = setup();
  const { user, refreshToken: r1 } = await service.login('1', null);

  await service.refresh(r1); // r1 теперь использован, активен уже r2

  await assert.rejects(() => service.refresh(r1), isAuthError(/reuse/));
  // активная сессия должна быть отозвана целиком
  assert.equal(refreshTokens.byUser.has(user.id), false);
});

// --- refresh: невалидный токен ---

test('refresh: неизвестный токен → invalid refresh token', async () => {
  const { service } = setup();
  await service.login('1', null);

  await assert.rejects(() => service.refresh('0'.repeat(64)), isAuthError(/invalid/));
});

// --- refresh: просроченный токен ---

test('refresh: просроченный токен → expired + запись удалена', async () => {
  const { service, refreshTokens } = setup();
  const { user, refreshToken: r1 } = await service.login('1', null);
  // принудительно «просрочим» активную запись
  refreshTokens.byUser.get(user.id)!.expiresAt = new Date(0);

  await assert.rejects(() => service.refresh(r1), isAuthError(/expired/));
  assert.equal(refreshTokens.byUser.has(user.id), false);
});

// --- refresh: юзер исчез ---

test('refresh: токен валиден, но юзер удалён → user not found', async () => {
  const { service, users } = setup();
  const { user, refreshToken: r1 } = await service.login('1', null);
  users.store.delete(user.id); // токен остался, юзера нет

  await assert.rejects(() => service.refresh(r1), isAuthError(/user not found/));
});
