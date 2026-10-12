CREATE TABLE nfts (
  id          serial      PRIMARY KEY,
  collection  text        NOT NULL,
  external_id integer     NOT NULL,
  name        text,
  boost_text  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collection, external_id)
);

CREATE TABLE nft_price_records (
  id              serial        PRIMARY KEY,
  nft_id          integer       NOT NULL REFERENCES nfts(id),
  floor           numeric(24,8) NOT NULL,
  last_sale_price numeric(24,8) NOT NULL,
  supply          integer       NOT NULL,
  fetched_at      timestamptz   NOT NULL,
  UNIQUE (nft_id, fetched_at)
);

CREATE INDEX idx_nft_price_records_fetched_at ON nft_price_records (fetched_at);
