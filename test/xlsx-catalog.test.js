import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { createCatalogWorkbook, parseCatalogWorkbook } from "../lib/xlsx-catalog.js";

const headers = [
  "Artikelnummer", "Hauptkategorie", "Unterkategorie", "Produktname", "Kurzbeschreibung",
  "Kompatibilität", "Preis_EUR", "UVP_EUR", "Lagerbestand", "Aktiv", "Bild_URL"
];

function workbookBuffer(rows, sheetName = "Produkte") {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, ...rows]), sheetName);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

test("parses the Produkte worksheet and maps catalog fields with localized numbers", () => {
  const result = parseCatalogWorkbook(workbookBuffer([[
    "00123", "Motor & Kühlung", "Temperatur", "Digital Thermometer", "Für 50 ccm",
    "AM6, D50B0", "1.234,50", "1.499,00", "12", "JA", "https://images.example.com/item.jpg"
  ]]));
  assert.deepEqual(result, [{
    sku: "00123",
    category: "Motor & Kühlung",
    subcategory: "Temperatur",
    name: "Digital Thermometer",
    description: "Für 50 ccm",
    compatibility: "AM6, D50B0",
    priceCents: 123450,
    compareAtCents: 149900,
    stock: 12,
    active: true,
    image: "https://images.example.com/item.jpg",
    rowNumber: 2
  }]);
});

test("requires the named worksheet and every mapped column", () => {
  assert.throws(() => parseCatalogWorkbook(workbookBuffer([], "Sheet1")), /Tabellenblatt „Produkte“ fehlt/);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Artikelnummer", "Produktname"]]), "Produkte");
  assert.throws(
    () => parseCatalogWorkbook(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })),
    /Diese Spalten fehlen/
  );
});

test("rejects duplicate SKUs, invalid values, formulas, and non-HTTPS image URLs", () => {
  const valid = ["SKU-1", "Motor", "Temperatur", "Thermometer", "", "", 10, "", 3, "JA", ""];
  assert.throws(() => parseCatalogWorkbook(workbookBuffer([valid, valid])), /Artikelnummer „SKU-1“ ist .*doppelt/);
  assert.throws(() => parseCatalogWorkbook(workbookBuffer([["SKU-2", "Motor", "", "Part", "", "", "x", "", 0, "JA", ""]])), /Preis_EUR ist ungültig/);
  assert.throws(() => parseCatalogWorkbook(workbookBuffer([["SKU-2", "Motor", "", "Part", "", "", 10, "", 0, "yes", ""]])), /Aktiv muss/);
  assert.throws(() => parseCatalogWorkbook(workbookBuffer([["SKU-2", "Motor", "", "Part", "", "", 10, "", 0, "JA", "http://images.example.com/item.jpg"]])), /HTTPS-Adresse/);

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([headers, valid]);
  sheet.K2 = { t: "n", f: "1+1", v: 2 };
  XLSX.utils.book_append_sheet(workbook, sheet, "Produkte");
  assert.throws(
    () => parseCatalogWorkbook(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })),
    /Formeln werden/
  );
});

test("exports an import-compatible workbook with the expected worksheet", () => {
  const buffer = createCatalogWorkbook([{
    sku: "SKU-EXPORT",
    category: "Elektronik",
    subcategory: "Ladegeräte",
    name: "USB-Lader",
    description: "12 V",
    compatibility: "Vor Bestellung prüfen",
    priceCents: 1290,
    compareAtCents: null,
    stock: 4,
    active: false,
    image: ""
  }]);
  const workbook = XLSX.read(buffer, { type: "buffer" });
  assert.deepEqual(workbook.SheetNames, ["Produkte"]);
  const [row] = parseCatalogWorkbook(buffer);
  assert.equal(row.sku, "SKU-EXPORT");
  assert.equal(row.priceCents, 1290);
  assert.equal(row.active, false);
  assert.equal(row.compatibility, "Vor Bestellung prüfen");
});
