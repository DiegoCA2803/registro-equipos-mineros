import pg from "pg";

export function createPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Falta DATABASE_URL. Configúrala en backend/.env o en el entorno.");
  }

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
  });
  pool.on("error", (error) => console.error("Conexión inactiva de PostgreSQL:", error.message));
  return pool;
}
