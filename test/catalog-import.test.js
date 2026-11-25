import test from "node:test";
import assert from "node:assert/strict";
import { importCatalogRows } from "../lib/catalog-import.js";

const existingRow = {
  sku: "SKU-EXISTING",
  name: "Updated part",
  category: "Motor",
  subcategory: "Cooling",
  description: "Updated description",
  compatibility: "AM6",
  priceCents: 1590,
  compareAtCents: 1990,
  stock: 7,
  active: true,
  image: "https://images.example.com/updated.jpg"
};
const newRow = {
  ...existingRow,
  sku: "SKU-NEW",
  name: "New part",
  compareAtCents: null,
  active: false
};

function fakePool(existingRows) {
  const statements = [];
  const client = {
    async query(sql, values) {
      statements.push({ sql: sql.replace(/\s+/g, " ").trim(), values });
      if (sql.includes("SELECT p.id AS product_id")) return { rows: existingRows };
      return { rows: [] };
    },
    release() {}
  };
  return { statements, connect: async () => client };
}

test("upserts existing SKUs and creates new products transactionally", async () => {
  const pool = fakePool([{
    sku: "SKU-EXISTING",
    product_id: "product-existing",
    variant_name: "Existing variant",
    image: "/images/old.jpg"
  }]);
  const result = await importCatalogRows(pool, [existingRow, newRow]);
  assert.deepEqual(result, { updated: 1, created: 1, total: 2 });
  assert.equal(pool.statements[0].sql, "BEGIN");
  assert.ok(pool.statements.some(({ sql, values }) =>
    sql.startsWith("UPDATE products") && values[6] === "product-existing"
  ));
  assert.ok(pool.statements.some(({ sql, values }) =>
    sql.startsWith("UPDATE product_variants") && values[0] === 1590 && values[2] === 7
  ));
  assert.ok(pool.statements.some(({ sql, values }) =>
    sql.startsWith("INSERT INTO products") && values[1] === "New part" && values[4] === "Cooling"
  ));
  assert.ok(pool.statements.some(({ sql, values }) =>
    sql.startsWith("INSERT INTO product_variants") && values[0] === "SKU-NEW" && values[5] === false
  ));
  assert.equal(pool.statements.at(-1).sql, "COMMIT");
});

test("rolls the whole import back if a database write fails", async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql.replace(/\s+/g, " ").trim());
      if (sql.includes("SELECT p.id AS product_id")) return { rows: [] };
      if (sql.includes("INSERT INTO products")) throw Object.assign(new Error("conflict"), { code: "23505" });
      return { rows: [] };
    },
    release() {}
  };
  await assert.rejects(importCatalogRows({ connect: async () => client }, [newRow]), { code: "23505" });
  assert.equal(statements.at(-1), "ROLLBACK");
});
