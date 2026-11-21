import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApi } from "../src/app.js";

async function serve(t, query) {
  const server = createApi({ query });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("salud comprueba la conexión antes de responder", async (t) => {
  let query;
  const base = await serve(t, async (sql) => { query = sql; });
  const response = await fetch(`${base}/health`);
  assert.equal(query, "SELECT 1");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("la API devuelve los equipos y permite el origen del frontend", async (t) => {
  const equipo = { id: 1, codigo: "EXC-01", tipo: "excavadora", horometro: 145.5 };
  const base = await serve(t, async () => ({ rows: [equipo] }));
  const origin = "http://localhost:5173";
  const response = await fetch(`${base}/api/equipos`, { headers: { Origin: origin } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.deepEqual(await response.json(), { equipos: [equipo] });
});

test("una caída de PostgreSQL se distingue de una flota vacía", async (t) => {
  const base = await serve(t, async () => { throw new Error("conexión interrumpida"); });
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 503);
  assert.deepEqual(await health.json(), { status: "error" });
  const list = await fetch(`${base}/api/equipos`);
  assert.equal(list.status, 503);
  assert.ok((await list.json()).error);
});
