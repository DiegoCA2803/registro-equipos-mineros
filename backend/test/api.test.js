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

test("preflight permite enviar JSON desde el origen del frontend", async (t) => {
  const base = await serve(t, () => assert.fail("OPTIONS no debe consultar PostgreSQL"));
  const origin = "http://localhost:5173";
  const response = await fetch(`${base}/api/equipos/1`, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "PATCH",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.equal(response.headers.get("access-control-allow-methods"), "PATCH, DELETE, OPTIONS");
  assert.equal(response.headers.get("access-control-allow-headers"), "Content-Type");
});

test("la validación rechaza cuerpos inválidos antes de consultar PostgreSQL", async (t) => {
  const base = await serve(t, () => assert.fail("Una solicitud inválida no debe llegar a PostgreSQL"));
  const url = `${base}/api/equipos`;
  const valid = { codigo: "CAM-01", tipo: "camion", horometro: 15 };
  const headers = { "Content-Type": "application/json" };

  const invalid = [
    ["POST", url, "{", 400],
    ["POST", url, JSON.stringify({ ...valid, horometro: -1 }), 400],
    ["POST", url, JSON.stringify({ ...valid, horometro: 15.001 }), 400],
    ["POST", url, JSON.stringify({ ...valid, tipo: "grua" }), 400],
    ["POST", url, JSON.stringify({ ...valid, codigo: "   " }), 400],
    ["POST", url, JSON.stringify({ ...valid, horometro: 10_000_000_000 }), 400],
    ["POST", url, JSON.stringify({ ...valid, codigo: "A".repeat(17 * 1024) }), 413],
    ["PATCH", `${url}/1`, "{}", 400],
    ["PATCH", `${url}/1`, '{"codigo":null}', 400],
    ["PATCH", `${url}/2147483648`, '{"horometro":10}', 400],
  ];
  for (const [method, destination, body, status] of invalid) {
    const response = await fetch(destination, { method, headers, body });
    assert.equal(response.status, status);
    assert.equal(typeof (await response.json()).error, "string");
  }
  const textBody = await fetch(url, { method: "POST", body: JSON.stringify(valid) });
  assert.equal(textBody.status, 415);
});

test("crear normaliza el código y responde con la ubicación del equipo", async (t) => {
  const equipment = { id: 5, codigo: "EXC-05", tipo: "excavadora", horometro: 0 };
  const base = await serve(t, async (_sql, params) => {
    assert.deepEqual(params, ["EXC-05", "excavadora", 0]);
    return { rows: [equipment] };
  });
  const response = await fetch(`${base}/api/equipos`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ codigo: " EXC-05 ", tipo: "excavadora", horometro: 0 }),
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("location"), "/api/equipos/5");
  assert.deepEqual(await response.json(), { equipo: equipment });
});

test("distingue los códigos duplicados y los equipos inexistentes", async (t) => {
  const base = await serve(t, async (sql) => {
    if (sql.startsWith("INSERT")) throw Object.assign(new Error("Código repetido"), { code: "23505" });
    return { rowCount: 0, rows: [] };
  });
  const headers = { "Content-Type": "application/json" };
  const duplicate = await fetch(`${base}/api/equipos`, {
    method: "POST", headers, body: '{"codigo":"CAM-01","tipo":"camion","horometro":10}',
  });
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error, "Ya existe un equipo con ese código.");
  const missing = await fetch(`${base}/api/equipos/42`, {
    method: "PATCH", headers, body: '{"horometro":20}',
  });
  assert.equal(missing.status, 404);
  assert.equal((await fetch(`${base}/api/equipos/42`, { method: "DELETE" })).status, 404);
});
