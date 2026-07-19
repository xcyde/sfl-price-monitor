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
