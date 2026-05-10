import dotenv from "dotenv";
dotenv.config();
import pg from "pg";
const { Pool } = pg;

let pool = null;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      host:     process.env.PG_HOST     || "localhost",
      port:     parseInt(process.env.PG_PORT || "5432"),
      database: process.env.PG_DATABASE || "customer_warehouse",
      user:     process.env.PG_USER     || "postgres",
      password: process.env.PG_PASSWORD || "",
      max:      10,                
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on("error", (err) => {
      console.error("[DB] Unexpected pool error:", err.message);
    });
  }
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function query(sql, params = []) {
  const client = await getPool().connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

export async function transaction(queries) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const results = [];
    for (const { sql, params } of queries) {
      results.push(await client.query(sql, params || []));
    }
    await client.query("COMMIT");
    return results;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}