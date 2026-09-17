import sql from '../../db/index';

/**
 * Помечает refresh-токен использованным (вызывается при ротации).
 * ON CONFLICT DO NOTHING — хеш уникален, повторная запись не нужна.
 *
 * NB: таблица растёт со временем; старые записи (старше срока жизни refresh)
 * стоит периодически подчищать — см. TODO.txt.
 */
export async function markUsed(userId: number, tokenHash: string): Promise<void> {
  await sql`
    INSERT INTO used_refresh_tokens (user_id, token_hash)
    VALUES (${userId}, ${tokenHash})
    ON CONFLICT (token_hash) DO NOTHING
  `;
}

/** Возвращает владельца, если такой хеш уже был использован, иначе null. */
export async function findByHash(tokenHash: string): Promise<{ userId: number } | null> {
  const rows = await sql<{ user_id: number }[]>`
    SELECT user_id FROM used_refresh_tokens WHERE token_hash = ${tokenHash}
  `;
  return rows[0] ? { userId: rows[0].user_id } : null;
}
