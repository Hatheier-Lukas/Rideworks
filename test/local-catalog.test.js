import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLocalCatalog } from "../lib/local-catalog.js";

async function withCatalog(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rideworks-backup-"));
  const filePath = path.join(directory, "products.json");
  await writeFile(filePath, JSON.stringify({ products: [{ id: "old" }] }));
  try {
    await callback(createLocalCatalog(filePath), filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("local catalog atomically mirrors the current database snapshot", async () => {
  await withCatalog(async (backup, filePath) => {
    const snapshot = [{
      id: "from-database",
      name: "Database product",
      variants: [{ sku: "RW-1", price: 12.5, image: "/images/relais.jpeg" }]
    }];
    await backup.replace(snapshot);
    assert.deepEqual(await backup.list(), snapshot);
    assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), { products: snapshot });
  });
});

test("serialized backup refreshes leave the newest database snapshot on disk", async () => {
  await withCatalog(async (backup) => {
    const first = [{ id: "first" }];
    const latest = [{ id: "latest" }];
    await Promise.all([backup.replace(first), backup.replace(latest)]);
    assert.deepEqual(await backup.list(), latest);
    await assert.rejects(backup.replace(null), /muss ein Array/i);
    assert.deepEqual(await backup.list(), latest);
  });
});
