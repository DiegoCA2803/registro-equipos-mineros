import { createServer } from "node:http";
import {
  createEquipment,
  deleteEquipment,
  equipmentId,
  listEquipment,
  readEquipment,
  RequestError,
  updateEquipment,
} from "./equipos.js";
import { listMaintenance, readMaintenance, registerMaintenance } from "./mantenimientos.js";

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
    const health = path === "/health";
    const collection = path === "/api/equipos";
    const item = path.match(/^\/api\/equipos\/([^/]+)(\/mantenimientos)?$/);
    const maintenance = Boolean(item?.[2]);
    if (!health && !collection && !item) {
      return sendJson(response, 404, { error: "Ruta desconocida." });
    }

    const methods = health ? ["GET", "OPTIONS"] :
      (collection || maintenance) ? ["GET", "POST", "OPTIONS"] : ["PATCH", "DELETE", "OPTIONS"];
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Methods": methods.join(", "),
        "Access-Control-Allow-Headers": "Content-Type",
      });
      return response.end();
    }
    if (!methods.includes(request.method)) {
      response.setHeader("Allow", methods.join(", "));
      return sendJson(response, 405, { error: "Método no permitido." });
    }

    try {
      if (health) {
        await pool.query("SELECT 1");
        return sendJson(response, 200, { status: "ok" });
      }
      if (collection && request.method === "GET") {
        return sendJson(response, 200, { equipos: await listEquipment(pool) });
      }
      if (collection) {
        const equipo = await createEquipment(pool, await readEquipment(request));
        response.setHeader("Location", `/api/equipos/${equipo.id}`);
        return sendJson(response, 201, { equipo });
      }

      const id = equipmentId(item[1]);
      if (maintenance && request.method === "GET") {
        const mantenimientos = await listMaintenance(pool, id);
        if (mantenimientos) return sendJson(response, 200, { mantenimientos });
      } else if (maintenance) {
        const result = await registerMaintenance(pool, id, await readMaintenance(request));
        if (result) return sendJson(response, result.created ? 201 : 200, { mantenimiento: result.maintenance });
      } else if (request.method === "PATCH") {
        const equipo = await updateEquipment(pool, id, await readEquipment(request, { partial: true }));
        if (equipo) return sendJson(response, 200, { equipo });
      } else if (await deleteEquipment(pool, id)) {
        response.writeHead(204);
        return response.end();
      }
      return sendJson(response, 404, { error: "Equipo no encontrado." });
    } catch (error) {
      if (response.destroyed) return;
      if (error instanceof RequestError) return sendJson(response, error.status, { error: error.message });
      if (error.code === "23505") return sendJson(response, 409, { error: "Ya existe un equipo con ese código." });
      console.error(`Error de base de datos en ${request.method} ${path}:`, error.message);
      const body = health
        ? { status: "error" }
        : { error: request.method === "GET" ? "No se pudieron consultar los equipos." : "No se pudo guardar el cambio." };
      return sendJson(response, 503, body);
    }
  });
}
