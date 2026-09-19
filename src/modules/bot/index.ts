import { Bot } from 'grammy';
import { createApiClient } from './apiClient.ts';
import { handleStart, handlePrices } from './handlers.ts';

export function createBot(token: string, apiBaseUrl: string, botSecret: string): Bot {
  const client = createApiClient({ baseUrl: apiBaseUrl, botSecret });
  const bot = new Bot(token);

  bot.command('start', async (ctx) => {
    if (!ctx.from) return;
    try {
      const reply = await handleStart(client, String(ctx.from.id), ctx.from.username ?? null);
      await ctx.reply(reply);
    } catch {
      await ctx.reply('Service temporarily unavailable. Please try again later.');
    }
  });

  bot.command('prices', async (ctx) => {
    if (!ctx.from) return;
    try {
      const messages = await handlePrices(client, String(ctx.from.id), ctx.from.username ?? null);
      for (const msg of messages) {
        await ctx.reply(msg, { parse_mode: 'HTML' });
      }
    } catch {
      await ctx.reply('Failed to fetch prices. Please try again later.');
    }
  });

  bot.catch((err) => {
    console.error('Bot handler error:', err);
  });

  return bot;
}
