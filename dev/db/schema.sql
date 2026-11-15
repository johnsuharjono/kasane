-- Only run inside kasane_dev. The seed script checks the target first.
DROP SCHEMA IF EXISTS commerce CASCADE;
DROP SCHEMA IF EXISTS lab CASCADE;
CREATE SCHEMA commerce;
CREATE SCHEMA lab;
CREATE TYPE commerce.order_status AS ENUM ('pending', 'paid', 'shipped', 'cancelled');
CREATE TABLE commerce.customers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  country char(2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'
);
COMMENT ON TABLE commerce.customers IS 'Synthetic customers; no real personal data.';
CREATE TABLE commerce.categories (
  id integer PRIMARY KEY,
  parent_id integer REFERENCES commerce.categories(id) ON DELETE RESTRICT,
  name text NOT NULL UNIQUE
);
CREATE TABLE commerce.products (
  id integer PRIMARY KEY,
  category_id integer NOT NULL REFERENCES commerce.categories(id),
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  price numeric(18,2) NOT NULL CHECK (price >= 0),
  tags text[] NOT NULL DEFAULT '{}',
  attributes jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE commerce.orders (
  id bigint PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES commerce.customers(id) ON DELETE RESTRICT,
  status commerce.order_status NOT NULL,
  ordered_at timestamptz NOT NULL,
  shipped_at timestamptz,
  shipping_address jsonb NOT NULL,
  notes text
);
CREATE TABLE commerce.order_items (
  order_id bigint NOT NULL REFERENCES commerce.orders(id) ON DELETE CASCADE,
  line_number smallint NOT NULL,
  product_id integer NOT NULL REFERENCES commerce.products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(18,2) NOT NULL,
  total numeric(20,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  PRIMARY KEY (order_id, line_number)
);
CREATE TABLE commerce.payments (
  id uuid PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES commerce.orders(id),
  amount numeric(20,2) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  paid_at timestamptz NOT NULL,
  provider_reference text UNIQUE
);
CREATE TABLE commerce.events (
  id bigint PRIMARY KEY,
  customer_id bigint REFERENCES commerce.customers(id),
  occurred_at timestamptz NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL
);
CREATE INDEX orders_customer_date_idx ON commerce.orders(customer_id, ordered_at DESC) INCLUDE (status);
CREATE INDEX orders_pending_idx ON commerce.orders(ordered_at) WHERE status = 'pending';
CREATE INDEX products_category_idx ON commerce.products(category_id);
CREATE INDEX products_attributes_gin ON commerce.products USING gin(attributes);
CREATE INDEX customers_email_lower_idx ON commerce.customers(lower(email));
CREATE INDEX order_items_product_idx ON commerce.order_items(product_id);
CREATE INDEX payments_order_idx ON commerce.payments(order_id);
CREATE INDEX events_customer_idx ON commerce.events(customer_id);
CREATE INDEX events_time_brin ON commerce.events USING brin(occurred_at);
CREATE VIEW commerce.order_summary AS
SELECT o.id, c.name AS customer, o.status, o.ordered_at,
       count(i.line_number) AS line_count, sum(i.total) AS total
FROM commerce.orders o JOIN commerce.customers c ON c.id = o.customer_id
JOIN commerce.order_items i ON i.order_id = o.id
GROUP BY o.id, c.name;
COMMENT ON COLUMN commerce.order_items.total IS 'Generated exact decimal total, not a float.';
CREATE TABLE lab.type_samples (
  id integer PRIMARY KEY,
  large_integer bigint NOT NULL,
  exact_decimal numeric(60,30) NOT NULL,
  timestamp_local timestamp NOT NULL,
  timestamp_utc timestamptz NOT NULL,
  date_value date NOT NULL,
  time_value time NOT NULL,
  duration interval NOT NULL,
  binary_value bytea NOT NULL,
  optional_text text,
  empty_text text NOT NULL,
  unicode_text text NOT NULL,
  long_text text NOT NULL,
  json_value jsonb NOT NULL,
  array_value text[],
  float_value double precision
);
CREATE TABLE lab."Odd table" ("Primary Key" integer PRIMARY KEY, "select" text, "日本語" text);
INSERT INTO lab."Odd table" VALUES (1, 'quoted identifier', '重ね');
INSERT INTO lab.type_samples VALUES (
  1, 9223372036854775807,
  123456789012345678901234567890.123456789012345678901234567890,
  '2026-10-31 23:59:59.123456', '2026-10-31 23:59:59.123456+09',
  '2024-02-29', '23:59:59.123456', '1 year 2 months 3 days 04:05:06.123456',
  decode('0001ffdeadbeef','hex'), NULL, '', '重ね · café · 🚀 · مرحبا',
  repeat(E'Long value with tabs\tand newlines\n', 3000),
  '{"large":9223372036854775807,"nested":{"empty":null},"list":[1,true,"重ね"]}',
  ARRAY['a',NULL,'comma,value',''], 'NaN'
), (
  2, -9223372036854775808, -0.000000000000000000000000000001,
  '1970-01-01', 'infinity', 'infinity', '00:00:00', '-1 microsecond',
  ''::bytea, 'NULL', '', 'é vs é', '', '{}', NULL, 'Infinity'
);
