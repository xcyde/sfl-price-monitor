import crypto from 'crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  loginBodySchema,
  loginHeadersSchema,
  loginResponseSchema,
  refreshBodySchema,
  tokenPairSchema,
  userResponseSchema,
  errorResponseSchema,
} from '../schemas';
import { createAuthService, AuthError } from '../../modules/auth/authService';
import { findById } from '../../modules/users/usersRepository';
import { env } from '../../config/env';

/**
 * Проверка секрета бота в constant time.
 * Сравниваем SHA-256-дайджесты: они всегда одной длины (32 байта), поэтому
 * timingSafeEqual не бросает исключение и не утекает длина секрета по времени.
 */
function isValidBotSecret(provided: string | undefined): boolean {
  if (!provided) return false;
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(env.BOT_INTERNAL_SECRET).digest();
  return crypto.timingSafeEqual(a, b);
}

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  // Единственное место, где вызывается фабрика: jwt берём с инстанса (app.jwt),
  // который уже задекорирован плагином @fastify/jwt (регистрируется до роутов).
  const authService = createAuthService(app.jwt);

  app.post(
    '/login',
    {
      schema: {
        headers: loginHeadersSchema,
        body: loginBodySchema,
        response: {
          200: loginResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      // Доверяем только боту: /login недоступен снаружи без общего секрета.
      if (!isValidBotSecret(request.headers['x-bot-secret'])) {
        return reply.code(401).send({ message: 'unauthorized' });
      }

      const { telegramId, username } = request.body;
      const { user, accessToken, refreshToken } = await authService.login(
        telegramId,
        username ?? null
      );

      return {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          telegramId: user.telegramId,
          telegramUsername: user.telegramUsername,
        },
      };
    }
  );

  app.post(
    '/refresh',
    {
      schema: {
        body: refreshBodySchema,
        response: {
          200: tokenPairSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { refreshToken } = request.body;
        return await authService.refresh(refreshToken);
      } catch (err) {
        // Любую доменную ошибку auth схлопываем в 401 без деталей
        // (не различаем «нет токена / просрочен / чужой»).
        if (err instanceof AuthError) {
          return reply.code(401).send({ message: 'unauthorized' });
        }
        throw err;
      }
    }
  );

  app.get(
    '/me',
    {
      preHandler: [app.authenticate],
      schema: {
        // Отражаем в Swagger, что роут требует Bearer-токен.
        security: [{ bearerAuth: [] }],
        response: {
          200: userResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      // Сюда попадаем только с валидным токеном; request.user — его payload.
      const user = await findById(request.user.userId);
      if (!user) {
        return reply.code(401).send({ message: 'unauthorized' });
      }
      return {
        id: user.id,
        telegramId: user.telegramId,
        telegramUsername: user.telegramUsername,
      };
    }
  );
};
