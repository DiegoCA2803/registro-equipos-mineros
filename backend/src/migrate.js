import { readdir, readFile } from "node:fs/promises";
import { createPool } from "./db.js";

const directory = new URL("../migrations/", import.meta.url);

async function applyMigrations(client) {
  await client.query("BEGIN");
  try {
    // Serializa los despliegues concurrentes hasta que termine la transacción.
    await client.query("SELECT pg_advisory_xact_lock(97001)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const { rows } = await client.query("SELECT filename FROM schema_migrations");
    const applied = new Set(rows.map((row) => row.filename));
    const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
    const pending = files.filter((name) => !applied.has(name));
    for (const filename of pending) {
      const sql = await readFile(new URL(filename, directory), "utf8");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
    }
    await client.query("COMMIT");
    console.log(pending.length ? `Migraciones aplicadas: ${pending.join(", ")}` : "Migraciones al día.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

try {
  const pool = createPool();
  try {
    const client = await pool.connect();
    try {
      await applyMigrations(client);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
} catch (error) {
  console.error("Falló la migración:", error.message);
  process.exitCode = 1;
}
