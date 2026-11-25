ALTER TABLE products
  ADD COLUMN IF NOT EXISTS technical_details jsonb NOT NULL DEFAULT '{}'::jsonb;
