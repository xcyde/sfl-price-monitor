import crypto from 'crypto';
import type { JWT } from '@fastify/jwt';
import { env } from '../../config/env.ts';
import type { User } from '../users/usersRepository.ts';
import * as usersRepository from '../users/usersRepository.ts';
import * as refreshTokensRepository from './refreshTokensRepository.ts';
import * as usedRefreshTokensRepository from './usedRefreshTokensRepository.ts';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends TokenPair {
  user: User;
}

/**
 * Ошибка бизнес-логики auth. Роуты (шаг 6) поймают её и отдадут 401,
 * не раскрывая деталей (валидный/просроченный/чужой токен — всё «unauthorized»).
 */
export class AuthError extends Error {}

// SHA-256 без соли: refresh-токен — 256 бит энтропии, его нельзя подобрать
// перебором, поэтому соль (защита слабых паролей от rainbow-таблиц) не нужна,
// а bcrypt тут избыточен. Детерминированный хеш ещё и позволяет искать по нему.
function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function refreshExpiry(): Date {
  const ms = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms);
}

/**
 * Зависимости-репозитории сервиса. Вынесены в параметр ради тестируемости:
 * в проде подставляются реальные модули (defaultDeps), в тестах — in-memory
 * фейки. Pick — берём только реально используемые методы.
 */
export interface AuthServiceDeps {
  users: Pick<typeof usersRepository, 'upsertByTelegramId' | 'findById'>;
  refreshTokens: Pick<
    typeof refreshTokensRepository,
    'save' | 'findByTokenHash' | 'deleteByUserId'
  >;
  usedRefreshTokens: Pick<typeof usedRefreshTokensRepository, 'markUsed' | 'findByHash'>;
}

const defaultDeps: AuthServiceDeps = {
  users: usersRepository,
  refreshTokens: refreshTokensRepository,
  usedRefreshTokens: usedRefreshTokensRepository,
};

/**
 * Фабрика auth-сервиса: jwt и репозитории внедряются извне (DI).
 * Так сохраняется единый путь JWT (@fastify/jwt), а сервис остаётся легко
 * тестируемым — в тесте передаются мок jwt и фейковые репозитории.
 */
export function createAuthService(jwt: JWT, deps: AuthServiceDeps = defaultDeps) {
  const { users, refreshTokens, usedRefreshTokens } = deps;

  // Общий шаг login и refresh: выпустить access + refresh и сохранить хеш.
  // За счёт upsert по user_id в save() это же и есть ротация — старый
  // refresh-хеш перезаписывается новым.
  async function issueTokens(user: User): Promise<TokenPair> {
    const accessToken = jwt.sign({ userId: user.id, telegramId: user.telegramId });
    const refreshToken = generateRefreshToken();
    await refreshTokens.save(user.id, hashToken(refreshToken), refreshExpiry());
    return { accessToken, refreshToken };
  }

  async function login(telegramId: string, username: string | null): Promise<AuthResult> {
    const user = await users.upsertByTelegramId(telegramId, username);
    const tokens = await issueTokens(user);
    return { user, ...tokens };
  }

  async function refresh(rawRefreshToken: string): Promise<TokenPair> {
    const hash = hashToken(rawRefreshToken);

    // Reuse-детекция: этот токен уже был ротирован (лежит среди использованных).
    // Признак кражи — отзываем активную сессию юзера целиком, чтобы и вор, и
    // жертва были вынуждены пройти аутентификацию заново.
    const usedBy = await usedRefreshTokens.findByHash(hash);
    if (usedBy) {
      await refreshTokens.deleteByUserId(usedBy.userId);
      throw new AuthError('refresh token reuse detected');
    }

    const stored = await refreshTokens.findByTokenHash(hash);
    if (!stored) {
      throw new AuthError('invalid refresh token');
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      // Просрочен — подчищаем запись, чтобы не копить мусор.
      await refreshTokens.deleteByUserId(stored.userId);
      throw new AuthError('refresh token expired');
    }

    const user = await users.findById(stored.userId);
    if (!user) {
      throw new AuthError('user not found');
    }

    // Ротация: помечаем текущий токен использованным (для будущей детекции),
    // затем issueTokens перезапишет активный хеш новым (см. save()).
    await usedRefreshTokens.markUsed(stored.userId, hash);
    return issueTokens(user);
  }

  return { login, refresh };
}

export type AuthService = ReturnType<typeof createAuthService>;
