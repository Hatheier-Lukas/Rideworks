import { readFile } from "node:fs/promises";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL fehlt. Migration wurde nicht ausgeführt.");
  process.exitCode = 1;
} else {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: true },
    max: 1
  });
  const client = await pool.connect();
  try {
    const sql = await readFile(new URL("../api/migrations/001_commerce.sql", import.meta.url), "utf8");
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("Migration 001_commerce.sql erfolgreich angewendet.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration fehlgeschlagen:", error.code || "database_error");
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}
