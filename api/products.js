import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { getPool } from "../lib/database.js";
import { requireAdmin } from "../lib/session.js";

let fileCatalog;
async function seedCatalog() {
  if (!fileCatalog) {
    fileCatalog = JSON.parse(await readFile(new URL("../products.json", import.meta.url), "utf8"));
  }
  return fileCatalog;
}

function validOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === (req.headers["x-forwarded-host"] || req.headers.host);
  } catch {
    return false;
  }
}

function cleanText(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

function validateProduct(body) {
  if (!body || typeof body !== "object") throw new Error("Produktdaten ungültig.");
  const name = cleanText(body.name, 180);
  if (!name) throw new Error("Produktname ist erforderlich.");
  const variants = Array.isArray(body.variants) ? body.variants : [];
  if (!variants.length || variants.length > 30) throw new Error("Mindestens eine Variante ist erforderlich.");
  const seen = new Set();
  const result = [];
  for (const variant of variants) {
    const sku = cleanText(variant.sku, 80);
    const variantName = cleanText(variant.name, 120);
    if (!sku || !variantName) throw new Error("Jede Variante braucht SKU und Namen.");
    if (seen.has(sku)) throw new Error("SKU darf nur einmal verwendet werden.");
    seen.add(sku);
    const price = variant.price === null || variant.price === "" ? null : Number(variant.price);
    const compareAt = variant.compareAtPrice === null || variant.compareAtPrice === "" ? null : Number(variant.compareAtPrice);
    if (price !== null && (!Number.isFinite(price) || price < 0 || price > 100000)) {
      throw new Error("Der Variantenpreis ist ungültig.");
    }
    if (compareAt !== null && (!Number.isFinite(compareAt) || compareAt < 0 || compareAt > 100000)) {
      throw new Error("Der Streichpreis ist ungültig.");
    }
    const stock = Number.isInteger(variant.stock) ? variant.stock : Number(variant.stock);
    if (!Number.isInteger(stock) || stock < 0 || stock > 1000000) {
      throw new Error("Der Bestand ist ungültig.");
    }
    const lowStock = Number.isInteger(variant.lowStock) ? variant.lowStock : Number(variant.lowStock);
    if (!Number.isInteger(lowStock) || lowStock < 0 || lowStock > 100000) {
      throw new Error("Der Mindestbestand ist ungültig.");
    }
    result.push({
      sku,
      name: variantName,
      priceCents: price === null ? null : Math.round(price * 100),
      compareAtCents: compareAt === null ? null : Math.round(compareAt * 100),
      stock,
      lowStock,
      active: variant.active !== false,
      image: cleanText(variant.image || "", 500),
      deliveryTime: cleanText(variant.deliveryTime || "", 160)
    });
  }
  return {
    id: cleanText(body.id || "", 100) || `p-${randomUUID()}`,
    name,
    description: cleanText(body.description || "", 2000),
    category: cleanText(body.category || "", 100),
    brand: cleanText(body.brand || "", 100),
    fits: Array.isArray(body.fits) ? body.fits.map((fit) => cleanText(fit, 100)).filter(Boolean).slice(0, 100) : [],
    active: body.active === true,
    variants: result
  };
}

async function dbCatalog(pool) {
  const products = await pool.query(`
    SELECT id, name, description, category, brand, fits, active, created_at, updated_at
    FROM products
    ORDER BY name
  `);
  if (!products.rows.length) {
    const catalog = await seedCatalog();
    for (const product of catalog.products) {
      await upsertProduct(pool, {
        id: product.id,
        name: product.name,
        description: product.description,
        category: "",
        brand: "",
        fits: product.fits || [],
        active: product.active !== false,
        variants: (product.variants || []).map((variant) => ({
          sku: variant.sku,
          name: variant.name,
          priceCents: Number.isFinite(variant.price) ? Math.round(variant.price * 100) : null,
          compareAtCents: null,
          stock: 0,
          lowStock: 3,
          active: variant.price != null,
          image: variant.img || "",
          deliveryTime: ""
        }))
      });
    }
  }
  const result = await pool.query(`
    SELECT p.id, p.name, p.description, p.category, p.brand, p.fits, p.active,
           p.created_at, p.updated_at,
           v.sku, v.name AS variant_name, v.price_cents, v.compare_at_cents,
           v.stock, v.low_stock_threshold, v.active AS variant_active,
           v.image, v.delivery_time
    FROM products p
    LEFT JOIN product_variants v ON v.product_id = p.id
    ORDER BY p.name, v.name
  `);
  const map = new Map();
  for (const row of result.rows) {
    if (!map.has(row.id)) {
      map.set(row.id, {
        id: row.id,
        name: row.name,
        description: row.description,
        category: row.category,
        brand: row.brand,
        fits: row.fits || [],
        active: row.active,
        variants: []
      });
    }
    if (row.sku) {
      map.get(row.id).variants.push({
        sku: row.sku,
        name: row.variant_name,
        price: row.price_cents === null ? null : row.price_cents / 100,
        compareAtPrice: row.compare_at_cents === null ? null : row.compare_at_cents / 100,
        stock: row.stock,
        lowStock: row.low_stock_threshold,
        active: row.variant_active,
        image: row.image,
        deliveryTime: row.delivery_time
      });
    }
  }
  return { products: [...map.values()] };
}

async function upsertProduct(pool, product) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      INSERT INTO products (id, name, description, category, brand, fits, active, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,now())
      ON CONFLICT (id) DO UPDATE SET
        name=EXCLUDED.name, description=EXCLUDED.description, category=EXCLUDED.category,
        brand=EXCLUDED.brand, fits=EXCLUDED.fits, active=EXCLUDED.active, updated_at=now()
    `, [product.id, product.name, product.description, product.category, product.brand,
        JSON.stringify(product.fits), product.active]);

    const existingVariants = await client.query(
      "SELECT sku, stock, low_stock_threshold FROM product_variants WHERE product_id = $1",
      [product.id]
    );
    const stockBySku = new Map(existingVariants.rows.map((row) => [row.sku, row]));
    await client.query("DELETE FROM product_variants WHERE product_id = $1", [product.id]);
    for (const variant of product.variants) {
      const existing = stockBySku.get(variant.sku);
      await client.query(`
        INSERT INTO product_variants
        (sku, product_id, name, price_cents, compare_at_cents, stock, low_stock_threshold, active, image, delivery_time)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `, [variant.sku, product.id, variant.name, variant.priceCents, variant.compareAtCents,
          existing?.stock ?? variant.stock,
          existing?.low_stock_threshold ?? variant.lowStock,
          variant.active, variant.image, variant.deliveryTime]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export default async function handler(req, res) {
  if (!["GET", "POST", "PUT", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, PUT, DELETE");
    return res.status(405).json({ error: "Methode nicht erlaubt." });
  }
  if (!validOrigin(req)) return res.status(403).json({ error: "Ungültige Anfragequelle." });

  if (req.method === "GET") {
    try {
      const pool = getPool();
      return res.status(200).json(await dbCatalog(pool));
    } catch (error) {
      if (error.statusCode === 503) {
        const catalog = await seedCatalog();
        return res.status(200).json({
          products: catalog.products,
          persistent: false,
          notice: "Datenbank nicht eingerichtet: Änderungen werden nicht dauerhaft gespeichert."
        });
      }
      console.error("Katalog konnte nicht geladen werden:", error.code || "database_error");
      return res.status(503).json({ error: "Persistenter Katalog ist derzeit nicht verfügbar." });
    }
  }

  try {
    requireAdmin(req);
  } catch (error) {
    return res.status(error.statusCode || 401).json({ error: error.message });
  }

  let pool;
  try {
    pool = getPool();
  } catch (error) {
    return res.status(error.statusCode || 503).json({ error: error.message });
  }

  if (req.method === "DELETE") {
    const id = req.query.id;
    if (typeof id !== "string" || !id) return res.status(400).json({ error: "Produkt-ID fehlt." });
    try {
      await pool.query("DELETE FROM products WHERE id = $1", [id]);
      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error("Produkt konnte nicht gelöscht werden:", error.code || "database_error");
      return res.status(503).json({ error: "Produkt konnte nicht gelöscht werden." });
    }
  }

  let product;
  try {
    product = validateProduct(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  try {
    await upsertProduct(pool, product);
    return res.status(req.method === "POST" ? 201 : 200).json({ ok: true, product });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Produkt-ID oder SKU ist bereits vorhanden." });
    console.error("Produkt konnte nicht gespeichert werden:", error.code || "database_error");
    return res.status(503).json({ error: "Produkt konnte nicht dauerhaft gespeichert werden." });
  }
}
