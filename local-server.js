import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { COOKIE_NAME, getSession, requireAdmin, sign } from "./lib/session.js";
import { isValidPasswordHash, verifyPassword } from "./lib/password.js";
import { createLocalStore } from "./lib/local-store.js";
import { validateProduct } from "./api/products.js";
import { loadLocalEnvironment } from "./lib/load-local-env.js";
import { createCatalogWorkbook, MAX_CATALOG_UPLOAD_BYTES, parseCatalogWorkbook } from "./lib/xlsx-catalog.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const store = createLocalStore(path.join(root, "data"), path.join(root, "products.json"));
const port = Number(process.env.PORT || 4173);
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const STATIC_ROOT_FILES = new Set(["index.html", "shop.html", "order.js"]);
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

function sendJson(res, status, value, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(value));
}

function validOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function isAdmin(session) {
  const email = (process.env.GOOGLE_ADMIN_EMAIL || "hatheierlukas@gmail.com").toLowerCase();
  return Boolean(session && session.email?.toLowerCase() === email);
}

function clearLocalSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function localSessionCookie(token, expiresAt) {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      throw Object.assign(new Error("Anfrage ist zu groß."), { statusCode: 413 });
    }
  }
  try {
    return JSON.parse(body);
  } catch {
    throw Object.assign(new Error("Ungültiges JSON."), { statusCode: 400 });
  }
}

async function readBuffer(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_CATALOG_UPLOAD_BYTES) {
      throw Object.assign(new Error("Die XLSX-Datei darf höchstens 4 MB groß sein."), { statusCode: 413 });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function handleApi(req, res, url) {
  if (!validOrigin(req)) return sendJson(res, 403, { error: "Ungültige Anfragequelle." });

  if (url.pathname === "/api/products/import") {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return sendJson(res, 405, { error: "Methode nicht erlaubt." });
    }
    try {
      requireAdmin(req);
    } catch (error) {
      return sendJson(res, error.statusCode || 401, { error: error.message });
    }
    try {
      const rows = parseCatalogWorkbook(await readBuffer(req));
      const catalog = await store.listProducts();
      const bySku = new Map(catalog.flatMap((product) =>
        (product.variants || []).map((variant) => [variant.sku, product])
      ));
      let updated = 0;
      let created = 0;
      for (const row of rows) {
        const existing = bySku.get(row.sku);
        const variants = (existing?.variants || []).map((variant) => {
          const current = variant.sku === row.sku;
          return {
            sku: variant.sku,
            name: variant.name || "Standard",
            price: current ? row.priceCents / 100 : variant.price,
            compareAtPrice: current ? (row.compareAtCents === null ? null : row.compareAtCents / 100) : variant.compareAtPrice,
            stock: current ? row.stock : variant.stock,
            lowStock: Number.isInteger(variant.lowStock) ? variant.lowStock : 3,
            active: current ? row.active : variant.active !== false,
            image: current ? row.image : variant.image || variant.img || "",
            deliveryTime: variant.deliveryTime || ""
          };
        });
        if (!existing) {
          variants.push({
            sku: row.sku,
            name: "Standard",
            price: row.priceCents / 100,
            compareAtPrice: row.compareAtCents === null ? null : row.compareAtCents / 100,
            stock: row.stock,
            lowStock: 3,
            active: row.active,
            image: row.image,
            deliveryTime: ""
          });
        }
        const product = validateProduct({
          id: existing?.id || `xlsx-${randomUUID()}`,
          name: row.name,
          description: row.description,
          category: row.category,
          subcategory: row.subcategory,
          compatibility: row.compatibility,
          brand: existing?.brand || "",
          technicalDetails: existing?.technicalDetails || {},
          fits: existing?.fits || [],
          active: row.active,
          variants
        });
        const saved = await store.saveProduct(product);
        await store.updateInventory(row.sku, row.stock);
        const currentProduct = {
          ...saved,
          variants: saved.variants.map((variant) => variant.sku === row.sku
            ? { ...variant, stock: row.stock }
            : variant)
        };
        for (const variant of currentProduct.variants) bySku.set(variant.sku, currentProduct);
        if (existing) updated++;
        else created++;
      }
      return sendJson(res, 200, { ok: true, updated, created, total: rows.length, localOnly: true });
    } catch (error) {
      if (error.statusCode) return sendJson(res, error.statusCode, { error: error.message });
      console.error("Lokaler Excel-Katalogimport fehlgeschlagen.");
      return sendJson(res, 400, { error: error.message || "Excel-Katalog konnte nicht importiert werden." });
    }
  }

  if (url.pathname === "/api/products/export") {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return sendJson(res, 405, { error: "Methode nicht erlaubt." });
    }
    try {
      requireAdmin(req);
    } catch (error) {
      return sendJson(res, error.statusCode || 401, { error: error.message });
    }
    try {
      const products = await store.listProducts();
      const rows = products.flatMap((product) => (product.variants || []).map((variant) => ({
        sku: variant.sku,
        category: product.category || "",
        subcategory: product.subcategory || "",
        name: product.name,
        description: product.description || "",
        compatibility: product.compatibility || "",
        priceCents: variant.price == null ? null : Math.round(Number(variant.price) * 100),
        compareAtCents: variant.compareAtPrice == null ? null : Math.round(Number(variant.compareAtPrice) * 100),
        stock: variant.stock ?? 0,
        active: product.active !== false && variant.active !== false,
        image: variant.image || variant.img || ""
      })));
      const workbook = createCatalogWorkbook(rows);
      res.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="Rideworks_Artikelkatalog.xlsx"',
        "Content-Length": workbook.length,
        "Cache-Control": "no-store"
      });
      return res.end(workbook);
    } catch {
      return sendJson(res, 503, { error: "Der lokale Katalog konnte nicht exportiert werden." });
    }
  }

  if (url.pathname === "/api/products") {
    if (req.method === "GET") {
      try {
        return sendJson(res, 200, {
          products: await store.listProducts(),
          persistent: true,
          localOnly: true,
          notice: "Produkte werden lokal in data/products.json gespeichert."
        });
      } catch {
        console.error("Lokaler Produktkatalog konnte nicht gelesen werden.");
        return sendJson(res, 503, { error: "Lokaler Produktkatalog konnte nicht gelesen werden." });
      }
    }

    if (!["POST", "PUT", "DELETE"].includes(req.method)) {
      res.setHeader("Allow", "GET, POST, PUT, DELETE");
      return sendJson(res, 405, { error: "Methode nicht erlaubt." });
    }

    try {
      requireAdmin(req);
    } catch (error) {
      return sendJson(res, error.statusCode || 401, { error: error.message });
    }

    try {
      if (req.method === "DELETE") {
        const id = url.searchParams.get("id");
        if (!id) return sendJson(res, 400, { error: "Produkt-ID fehlt." });
        await store.deleteProduct(id);
      } else {
        const product = validateProduct(await readJson(req));
        await store.saveProduct(product);
      }
      return sendJson(res, req.method === "POST" ? 201 : 200, {
        ok: true,
        persistent: true,
        localOnly: true,
        notice: "Produkt dauerhaft lokal in data/products.json gespeichert."
      });
    } catch (error) {
      if (error.code === "23505") return sendJson(res, 409, { error: "Produkt-ID oder SKU ist bereits vorhanden." });
      if (error.statusCode) return sendJson(res, error.statusCode, { error: error.message });
      console.error("Lokale Produktänderung fehlgeschlagen.");
      return sendJson(res, 503, { error: "Produkt konnte nicht lokal gespeichert werden." });
    }
  }

  if (url.pathname === "/api/drafts") {
    try {
      requireAdmin(req);
    } catch (error) {
      return sendJson(res, error.statusCode || 401, { error: error.message });
    }
    if (!["GET", "POST", "PUT", "DELETE"].includes(req.method)) {
      res.setHeader("Allow", "GET, POST, PUT, DELETE");
      return sendJson(res, 405, { error: "Methode nicht erlaubt." });
    }
    if (req.method === "GET") {
      try {
        return sendJson(res, 200, { drafts: await store.listDrafts(), persistent: true, localOnly: true });
      } catch {
        return sendJson(res, 503, { error: "Entwürfe konnten nicht lokal gelesen werden." });
      }
    }
    try {
      if (req.method === "DELETE") {
        const id = url.searchParams.get("id");
        if (!id) return sendJson(res, 400, { error: "Entwurfs-ID fehlt." });
        await store.deleteDraft(id);
      } else {
        const product = validateProduct(await readJson(req));
        await store.saveDraft(product);
      }
      return sendJson(res, req.method === "POST" ? 201 : 200, { ok: true, persistent: true, localOnly: true });
    } catch (error) {
      if (error.statusCode) return sendJson(res, error.statusCode, { error: error.message });
      console.error("Lokale Entwurfsänderung fehlgeschlagen.");
      return sendJson(res, 503, { error: "Entwurf konnte nicht lokal gespeichert werden." });
    }
  }

  if (url.pathname === "/api/inventory") {
    try {
      requireAdmin(req);
    } catch (error) {
      return sendJson(res, error.statusCode || 401, { error: error.message });
    }
    if (req.method === "GET") {
      try {
        return sendJson(res, 200, { inventory: await store.listInventory(), persistent: true, localOnly: true });
      } catch {
        return sendJson(res, 503, { error: "Lagerbestand konnte nicht lokal gelesen werden." });
      }
    }
    if (req.method !== "PUT") {
      res.setHeader("Allow", "GET, PUT");
      return sendJson(res, 405, { error: "Methode nicht erlaubt." });
    }
    try {
      const { sku, stock } = await readJson(req);
      await store.updateInventory(sku, stock);
      return sendJson(res, 200, { ok: true, persistent: true, localOnly: true });
    } catch (error) {
      if (error.statusCode) return sendJson(res, error.statusCode, { error: error.message });
      console.error("Lokale Lagerbestandsänderung fehlgeschlagen.");
      return sendJson(res, 400, { error: error.message || "Lagerbestand ungültig." });
    }
  }

  if (url.pathname === "/api/auth/session") {
    if (req.method === "GET") {
      let session = null;
      try {
        if (process.env.SESSION_SECRET) session = getSession(req);
      } catch {
        session = null;
      }
      return sendJson(res, 200, { admin: isAdmin(session) }, { "Cache-Control": "no-store" });
    }
    if (req.method === "DELETE") {
      res.setHeader("Set-Cookie", clearLocalSessionCookie());
      return sendJson(res, 200, { admin: false }, { "Cache-Control": "no-store" });
    }
    res.setHeader("Allow", "GET, DELETE");
    return sendJson(res, 405, { error: "Methode nicht erlaubt." });
  }

  if (url.pathname === "/api/auth/login") {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return sendJson(res, 405, { error: "Methode nicht erlaubt." });
    }
    const body = await readJson(req);
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const adminUsername = process.env.ADMIN_USERNAME || "admin";
    const passwordHash = process.env.ADMIN_PASSWORD_HASH;
    const sessionSecret = process.env.SESSION_SECRET;
    if (!isValidPasswordHash(passwordHash) || !sessionSecret) {
      return sendJson(res, 503, { error: "Lokaler Admin-Login ist nicht eingerichtet. Prüfe ADMIN_PASSWORD_HASH und SESSION_SECRET in .env.local." });
    }
    if (!username || username.length > 120 || !password || password.length > 256) {
      return sendJson(res, 400, { error: "Benutzername und Passwort sind erforderlich." });
    }
    const email = (process.env.GOOGLE_ADMIN_EMAIL || "hatheierlukas@gmail.com").toLowerCase();
    const usernameMatches = username.toLowerCase() === adminUsername.toLowerCase() || username.toLowerCase() === email;
    if (!usernameMatches || !(await verifyPassword(password, passwordHash))) {
      return sendJson(res, 401, { error: "Benutzername oder Passwort ist falsch." });
    }
    const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
    const token = sign({ email, expiresAt, authMethod: "password", sessionId: randomBytes(16).toString("base64url") });
    res.setHeader("Set-Cookie", localSessionCookie(token, expiresAt));
    return sendJson(res, 200, { admin: true }, { "Cache-Control": "no-store" });
  }

  if (url.pathname === "/api/order") {
    return sendJson(res, 503, {
      error: "Bestellungen werden vom lokalen Entwicklungsserver nicht verarbeitet. Für echte Bestellungen den deployten Checkout mit Datenbank und E-Mail-Konfiguration verwenden."
    });
  }

  return sendJson(res, 404, { error: "API-Endpunkt nicht gefunden." });
}

async function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return sendJson(res, 405, { error: "Methode nicht erlaubt." });
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end("Ungültiger Pfad.");
    return;
  }
  if (pathname.split(/[\\/]+/).some((part) => part.startsWith(".") || part === "api")) {
    res.writeHead(404).end("Nicht gefunden.");
    return;
  }
  const pathParts = pathname === "/" ? ["index.html"] : pathname.replace(/^[/\\]+/, "").split(/[\\/]+/);
  if (pathParts[0] !== "images" && !(pathParts.length === 1 && STATIC_ROOT_FILES.has(pathParts[0]))) {
    res.writeHead(404).end("Nicht gefunden.");
    return;
  }
  const relativePath = path.join(...pathParts);
  const absolutePath = path.resolve(root, relativePath);
  if (!absolutePath.startsWith(`${root}${path.sep}`)) {
    res.writeHead(404).end("Nicht gefunden.");
    return;
  }
  const extension = path.extname(absolutePath).toLowerCase();
  if (!MIME_TYPES[extension]) {
    res.writeHead(404).end("Nicht gefunden.");
    return;
  }
  try {
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) throw new Error("Not a file");
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extension],
      "Content-Length": fileStat.size,
      "X-Content-Type-Options": "nosniff"
    });
    if (req.method === "HEAD") return res.end();
    createReadStream(absolutePath).pipe(res);
  } catch (error) {
    res.writeHead(error.code === "ENOENT" ? 404 : 500).end(error.code === "ENOENT" ? "Nicht gefunden." : "Datei konnte nicht gelesen werden.");
  }
}

await loadLocalEnvironment(path.join(root, ".env.local"));
await store.initialize();
const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store");
      return await handleApi(req, res, url);
    }
    return await serveStatic(req, res, url);
  } catch (error) {
    if (!res.headersSent) sendJson(res, error.statusCode || 500, { error: error.message || "Lokaler Serverfehler." });
    else res.destroy(error);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Rideworks lokal verfügbar: http://localhost:${port}`);
  console.log("Lokale Produkt-, Entwurfs- und Lagerdaten liegen dauerhaft in data/. Dieser Server ist nur auf diesem Laptop erreichbar.");
});
