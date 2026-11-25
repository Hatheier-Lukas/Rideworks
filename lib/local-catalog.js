import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";

export function createLocalCatalog(filePath) {
  let writes = Promise.resolve();

  async function readProducts() {
    const data = JSON.parse(await readFile(filePath, "utf8"));
    if (!Array.isArray(data.products)) throw new Error("Produktdatei hat kein products-Array.");
    return data.products;
  }

  async function writeProducts(products) {
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify({ products }, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx"
      });
      await rename(temporaryPath, filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      throw error;
    }
  }

  function enqueueWrite(operation) {
    const result = writes.then(operation);
    writes = result.catch(() => {});
    return result;
  }

  function serializeProduct(product) {
    const description = product.description || "";
    return {
      id: product.id,
      name: product.name,
      description,
      desc: description,
      category: product.category,
      brand: product.brand,
      fits: product.fits,
      fitmentConfirmed: product.fits.length > 0,
      active: product.active,
      variants: product.variants.map((variant) => ({
        sku: variant.sku,
        name: variant.name,
        price: variant.priceCents === null ? null : variant.priceCents / 100,
        compareAtPrice: variant.compareAtCents === null ? null : variant.compareAtCents / 100,
        stock: variant.stock,
        lowStock: variant.lowStock,
        active: variant.active,
        img: variant.image || "",
        deliveryTime: variant.deliveryTime
      }))
    };
  }

  return {
    async list() {
      await writes;
      return readProducts();
    },

    replace(products) {
      if (!Array.isArray(products)) return Promise.reject(new Error("Produkt-Backup muss ein Array enthalten."));
      return enqueueWrite(() => writeProducts(products));
    },

    upsertProduct(product) {
      return enqueueWrite(async () => {
        const products = await readProducts();
        const index = products.findIndex((entry) => entry.id === product.id);
        const previous = index < 0 ? {} : products[index];
        const updated = { ...previous, ...serializeProduct(product) };
        if (index < 0) products.push(updated);
        else products[index] = updated;
        await writeProducts(products);
      });
    },

    deleteProduct(id) {
      return enqueueWrite(async () => {
        const products = await readProducts();
        await writeProducts(products.filter((product) => product.id !== id));
      });
    }
  };
}
