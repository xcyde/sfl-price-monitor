import sql from '../../db/index';

export interface User {
  id: number;
  telegramId: string;
  telegramUsername: string | null;
  createdAt: Date;
}

// telegram_id — bigint, поэтому драйвер postgres отдаёт его строкой (без потери точности).
type UserRow = {
  id: number;
  telegram_id: string;
  telegram_username: string | null;
  created_at: Date;
};

function toUser(row: UserRow): User {
  return {
    id: row.id,
    telegramId: row.telegram_id,
    telegramUsername: row.telegram_username,
    createdAt: row.created_at,
  };
}

/**
 * Вставляет пользователя по telegram_id либо возвращает существующего.
 * ON CONFLICT DO UPDATE (а не DO NOTHING), чтобы:
 *   1) RETURNING всегда вернул строку (при DO NOTHING на конфликте строк нет);
 *   2) освежить telegram_username, если юзер сменил его в Telegram.
 */
export async function upsertByTelegramId(
  telegramId: string,
  telegramUsername: string | null
): Promise<User> {
  const [row] = await sql<UserRow[]>`
    INSERT INTO users (telegram_id, telegram_username)
    VALUES (${telegramId}, ${telegramUsername})
    ON CONFLICT (telegram_id) DO UPDATE
      SET telegram_username = EXCLUDED.telegram_username
    RETURNING id, telegram_id, telegram_username, created_at
  `;
  return toUser(row);
}

export async function findById(id: number): Promise<User | null> {
  const rows = await sql<UserRow[]>`
    SELECT id, telegram_id, telegram_username, created_at
    FROM users
    WHERE id = ${id}
  `;
  return rows[0] ? toUser(rows[0]) : null;
}
