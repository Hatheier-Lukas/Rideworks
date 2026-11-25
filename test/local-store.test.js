import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalStore } from "../lib/local-store.js";

const seedFile = fileURLToPath(new URL("../products.json", import.meta.url));

test("local store initializes migration catalog, drafts, and zero stock on first start", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rideworks-local-store-"));
  try {
    const store = createLocalStore(directory, seedFile);
    await store.initialize();

    const products = await store.listProducts();
    const drafts = await store.listDrafts();
    const inventory = await store.listInventory();
    assert.equal(products.length, 15);
    assert.equal(drafts.length, 11);
    assert.equal(Object.keys(inventory).length, 18);
    assert.ok(Object.values(inventory).every((stock) => stock === 0));
    assert.ok(products.some((product) => product.id === "thermometer"));
    assert.ok(drafts.some((draft) => draft.id === "thermometer"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("product, draft, and inventory changes survive store recreation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rideworks-local-store-"));
  try {
    const store = createLocalStore(directory, seedFile);
    await store.initialize();
    await store.saveProduct({
      id: "local-persist-test",
      name: "Persisted product",
      description: "Local file storage",
      category: "Test",
      brand: "Rideworks",
      fits: ["*"],
      active: true,
      variants: [{
        sku: "RW-PERSIST-TEST",
        name: "Standard",
        priceCents: 1590,
        compareAtCents: null,
        stock: 0,
        lowStock: 3,
        active: true,
        image: "",
        deliveryTime: ""
      }]
    });
    await store.updateInventory("RW-PERSIST-TEST", 7);
    await store.saveDraft({
      id: "local-draft-test",
      name: "Persisted draft",
      description: "",
      category: "",
      brand: "",
      fits: [],
      active: true,
      variants: [{
        sku: "RW-DRAFT-TEST",
        name: "Draft variant",
        priceCents: null,
        compareAtCents: null,
        stock: 0,
        lowStock: 3,
        active: false,
        image: "",
        deliveryTime: ""
      }]
    });

    const restarted = createLocalStore(directory, seedFile);
    const products = await restarted.listProducts();
    assert.equal(products.find((product) => product.id === "local-persist-test").variants[0].stock, 7);
    assert.ok((await restarted.listDrafts()).some((draft) => draft.id === "local-draft-test"));
    assert.deepEqual(
      JSON.parse(await readFile(path.join(directory, "inventory.json"), "utf8")).inventory["RW-PERSIST-TEST"],
      7
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
