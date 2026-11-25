import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export function createLocalStore(directory, seedFile) {
  const files = {
    products: path.join(directory, "products.json"),
    drafts: path.join(directory, "drafts.json"),
    inventory: path.join(directory, "inventory.json")
  };
  let initialization;
  let writes = Promise.resolve();

  async function writeJson(file, value) {
    const temporaryPath = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx"
      });
      await rename(temporaryPath, file);
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      throw error;
    }
  }

  async function readJson(file, key) {
    const value = JSON.parse(await readFile(file, "utf8"));
    if (!Array.isArray(value[key])) throw new Error(`Lokale Datei ${path.basename(file)} enthält kein ${key}-Array.`);
    return value[key];
  }

  async function readInventory() {
    const value = JSON.parse(await readFile(files.inventory, "utf8"));
    if (!value.inventory || typeof value.inventory !== "object" || Array.isArray(value.inventory)) {
      throw new Error("Lokale Lagerdatei enthält kein inventory-Objekt.");
    }
    return Object.assign(Object.create(null), value.inventory);
  }

  function normalizeSeedProduct(product) {
    const description = product.description || product.desc || "";
    return {
      ...product,
      description,
      desc: description,
      variants: (product.variants || []).map((variant) => ({
        ...variant,
        price: variant.price == null ? null : Number(variant.price),
        stock: Number.isInteger(variant.stock) && variant.stock >= 0 ? variant.stock : 0,
        lowStock: Number.isInteger(variant.lowStock) && variant.lowStock >= 0 ? variant.lowStock : 3,
        img: variant.image || variant.img || ""
      }))
    };
  }

  async function initializeFiles() {
    await mkdir(directory, { recursive: true });
    let currentProducts;
    try {
      currentProducts = await readJson(files.products, "products");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const seedData = JSON.parse(await readFile(seedFile, "utf8"));
      if (!Array.isArray(seedData.products)) throw new Error("products.json enthält kein products-Array.");
      currentProducts = seedData.products.map(normalizeSeedProduct);
      await writeJson(files.products, { products: currentProducts });
    }

    try {
      await readJson(files.drafts, "drafts");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await writeJson(files.drafts, { drafts: currentProducts.filter((product) => product.active === false) });
    }

    try {
      await readInventory();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const inventory = Object.create(null);
      for (const product of currentProducts) {
        for (const variant of product.variants || []) {
          if (variant.sku) inventory[variant.sku] = variant.stock ?? 0;
        }
      }
      await writeJson(files.inventory, { inventory });
    }
  }

  function ensureInitialized() {
    if (!initialization) initialization = initializeFiles();
    return initialization;
  }

  function enqueueWrite(operation) {
    const result = writes.then(async () => {
      await ensureInitialized();
      return operation();
    });
    writes = result.catch(() => {});
    return result;
  }

  function withInventory(products, inventory) {
    return products.map((product) => ({
      ...product,
      variants: (product.variants || []).map((variant) => ({
        ...variant,
        stock: Object.hasOwn(inventory, variant.sku) ? inventory[variant.sku] : variant.stock ?? 0
      }))
    }));
  }

  function serializeProduct(product, existing, inventory, isDraft) {
    const description = product.description || "";
    return {
      ...existing,
      id: product.id,
      name: product.name,
      description,
      desc: description,
      category: product.category,
      brand: product.brand,
      technicalDetails: product.technicalDetails || existing.technicalDetails || {},
      fits: product.fits,
      fitmentConfirmed: product.fits.length > 0,
      active: !isDraft && product.active,
      variants: product.variants.map((variant) => ({
        sku: variant.sku,
        name: variant.name,
        price: variant.priceCents === null ? null : variant.priceCents / 100,
        compareAtPrice: variant.compareAtCents === null ? null : variant.compareAtCents / 100,
        stock: Object.hasOwn(inventory, variant.sku) ? inventory[variant.sku] : variant.stock,
        lowStock: variant.lowStock,
        active: variant.active,
        img: variant.image || "",
        deliveryTime: variant.deliveryTime
      }))
    };
  }

  async function saveProduct(product, isDraft = false) {
    return enqueueWrite(async () => {
      const products = await readJson(files.products, "products");
      const drafts = await readJson(files.drafts, "drafts");
      const inventory = await readInventory();
      for (const variant of product.variants) {
        const previousSku = variant.previousSku;
        if (!previousSku || previousSku === variant.sku || !Object.hasOwn(inventory, previousSku)) continue;
        if (Object.hasOwn(inventory, variant.sku)) {
          throw new Error("Die neue SKU besitzt bereits einen Lagerbestand.");
        }
        inventory[variant.sku] = inventory[previousSku];
        delete inventory[previousSku];
      }
      const index = products.findIndex((entry) => entry.id === product.id);
      const existing = index < 0 ? {} : products[index];
      const saved = serializeProduct(product, existing, inventory, isDraft);
      for (const variant of saved.variants) {
        if (!Object.hasOwn(inventory, variant.sku)) inventory[variant.sku] = variant.stock;
      }
      saved.variants = saved.variants.map((variant) => ({
        ...variant,
        stock: inventory[variant.sku]
      }));
      if (index < 0) products.push(saved);
      else products[index] = saved;

      const nextDrafts = drafts.filter((entry) => entry.id !== saved.id);
      if (isDraft || saved.active === false) nextDrafts.push(saved);

      await writeJson(files.products, { products });
      await writeJson(files.drafts, { drafts: nextDrafts });
      await writeJson(files.inventory, { inventory });
      return saved;
    });
  }

  async function removeProduct(id) {
    return enqueueWrite(async () => {
      const products = await readJson(files.products, "products");
      const drafts = await readJson(files.drafts, "drafts");
      await writeJson(files.products, { products: products.filter((product) => product.id !== id) });
      await writeJson(files.drafts, { drafts: drafts.filter((draft) => draft.id !== id) });
    });
  }

  return {
    async initialize() {
      await ensureInitialized();
    },

    async listProducts() {
      await writes;
      await ensureInitialized();
      return withInventory(await readJson(files.products, "products"), await readInventory());
    },

    async listDrafts() {
      await writes;
      await ensureInitialized();
      return withInventory(await readJson(files.drafts, "drafts"), await readInventory());
    },

    async saveProduct(product) {
      return saveProduct(product);
    },

    async saveDraft(product) {
      return saveProduct({ ...product, active: false }, true);
    },

    async deleteProduct(id) {
      return removeProduct(id);
    },

    async deleteDraft(id) {
      return removeProduct(id);
    },

    async listInventory() {
      await writes;
      await ensureInitialized();
      return readInventory();
    },

    async updateInventory(sku, stock) {
      return enqueueWrite(async () => {
        if (typeof sku !== "string" || !sku.trim() || sku.length > 80 ||
            !Number.isInteger(stock) || stock < 0 || stock > 1000000) {
          throw new Error("SKU oder Lagerbestand ist ungültig.");
        }
        const inventory = await readInventory();
        inventory[sku.trim()] = stock;
        await writeJson(files.inventory, { inventory });
        return inventory[sku.trim()];
      });
    }
  };
}
