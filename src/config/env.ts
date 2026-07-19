import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PRICES_API_URL: z.string().default('https://sfl.world/api/v1/prices'),
});

export const env = envSchema.parse(process.env);
