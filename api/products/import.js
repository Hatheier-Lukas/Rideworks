import { getPool } from "../../lib/database.js";
import { requireAdmin } from "../../lib/session.js";
import { MAX_CATALOG_UPLOAD_BYTES, parseCatalogWorkbook } from "../../lib/xlsx-catalog.js";
import { importCatalogRows } from "../../lib/catalog-import.js";

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: "4mb"
  }
};

async function readUpload(req) {
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
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Methode nicht erlaubt." });
  }
  if (!validOrigin(req)) return res.status(403).json({ error: "Ungültige Anfragequelle." });
  try {
    requireAdmin(req);
  } catch (error) {
    return res.status(error.statusCode || 401).json({ error: error.message });
  }

  let rows;
  try {
    rows = parseCatalogWorkbook(await readUpload(req));
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message || "Excel-Datei ungültig." });
  }

  try {
    const result = await importCatalogRows(getPool(), rows);
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Eine Artikelnummer wurde parallel angelegt. Bitte Datei erneut importieren." });
    }
    console.error("Excel-Katalog konnte nicht importiert werden:", error.code || "catalog_import_error");
    return res.status(503).json({
      error: "Katalogimport fehlgeschlagen. Prüfe, ob die Datenbankmigration 004_excel_catalog_fields.sql angewendet wurde."
    });
  }
}
