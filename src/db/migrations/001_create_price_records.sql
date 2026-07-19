CREATE TABLE items (
  id serial PRIMARY KEY,
  name varchar(100) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE price_records (
  id serial PRIMARY KEY,
  item_id integer NOT NULL REFERENCES items(id),
  price numeric(10, 6) NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_price_records_item_fetched ON price_records (item_id, fetched_at DESC);
