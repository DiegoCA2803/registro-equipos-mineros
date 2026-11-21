import { createServer } from "node:http";

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export function createApi(pool, frontendOrigin = "http://localhost:5173") {
  const allowedOrigin = new URL(frontendOrigin).origin;

  return createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Vary", "Origin");
    if (request.headers.origin === allowedOrigin) {
      response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    }

    const path = request.url.split("?")[0];
    if (path !== "/health" && path !== "/api/equipos") {
      return sendJson(response, 404, { error: "Ruta desconocida." });
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204, { "Access-Control-Allow-Methods": "GET, OPTIONS" });
      return response.end();
    }
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET, OPTIONS");
      return sendJson(response, 405, { error: "Método no permitido." });
    }

    try {
      if (path === "/health") {
        await pool.query("SELECT 1");
        return sendJson(response, 200, { status: "ok" });
      }
      const { rows } = await pool.query(
        "SELECT id, codigo, tipo, horometro::float8 AS horometro FROM equipos ORDER BY codigo",
      );
      return sendJson(response, 200, { equipos: rows });
    } catch (error) {
      console.error(`Error de base de datos en ${path}:`, error.message);
      const body = path === "/health"
        ? { status: "error" }
        : { error: "No se pudieron consultar los equipos." };
      return sendJson(response, 503, body);
    }
  });
}
