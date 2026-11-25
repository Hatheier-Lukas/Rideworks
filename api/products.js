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

function validateTechnicalDetails(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Technische Details sind ungültig.");
  }
  const limits = {
    productType: 200,
    tuningArea: 200,
    homologation: 200,
    voltage: 100,
    color: 100,
    material: 150,
    glassColor: 100,
    threadOrConnection: 200,
    weight: 100,
    frequency: 150,
    load: 150
  };
  const details = {};
  for (const [field, max] of Object.entries(limits)) {
    if (value[field] === undefined) continue;
    if (typeof value[field] !== "string") throw new Error("Technische Angaben müssen Text sein.");
    details[field] = cleanText(value[field], max);
  }
  if (value.extra !== undefined && !Array.isArray(value.extra)) {
    throw new Error("Zusätzliche technische Angaben sind ungültig.");
  }
  const extra = value.extra || [];
  if (extra.length > 30) throw new Error("Es sind höchstens 30 zusätzliche Tabellenzeilen erlaubt.");
  details.extra = extra.map((spec) => {
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
      throw new Error("Zusätzliche Tabellenzeile ist ungültig.");
    }
    const label = cleanText(spec.label, 100);
    const text = cleanText(spec.value, 300);
    if (!label || !text) throw new Error("Jede zusätzliche Tabellenzeile braucht Merkmal und Wert.");
    return { label, value: text };
  });
  return details;
}

export function validateProduct(body) {
  if (!body || typeof body !== "object") throw new Error("Produktdaten ungültig.");
  const name = cleanText(body.name, 180);
  if (!name) throw new Error("Produktname ist erforderlich.");
  const variants = Array.isArray(body.variants) ? body.variants : [];
  if (!variants.length || variants.length > 30) throw new Error("Mindestens eine Variante ist erforderlich.");
  const seen = new Set();
  const seenPrevious = new Set();
  const result = [];
  for (const variant of variants) {
    const sku = cleanText(variant.sku, 80);
    const variantName = cleanText(variant.name, 120);
    const previousSku = cleanText(variant.previousSku || "", 80);
    if (!sku || !variantName) throw new Error("Jede Variante braucht SKU und Namen.");
    if (seen.has(sku)) throw new Error("SKU darf nur einmal verwendet werden.");
    if (previousSku && previousSku !== sku && seenPrevious.has(previousSku)) {
      throw new Error("Eine bisherige SKU darf nur einmal ersetzt werden.");
    }
    seen.add(sku);
    if (previousSku && previousSku !== sku) seenPrevious.add(previousSku);
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
    const image = typeof variant.image === "string" ? variant.image : "";
    const isDataImage = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image);
    const isLocalImage = image === "" || /^\/images\/[a-z0-9-]+\.(?:jpe?g|png|webp|svg)$/i.test(image);
    let isRemoteImage = false;
    try {
      const parsed = new URL(image);
      isRemoteImage = parsed.protocol === "https:" && !parsed.username && !parsed.password;
    } catch {}
    if ((!isDataImage && !isLocalImage && !isRemoteImage) || image.length > 300000) {
      throw new Error("Produktbild muss eine lokale Shop-Datei, HTTPS-Adresse oder ein gültiges Bild unter 300 KB sein.");
    }
    result.push({
      sku,
      previousSku,
      name: variantName,
      priceCents: price === null ? null : Math.round(price * 100),
      compareAtCents: compareAt === null ? null : Math.round(compareAt * 100),
      stock,
      lowStock,
      active: variant.active !== false,
      image,
      deliveryTime: cleanText(variant.deliveryTime || "", 160)
    });
  }
  return {
    id: cleanText(body.id || "", 100) || `p-${randomUUID()}`,
    name,
    description: cleanText(body.description || "", 2000),
    category: cleanText(body.category || "", 100),
    subcategory: cleanText(body.subcategory || "", 100),
    compatibility: cleanText(body.compatibility || "", 500),
    brand: cleanText(body.brand || "", 100),
    technicalDetails: validateTechnicalDetails(body.technicalDetails),
    fits: Array.isArray(body.fits) ? body.fits.map((fit) => cleanText(fit, 100)).filter(Boolean).slice(0, 100) : [],
    active: body.active === true,
    variants: result
  };
}

export async function dbCatalog(pool) {
  const products = await pool.query(`
    SELECT id, name, description, category, subcategory, compatibility, brand, fits, active, created_at, updated_at
    FROM products
    ORDER BY name
  `);
  const existingIds = new Set(products.rows.map((product) => product.id));
  const catalog = await seedCatalog();
  for (const product of catalog.products) {
    if (existingIds.has(product.id)) continue;
    await upsertProduct(pool, {
      id: product.id,
      name: product.name,
      description: product.description,
      category: "",
      subcategory: "",
      compatibility: "",
      brand: "",
      technicalDetails: product.technicalDetails || {},
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
  const result = await pool.query(`
    SELECT p.id, p.name, p.description, p.category, p.subcategory, p.compatibility,
           p.brand, p.technical_details, p.fits, p.active,
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
        subcategory: row.subcategory,
        compatibility: row.compatibility,
        brand: row.brand,
        technicalDetails: row.technical_details || {},
        fits: row.fits || [],
        fitmentConfirmed: Array.isArray(row.fits) && row.fits.length > 0,
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

export async function upsertProduct(pool, product) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      INSERT INTO products
        (id, name, description, category, subcategory, compatibility, brand, fits, technical_details, active, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,now())
      ON CONFLICT (id) DO UPDATE SET
        name=EXCLUDED.name, description=EXCLUDED.description, category=EXCLUDED.category,
        subcategory=EXCLUDED.subcategory, compatibility=EXCLUDED.compatibility,
        brand=EXCLUDED.brand, fits=EXCLUDED.fits, technical_details=EXCLUDED.technical_details,
        active=EXCLUDED.active, updated_at=now()
    `, [product.id, product.name, product.description, product.category, product.subcategory,
        product.compatibility, product.brand, JSON.stringify(product.fits),
        JSON.stringify(product.technicalDetails), product.active]);

    const existingVariants = await client.query(
      "SELECT sku, stock, low_stock_threshold FROM product_variants WHERE product_id = $1",
      [product.id]
    );
    const stockBySku = new Map(existingVariants.rows.map((row) => [row.sku, row]));
    const inventorySkus = [...new Set(product.variants.flatMap((variant) =>
      [variant.sku, variant.previousSku].filter(Boolean)
    ))];
    const inventoryResult = await client.query(
      "SELECT sku, stock FROM inventory WHERE sku = ANY($1::text[]) FOR UPDATE",
      [inventorySkus]
    );
    const inventoryBySku = new Map(inventoryResult.rows.map((row) => [row.sku, row]));
    await client.query("DELETE FROM product_variants WHERE product_id = $1", [product.id]);
    for (const variant of product.variants) {
      let existing = stockBySku.get(variant.sku);
      if (variant.previousSku && variant.previousSku !== variant.sku) {
        const previous = stockBySku.get(variant.previousSku);
        if (!previous) throw new Error("Die bisherige SKU gehört nicht zu diesem Produkt.");
        if (inventoryBySku.has(variant.sku)) throw new Error("Die neue SKU besitzt bereits einen Lagerbestand.");
        const previousInventory = inventoryBySku.get(variant.previousSku);
        const stock = previousInventory?.stock ?? previous.stock;
        await client.query("INSERT INTO inventory (sku, stock) VALUES ($1, $2)", [variant.sku, stock]);
        if (previousInventory) {
          await client.query("DELETE FROM inventory WHERE sku = $1", [variant.previousSku]);
        }
        existing = { ...previous, stock };
      }
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
      console.error("Katalog konnte nicht geladen werden:", error.code || "database_error");
      const catalog = await seedCatalog();
      return res.status(200).json({
        products: catalog.products,
        persistent: false,
        notice: "Produktkatalog aus Datei geladen. Für dauerhafte Änderungen Datenbank konfigurieren und Migration ausführen."
      });
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
