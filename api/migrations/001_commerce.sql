CREATE TABLE IF NOT EXISTS inventory (
  sku text PRIMARY KEY,
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY,
  idempotency_key uuid NOT NULL UNIQUE,
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  customer_phone text NOT NULL DEFAULT '',
  address jsonb NOT NULL,
  country_code char(2) NOT NULL CHECK (country_code IN ('AT', 'DE')),
  delivery_method text NOT NULL CHECK (delivery_method IN ('shipping', 'pickup')),
  payment_method text NOT NULL CHECK (payment_method IN ('bank_transfer', 'cash_pickup')),
  status text NOT NULL DEFAULT 'payment_pending',
  subtotal_cents integer NOT NULL CHECK (subtotal_cents >= 0),
  shipping_cents integer NOT NULL CHECK (shipping_cents >= 0),
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  email_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id bigserial PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  sku text NOT NULL,
  product_name text NOT NULL,
  variant_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0)
);

CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_customer_email_idx ON orders (customer_email);

INSERT INTO inventory (sku, stock) VALUES
  ('RW-RELAIS-1', 0),
  ('RW-SPIEGEL-1', 0),
  ('RW-HALTER-1', 0),
  ('RW-HALTER-2', 0),
  ('RW-HALTER-3', 0),
  ('RW-BEZUG-1', 0),
  ('RW-THERMOMETER-RED', 0),
  ('RW-THERMOMETER-BLUE', 0),
  ('RW-USB-CHARGER-1', 0),
  ('RW-USB-OUTLET-1', 0),
  ('RW-PHONE-HOLDER-1', 0),
  ('RW-LED-INDICATOR-PAIR', 0),
  ('RW-LED-TAIL-LIGHT-1', 0),
  ('RW-CHAIN-LOCK-1', 0),
  ('RW-BRAKE-LEVER-1', 0),
  ('RW-CLUTCH-LEVER-1', 0),
  ('RW-CHAIN-BRUSH-1', 0),
  ('RW-STRAP-PAIR-1', 0)
ON CONFLICT (sku) DO NOTHING;
