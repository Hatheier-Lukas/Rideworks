import { readFile } from "node:fs/promises";
import { getPool } from "./database.js";

export async function loadCatalog() {
  let fileCatalog;
  try {
    fileCatalog = JSON.parse(await readFile(new URL("../products.json", import.meta.url), "utf8"));
  } catch {
    fileCatalog = { products: [] };
  }
  try {
    const pool = getPool();
    const result = await pool.query(`
      SELECT p.id, p.name, p.description AS description, p.fits, p.active,
             v.sku, v.name AS variant_name, v.price_cents, v.active AS variant_active
      FROM products p
      LEFT JOIN product_variants v ON v.product_id = p.id
      WHERE p.active = true
      ORDER BY p.name, v.name
    `);
    if (result.rows.length) {
      const map = new Map();
      for (const row of result.rows) {
        if (!map.has(row.id)) {
          map.set(row.id, {
            id: row.id,
            name: row.name,
            description: row.description,
            fits: row.fits || [],
            active: row.active,
            variants: []
          });
        }
        if (row.sku && row.variant_active && row.price_cents !== null) {
          map.get(row.id).variants.push({
            sku: row.sku,
            name: row.variant_name,
            price: row.price_cents / 100
          });
        }
      }
      return { products: [...map.values()].filter((product) => product.variants.length) };
    }
  } catch (error) {
    if (error.statusCode !== 503) console.error("Persistenter Produktkatalog konnte nicht geladen werden.");
  }
  return fileCatalog;
}
