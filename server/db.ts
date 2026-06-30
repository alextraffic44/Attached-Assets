import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Gracefully handle unexpected connection errors so the pool auto-recovers
pool.on("error", (err) => {
  console.error("[DB Pool] Unexpected client error:", err.message);
});

export const db = drizzle(pool, { schema });
