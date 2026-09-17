CREATE TABLE users (
    id                serial          PRIMARY KEY,
    telegram_id       bigint          UNIQUE NOT NULL,
    telegram_username text,
    created_at        timestamptz     NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
    id          serial      PRIMARY KEY,
    user_id     int         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  text        NOT NULL,
    expires_at  timestamptz NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id)
);
