import 'dotenv/config';
import { parseBotEnv } from './config/botEnv.ts';
import { createBot } from './modules/bot/index.ts';

const env = parseBotEnv();
const bot = createBot(env.TELEGRAM_BOT_TOKEN, env.API_BASE_URL, env.BOT_INTERNAL_SECRET);

bot.start();

async function shutdown() {
  await bot.stop();
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
