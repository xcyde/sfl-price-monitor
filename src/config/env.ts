import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PRICES_API_URL: z.string().default('https://sfl.world/api/v1/prices'),
  PORT: z.coerce.number().default(3000),
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  BOT_INTERNAL_SECRET: z.string().min(16),
});

export const env = envSchema.parse(process.env);
