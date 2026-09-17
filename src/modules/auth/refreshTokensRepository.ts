import sql from '../../db/index';

export interface RefreshToken {
  id: number;
  userId: number;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

type RefreshTokenRow = {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: Date;
  created_at: Date;
};

function toRefreshToken(row: RefreshTokenRow): RefreshToken {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

/**
 * Сохраняет refresh-токен пользователя.
 *
 * Принимает уже вычисленный хеш (сам токен в БД не хранится — это делает
 * authService). UNIQUE(user_id) => один активный refresh на юзера, поэтому
 * upsert по user_id: новый вход или ротация перезаписывают старую запись.
 * created_at принудительно обновляем на now(), чтобы отражать момент выдачи.
 */
export async function save(
  userId: number,
  tokenHash: string,
  expiresAt: Date
): Promise<void> {
  await sql`
    INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
    VALUES (${userId}, ${tokenHash}, ${expiresAt})
    ON CONFLICT (user_id) DO UPDATE
      SET token_hash = EXCLUDED.token_hash,
          expires_at = EXCLUDED.expires_at,
          created_at = now()
  `;
}

export async function findByUserId(userId: number): Promise<RefreshToken | null> {
  const rows = await sql<RefreshTokenRow[]>`
    SELECT id, user_id, token_hash, expires_at, created_at
    FROM refresh_tokens
    WHERE user_id = ${userId}
  `;
  return rows[0] ? toRefreshToken(rows[0]) : null;
}

/**
 * Поиск по хешу токена — основа флоу /auth/refresh: клиент присылает только
 * сам refresh-токен (userId в нём нет), мы хешируем его и находим запись.
 * Таблица маленькая (одна строка на юзера); при росте стоит добавить индекс
 * на token_hash.
 */
export async function findByTokenHash(tokenHash: string): Promise<RefreshToken | null> {
  const rows = await sql<RefreshTokenRow[]>`
    SELECT id, user_id, token_hash, expires_at, created_at
    FROM refresh_tokens
    WHERE token_hash = ${tokenHash}
  `;
  return rows[0] ? toRefreshToken(rows[0]) : null;
}

export async function deleteByUserId(userId: number): Promise<void> {
  await sql`DELETE FROM refresh_tokens WHERE user_id = ${userId}`;
}
