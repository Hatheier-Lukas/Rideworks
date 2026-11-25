import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { COOKIE_NAME, getSession, requireAdmin, sign } from "./lib/session.js";
import { isValidPasswordHash, verifyPassword } from "./lib/password.js";
import { createLocalCatalog } from "./lib/local-catalog.js";
import { getPool } from "./lib/database.js";
import { dbCatalog, upsertProduct, validateProduct } from "./api/products.js";
import { loadLocalEnvironment } from "./lib/load-local-env.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const catalog = createLocalCatalog(path.join(root, "products.json"));
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

function backupProducts(products) {
  return products.map(({ variants, ...product }) => ({
    ...product,
    variants: variants.map(({ image, img, ...variant }) => ({
      ...variant,
      img: image || img || ""
    }))
  }));
}

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

async function handleApi(req, res, url) {
  if (!validOrigin(req)) return sendJson(res, 403, { error: "Ungültige Anfragequelle." });

  if (url.pathname === "/api/products") {
    if (req.method === "GET") {
      try {
        const snapshot = await dbCatalog(getPool());
        let backupWarning = "";
        try {
          await catalog.replace(backupProducts(snapshot.products));
        } catch {
          backupWarning = " Die lokale Backup-Datei konnte nicht aktualisiert werden.";
          console.error("Lokales Produkt-Backup konnte nicht aktualisiert werden.");
        }
        return sendJson(res, 200, {
          products: snapshot.products,
          persistent: true,
          localBackup: true,
          notice: `PostgreSQL ist die primäre Produktquelle; products.json ist das lokale Backup.${backupWarning}`
        });
      } catch (error) {
        console.error("PostgreSQL-Produktkatalog nicht verfügbar:", error.code || "database_error");
        try {
          return sendJson(res, 200, {
            products: await catalog.list(),
            persistent: false,
            localWritable: true,
            notice: "PostgreSQL ist nicht verfügbar. Änderungen werden nur lokal in products.json auf diesem Gerät gespeichert."
          });
        } catch {
          return sendJson(res, 503, {
            error: "PostgreSQL ist nicht verfügbar und das lokale Produkt-Backup konnte nicht gelesen werden."
          });
        }
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

    let id;
    let product;
    if (req.method === "DELETE") {
      id = url.searchParams.get("id");
      if (!id) return sendJson(res, 400, { error: "Produkt-ID fehlt." });
    } else {
      try {
        product = validateProduct(await readJson(req));
      } catch (error) {
        return sendJson(res, error.statusCode || 400, { error: error.message || "Produktdaten ungültig." });
      }
    }

    const saveLocally = async () => {
      try {
        if (req.method === "DELETE") await catalog.deleteProduct(id);
        else await catalog.upsertProduct(product);
        return sendJson(res, req.method === "POST" ? 201 : 200, {
          ok: true,
          localOnly: true,
          notice: "Produkt nur lokal in products.json auf diesem Gerät gespeichert; nicht mit PostgreSQL oder der Live-Website synchronisiert."
        });
      } catch {
        console.error("Produktänderung konnte nicht im lokalen Backup gespeichert werden.");
        return sendJson(res, 503, { error: "PostgreSQL ist nicht verfügbar und die lokale Speicherung in products.json ist fehlgeschlagen." });
      }
    };

    let pool;
    try {
      pool = getPool();
    } catch {
      return saveLocally();
    }

    try {
      if (req.method === "DELETE") {
        await pool.query("DELETE FROM products WHERE id = $1", [id]);
      } else {
        await upsertProduct(pool, product);
      }

      let backupWarning = "";
      try {
        const snapshot = await dbCatalog(pool);
        await catalog.replace(backupProducts(snapshot.products));
      } catch {
        backupWarning = " Die Änderung ist in PostgreSQL gespeichert, aber das lokale Backup konnte nicht aktualisiert werden.";
        console.error("Datenbankänderung gespeichert; lokales Produkt-Backup konnte nicht aktualisiert werden.");
      }
      return sendJson(res, req.method === "POST" ? 201 : 200, { ok: true, backupWarning });
    } catch (error) {
      if (error.code === "23505") return sendJson(res, 409, { error: "Produkt-ID oder SKU ist bereits vorhanden." });
      console.error("Produktänderung in PostgreSQL fehlgeschlagen:", error.code || "database_error");
      return saveLocally();
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
  console.log("PostgreSQL ist die Produktquelle; products.json ist das lokale Backup. Dieser Server ist nur auf diesem Laptop erreichbar.");
});
