import { z } from 'zod';

export const latestQuerySchema = z.object({
  item: z.string().min(1).optional(),
});

export const historyQuerySchema = z.object({
  item: z.string().min(1),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(1000).default(100),
});

export const aggregateQuerySchema = z.object({
  item: z.string().min(1),
  period: z.enum(['1h', '24h', '7d']),
});

export const priceResponseSchema = z.object({
  itemName: z.string(),
  price: z.number(),
  fetchedAt: z.string(),
});

export const aggregateResponseSchema = z.object({
  itemName: z.string(),
  period: z.enum(['1h', '24h', '7d']),
  min: z.number().nullable(),
  max: z.number().nullable(),
  avg: z.number().nullable(),
  count: z.number(),
});

// --- auth ---

// telegramId — bigint, поэтому строкой; проверяем, что это цифры.
export const loginBodySchema = z.object({
  telegramId: z.string().regex(/^\d+$/, 'telegramId must be a numeric string'),
  username: z.string().min(1).nullish(),
});

// Заголовок с секретом бота. Опционален на уровне схемы (чтобы отсутствие
// давало 401 от нашей ручной проверки, а не 400 от валидатора), но благодаря
// объявлению он появляется полем в Swagger UI — можно тестить /login из браузера.
// TODO(security, до прода): это поле раскрывает существование секрета бота в
// публичных доках; в проде Swagger UI должен быть закрыт (см. index.ts).
export const loginHeadersSchema = z.object({
  'x-bot-secret': z.string().min(1).optional(),
});

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1),
});

export const userResponseSchema = z.object({
  id: z.number(),
  telegramId: z.string(),
  telegramUsername: z.string().nullable(),
});

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

export const loginResponseSchema = tokenPairSchema.extend({
  user: userResponseSchema,
});

export const errorResponseSchema = z.object({
  message: z.string(),
});
