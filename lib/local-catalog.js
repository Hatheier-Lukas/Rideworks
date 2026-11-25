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

  return {
    async list() {
      await writes;
      return readProducts();
    },

    replace(products) {
      if (!Array.isArray(products)) return Promise.reject(new Error("Produkt-Backup muss ein Array enthalten."));
      const result = writes.then(() => writeProducts(products));
      writes = result.catch(() => {});
      return result;
    }
  };
}
