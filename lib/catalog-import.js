import { randomUUID } from "node:crypto";

export async function importCatalogRows(pool, rows) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existingResult = await client.query(`
      SELECT p.id AS product_id, p.name, p.description, p.category, p.subcategory, p.compatibility,
             p.active AS product_active, v.sku, v.name AS variant_name, v.image
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      WHERE v.sku = ANY($1::text[])
      FOR UPDATE OF p, v
    `, [rows.map((row) => row.sku)]);
    const existingBySku = new Map(existingResult.rows.map((row) => [row.sku, row]));
    let updated = 0;
    let created = 0;

    for (const row of rows) {
      const existing = existingBySku.get(row.sku);
      if (existing) {
        await client.query(`
          UPDATE products
          SET name=$1, description=$2, category=$3, subcategory=$4, compatibility=$5,
              active=$6, updated_at=now()
          WHERE id=$7
        `, [row.name, row.description, row.category, row.subcategory, row.compatibility,
            row.active, existing.product_id]);
        await client.query(`
          UPDATE product_variants
          SET price_cents=$1, compare_at_cents=$2, stock=$3, active=$4, image=$5
          WHERE sku=$6
        `, [row.priceCents, row.compareAtCents, row.stock, row.active, row.image, row.sku]);
        await client.query(`
          INSERT INTO inventory (sku, stock) VALUES ($1, $2)
          ON CONFLICT (sku) DO UPDATE SET stock=EXCLUDED.stock, updated_at=now()
        `, [row.sku, row.stock]);
        updated++;
      } else {
        const productId = `xlsx-${randomUUID()}`;
        await client.query(`
          INSERT INTO products
            (id, name, description, category, subcategory, compatibility, fits, active)
          VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,$7)
        `, [productId, row.name, row.description, row.category, row.subcategory,
            row.compatibility, row.active]);
        await client.query(`
          INSERT INTO product_variants
            (sku, product_id, name, price_cents, compare_at_cents, stock,
             low_stock_threshold, active, image, delivery_time)
          VALUES ($1,$2,'Standard',$3,$4,$5,3,$6,$7,'')
        `, [row.sku, productId, row.priceCents, row.compareAtCents,
            row.stock, row.active, row.image]);
        await client.query(`
          INSERT INTO inventory (sku, stock) VALUES ($1, $2)
          ON CONFLICT (sku) DO UPDATE SET stock=EXCLUDED.stock, updated_at=now()
        `, [row.sku, row.stock]);
        created++;
      }
    }
    await client.query("COMMIT");
    return { updated, created, total: rows.length };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
