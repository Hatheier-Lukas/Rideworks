import pg from "pg";
import { attachDatabasePool } from "@vercel/functions";

let pool;

export function getPool() {
  if (!process.env.DATABASE_URL) {
    const error = new Error("Bestellungen sind nicht verfügbar: Datenbank (DATABASE_URL) nicht eingerichtet.");
    error.statusCode = 503;
    throw error;
  }
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: true },
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000
    });
    if (process.env.VERCEL) attachDatabasePool(pool);
  }
  return pool;
}
