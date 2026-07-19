import sql from '../../db/index';
import type { PriceEntry } from '../../interfaces';

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
