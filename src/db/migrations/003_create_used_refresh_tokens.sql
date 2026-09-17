-- Журнал уже использованных (ротированных) refresh-токенов — основа
-- reuse-детекции: если предъявленный токен есть здесь, значит его уже
-- ротировали, и повторное использование трактуется как кража.
CREATE TABLE used_refresh_tokens (
    id          serial      PRIMARY KEY,
    user_id     int         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  text        NOT NULL UNIQUE,
    used_at     timestamptz NOT NULL DEFAULT now()
);

-- Поиск при каждом /refresh идёт по token_hash.
CREATE INDEX idx_used_refresh_tokens_hash ON used_refresh_tokens (token_hash);
