import { z } from 'zod';

const botEnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  BOT_INTERNAL_SECRET: z.string().min(16),
  API_BASE_URL: z.string().url().default('http://127.0.0.1:3000'),
});

export function parseBotEnv(source: NodeJS.ProcessEnv = process.env) {
  return botEnvSchema.parse(source);
}
