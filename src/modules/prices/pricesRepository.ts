import sql from '../../db/index';
import type { PriceEntry } from '../../interfaces';

export async function findItemByName(name: string): Promise<{ id: number } | null> {
  const rows = await sql<{ id: number }[]>`SELECT id FROM items WHERE name = ${name}`;
  return rows[0] ?? null;
}

export async function findLatestPrices(
  item?: string
): Promise<{ itemName: string; price: number; fetchedAt: Date }[]> {
  const rows = await sql<{ item_name: string; price: number; fetched_at: Date }[]>`
    SELECT DISTINCT ON (i.id)
      i.name AS item_name,
      pr.price::float8 AS price,
      pr.fetched_at
    FROM price_records pr
    JOIN items i ON i.id = pr.item_id
    ${item ? sql`WHERE i.name = ${item}` : sql``}
    ORDER BY i.id, pr.fetched_at DESC
  `;
  return rows.map((row) => ({ itemName: row.item_name, price: row.price, fetchedAt: row.fetched_at }));
}

export async function findPriceHistory(
  itemId: number,
  from: Date | undefined,
  to: Date | undefined,
  limit: number
): Promise<{ price: number; fetchedAt: Date }[]> {
  const rows = await sql<{ price: number; fetched_at: Date }[]>`
    SELECT price::float8 AS price, fetched_at
    FROM price_records
    WHERE item_id = ${itemId}
      ${from ? sql`AND fetched_at >= ${from}` : sql``}
      ${to ? sql`AND fetched_at <= ${to}` : sql``}
    ORDER BY fetched_at DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => ({ price: row.price, fetchedAt: row.fetched_at }));
}

export async function findPriceAggregate(
  itemId: number,
  interval: string
): Promise<{ min: number | null; max: number | null; avg: number | null; count: number }> {
  const [stats] = await sql<{ min: number | null; max: number | null; avg: number | null; count: number }[]>`
    SELECT
      MIN(price)::float8 AS min,
      MAX(price)::float8 AS max,
      AVG(price)::float8 AS avg,
      COUNT(*)::int AS count
    FROM price_records
    WHERE item_id = ${itemId}
      AND fetched_at >= now() - ${interval}::interval
  `;
  return {
    min: stats.min ?? null,
    max: stats.max ?? null,
    avg: stats.avg ?? null,
    count: stats.count ?? 0,
  };
}

export async function savePrices(entries: PriceEntry[]): Promise<void> {
  if (entries.length === 0) return;

  const names = entries.map((e) => e.itemName);

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO items (name)
      SELECT unnest(${tx.array(names)}::varchar[])
      ON CONFLICT (name) DO NOTHING
    `;

    const items = await tx<{ id: number; name: string }[]>`
      SELECT id, name FROM items WHERE name = ANY(${tx.array(names)}::varchar[])
    `;

    const nameToId = new Map(items.map((row) => [row.name, row.id]));

    const rows = entries.map((e) => ({
      item_id: nameToId.get(e.itemName)!,
      price: e.price,
      fetched_at: e.fetchedAt,
    }));

    await tx`INSERT INTO price_records ${tx(rows, 'item_id', 'price', 'fetched_at')}`;
  });
}
