import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  latestQuerySchema,
  historyQuerySchema,
  aggregateQuerySchema,
  priceResponseSchema,
  aggregateResponseSchema,
  errorResponseSchema,
} from '../schemas';
import {
  findItemByName,
  findLatestPrices,
  findPriceHistory,
  findPriceAggregate,
} from '../../modules/prices/pricesRepository';
import { z } from 'zod';

const PERIOD_TO_INTERVAL: Record<string, string> = {
  '1h': '1 hour',
  '24h': '24 hours',
  '7d': '7 days',
};

export const pricesRoutes: FastifyPluginAsyncZod = async (app) => {
  // Защищаем весь модуль одной точкой: хук навешивается на этот
  // (инкапсулированный) плагин, поэтому применяется ко всем роутам ниже —
  // забыть отдельный роут невозможно. onRequest — самый ранний хук, guard
  // отсекает неавторизованный запрос до парсинга/валидации.
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/latest',
    {
      schema: {
        security: [{ bearerAuth: [] }],
        querystring: latestQuerySchema,
        response: {
          200: z.array(priceResponseSchema),
          401: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { item } = request.query;
      const rows = await findLatestPrices(item);
      return rows.map((row) => ({
        itemName: row.itemName,
        price: row.price,
        fetchedAt: row.fetchedAt.toISOString(),
      }));
    }
  );

  app.get(
    '/history',
    {
      schema: {
        security: [{ bearerAuth: [] }],
        querystring: historyQuerySchema,
        response: {
          200: z.array(priceResponseSchema),
          401: errorResponseSchema,
          404: z.object({ message: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { item, from, to, limit } = request.query;

      const itemRow = await findItemByName(item);
      if (itemRow === null) {
        return reply.code(404).send({ message: `Item "${item}" not found` });
      }

      const rows = await findPriceHistory(itemRow.id, from, to, limit);
      return rows.map((row) => ({
        itemName: item,
        price: row.price,
        fetchedAt: row.fetchedAt.toISOString(),
      }));
    }
  );

  app.get(
    '/aggregate',
    {
      schema: {
        security: [{ bearerAuth: [] }],
        querystring: aggregateQuerySchema,
        response: {
          200: aggregateResponseSchema,
          401: errorResponseSchema,
          404: z.object({ message: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { item, period } = request.query;
      const interval = PERIOD_TO_INTERVAL[period];

      const itemRow = await findItemByName(item);
      if (itemRow === null) {
        return reply.code(404).send({ message: `Item "${item}" not found` });
      }

      const stats = await findPriceAggregate(itemRow.id, interval);
      return {
        itemName: item,
        period,
        ...stats,
      };
    }
  );
};
