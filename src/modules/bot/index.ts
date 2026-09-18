import { Bot } from 'grammy';
import * as usersRepo from '../users/usersRepository.ts';
import * as pricesRepo from '../prices/pricesRepository.ts';
import { handleStart, handlePrices } from './handlers.ts';

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  bot.command('start', async (ctx) => {
    if (!ctx.from) return;
    const reply = await handleStart(usersRepo, String(ctx.from.id), ctx.from.username ?? null);
    await ctx.reply(reply);
  });

  bot.command('prices', async (ctx) => {
    const messages = await handlePrices(pricesRepo);
    for (const msg of messages) {
      await ctx.reply(msg, { parse_mode: 'HTML' });
    }
  });

  bot.catch((err) => {
    console.error('Bot handler error:', err);
  });

  return bot;
}
