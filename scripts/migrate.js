import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import { loadLocalEnvironment } from "../lib/load-local-env.js";

await loadLocalEnvironment(new URL("../.env.local", import.meta.url));
const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL fehlt. Migration wurde nicht ausgeführt.");
  process.exitCode = 1;
} else {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: true },
    max: 1
  });
  const client = await pool.connect();
  try {
    const migrationsUrl = new URL("../api/migrations/", import.meta.url);
    const migrations = (await readdir(migrationsUrl))
      .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
      .sort();
    if (!migrations.length) throw new Error("Keine SQL-Migrationen gefunden.");
    for (const name of migrations) {
      try {
        const sql = await readFile(new URL(name, migrationsUrl), "utf8");
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("COMMIT");
        console.log(`Migration ${name} erfolgreich angewendet.`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration fehlgeschlagen:", error.code || "database_error");
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}
