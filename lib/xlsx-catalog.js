import * as XLSX from "xlsx";

export const MAX_CATALOG_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_CATALOG_ROWS = 5000;

const COLUMNS = [
  ["Artikelnummer", "sku"],
  ["Hauptkategorie", "category"],
  ["Unterkategorie", "subcategory"],
  ["Produktname", "name"],
  ["Kurzbeschreibung", "description"],
  ["Kompatibilität", "compatibility"],
  ["Preis_EUR", "price"],
  ["UVP_EUR", "compareAtPrice"],
  ["Lagerbestand", "stock"],
  ["Aktiv", "active"],
  ["Bild_URL", "image"]
];

const normalizeHeader = (value) => String(value ?? "")
  .normalize("NFKC")
  .trim()
  .toLocaleLowerCase("de-AT")
  .replace(/[\s_-]+/g, "");

function text(value, field, maxLength) {
  const result = String(value ?? "").trim();
  if (result.length > maxLength) throw new Error(`${field} ist länger als ${maxLength} Zeichen.`);
  return result;
}

function money(value, field, optional = false) {
  if (value === null || value === undefined || value === "") {
    if (optional) return null;
    throw new Error(`${field} fehlt.`);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value > 100000) throw new Error(`${field} ist ungültig.`);
    return Math.round(value * 100);
  }
  let normalized = String(value).trim().replace(/[€\s]/g, "");
  if (!normalized) {
    if (optional) return null;
    throw new Error(`${field} fehlt.`);
  }
  if (normalized.includes(",") && normalized.includes(".")) {
    const decimalSeparator = normalized.lastIndexOf(",") > normalized.lastIndexOf(".") ? "," : ".";
    const groupingSeparator = decimalSeparator === "," ? "." : ",";
    normalized = normalized.split(groupingSeparator).join("");
    if (decimalSeparator === ",") normalized = normalized.replace(",", ".");
  } else if (/^\d{1,3}(?:[,.]\d{3})+$/.test(normalized)) {
    normalized = normalized.replace(/[,.]/g, "");
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(",", ".");
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error(`${field} ist ungültig.`);
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount > 100000) throw new Error(`${field} ist ungültig.`);
  return Math.round(amount * 100);
}

function stock(value) {
  if (value === "" || value === null || value === undefined) throw new Error("Lagerbestand fehlt.");
  const raw = String(value ?? "").trim();
  const normalized = /^\d{1,3}(?:[.,]\d{3})+$/.test(raw) ? raw.replace(/[.,]/g, "") : raw;
  const amount = typeof value === "number" ? value : Number(normalized);
  if (!Number.isInteger(amount) || amount < 0 || amount > 1000000) {
    throw new Error("Lagerbestand muss eine ganze Zahl zwischen 0 und 1.000.000 sein.");
  }
  return amount;
}

function active(value) {
  const normalized = String(value ?? "").trim().toLocaleUpperCase("de-AT");
  if (normalized === "JA") return true;
  if (normalized === "NEIN") return false;
  throw new Error('Aktiv muss „JA“ oder „NEIN“ sein.');
}

function imageUrl(value) {
  const image = text(value, "Bild_URL", 2048);
  if (!image) return "";
  if (/^\/images\/[a-z0-9-]+\.(?:jpe?g|png|webp|svg)$/i.test(image)) return image;
  let parsed;
  try {
    parsed = new URL(image);
  } catch {
    throw new Error("Bild_URL muss eine HTTPS-Adresse oder ein lokaler Pfad unter /images/ sein.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("Bild_URL muss eine HTTPS-Adresse ohne Zugangsdaten sein.");
  }
  return parsed.href;
}

export function parseCatalogWorkbook(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.length > MAX_CATALOG_UPLOAD_BYTES) {
    throw new Error("Die XLSX-Datei ist leer oder überschreitet das Limit von 4 MB.");
  }
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", sheetRows: MAX_CATALOG_ROWS + 2, WTF: true });
  } catch {
    throw new Error("Die Datei konnte nicht als gültige XLSX-Arbeitsmappe gelesen werden.");
  }
  const sheet = workbook.Sheets.Produkte;
  if (!sheet) throw new Error('Das Tabellenblatt „Produkte“ fehlt.');
  if (sheet["!ref"]) {
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    if (range.e.c > 99) throw new Error("Das Tabellenblatt enthält mehr als 100 Spalten.");
    if (range.e.r > MAX_CATALOG_ROWS + 1) {
      throw new Error(`Der Import ist auf ${MAX_CATALOG_ROWS} Produktzeilen begrenzt.`);
    }
    for (let row = range.s.r; row <= range.e.r; row++) {
      for (let column = range.s.c; column <= range.e.c; column++) {
        if (sheet[XLSX.utils.encode_cell({ r: row, c: column })]?.f) {
          throw new Error("Formeln werden im Import nicht unterstützt. Bitte Werte in der Excel-Datei einfügen.");
        }
      }
    }
  }
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false, blankrows: true });
  if (!matrix.length) throw new Error("Das Tabellenblatt „Produkte“ enthält keine Kopfzeile.");
  const headers = new Map();
  for (const [index, cell] of matrix[0].entries()) {
    const normalized = normalizeHeader(cell);
    if (!normalized) continue;
    if (headers.has(normalized)) throw new Error(`Die Spalte „${cell}“ ist mehrfach vorhanden.`);
    headers.set(normalized, index);
  }
  const indexes = {};
  const missing = [];
  for (const [label, key] of COLUMNS) {
    const index = headers.get(normalizeHeader(label));
    if (index === undefined) missing.push(label);
    else indexes[key] = index;
  }
  if (missing.length) throw new Error(`Diese Spalten fehlen: ${missing.join(", ")}.`);
  if (matrix.length < 2) throw new Error("Das Tabellenblatt „Produkte“ enthält keine Produktzeilen.");
  if (matrix.length - 1 > MAX_CATALOG_ROWS) {
    throw new Error(`Der Import ist auf ${MAX_CATALOG_ROWS} Produktzeilen begrenzt.`);
  }

  const rows = [];
  const seenSkus = new Set();
  for (const [offset, cells] of matrix.slice(1).entries()) {
    if (cells.every((cell) => cell === "" || cell === null || cell === undefined)) continue;
    const line = offset + 2;
    try {
      const get = (key) => cells[indexes[key]] ?? "";
      const sku = text(get("sku"), "Artikelnummer", 80);
      const name = text(get("name"), "Produktname", 180);
      if (!sku) throw new Error("Artikelnummer fehlt.");
      if (!name) throw new Error("Produktname fehlt.");
      if (seenSkus.has(sku)) throw new Error(`Artikelnummer „${sku}“ ist in der Datei doppelt vorhanden.`);
      seenSkus.add(sku);
      rows.push({
        sku,
        category: text(get("category"), "Hauptkategorie", 100),
        subcategory: text(get("subcategory"), "Unterkategorie", 100),
        name,
        description: text(get("description"), "Kurzbeschreibung", 2000),
        compatibility: text(get("compatibility"), "Kompatibilität", 500),
        priceCents: money(get("price"), "Preis_EUR"),
        compareAtCents: money(get("compareAtPrice"), "UVP_EUR", true),
        stock: stock(get("stock")),
        active: active(get("active")),
        image: imageUrl(get("image")),
        rowNumber: line
      });
    } catch (error) {
      throw new Error(`Zeile ${line}: ${error.message}`);
    }
  }
  if (!rows.length) throw new Error("Es wurden keine Produktzeilen mit Artikelnummer gefunden.");
  return rows;
}

export function createCatalogWorkbook(rows) {
  const records = rows.map((row) => ({
    Artikelnummer: row.sku,
    Hauptkategorie: row.category || "",
    Unterkategorie: row.subcategory || "",
    Produktname: row.name,
    Kurzbeschreibung: row.description || "",
    "Kompatibilität": row.compatibility || "",
    Preis_EUR: row.priceCents == null ? "" : row.priceCents / 100,
    UVP_EUR: row.compareAtCents == null ? "" : row.compareAtCents / 100,
    Lagerbestand: row.stock ?? 0,
    Aktiv: row.active ? "JA" : "NEIN",
    Bild_URL: row.image || ""
  }));
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(records, { header: COLUMNS.map(([label]) => label) });
  XLSX.utils.book_append_sheet(workbook, sheet, "Produkte");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}
