import { getPool } from "../../lib/database.js";
import { requireAdmin } from "../../lib/session.js";
import { createCatalogWorkbook } from "../../lib/xlsx-catalog.js";

function validOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === (req.headers["x-forwarded-host"] || req.headers.host);
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Methode nicht erlaubt." });
  }
  if (!validOrigin(req)) return res.status(403).json({ error: "Ungültige Anfragequelle." });
  try {
    requireAdmin(req);
  } catch (error) {
    return res.status(error.statusCode || 401).json({ error: error.message });
  }
  try {
    const pool = getPool();
    const result = await pool.query(`
      SELECT p.category, p.subcategory, p.name, p.description, p.compatibility, p.active,
             v.sku, v.price_cents, v.compare_at_cents, v.stock, v.active AS variant_active, v.image
      FROM products p
      JOIN product_variants v ON v.product_id = p.id
      ORDER BY p.name, v.name
    `);
    const workbook = createCatalogWorkbook(result.rows.map((row) => ({
      sku: row.sku,
      category: row.category,
      subcategory: row.subcategory,
      name: row.name,
      description: row.description,
      compatibility: row.compatibility,
      priceCents: row.price_cents,
      compareAtCents: row.compare_at_cents,
      stock: row.stock,
      active: row.active && row.variant_active,
      image: row.image
    })));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Rideworks_Artikelkatalog.xlsx"');
    res.setHeader("Content-Length", workbook.length);
    return res.status(200).send(workbook);
  } catch (error) {
    console.error("Excel-Katalog konnte nicht exportiert werden:", error.code || "catalog_export_error");
    return res.status(503).json({ error: "Der Katalog konnte nicht aus der Datenbank exportiert werden." });
  }
}
