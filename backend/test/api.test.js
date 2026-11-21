import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApi } from "../src/app.js";

async function serve(t, query) {
  const server = createApi({ query, connect: async () => ({ query, release() {} }) });
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
  const base = await serve(t, async () => ({ rows: [{ ...equipo, horas_desde_ultimo: 145.5 }] }));
  const origin = "http://localhost:5173";
  const response = await fetch(`${base}/api/equipos`, { headers: { Origin: origin } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.deepEqual(await response.json(), {
    equipos: [{ ...equipo, mantenimiento: { intervalo: 500, horasDesdeUltimo: 145.5, requiere: false } }],
  });
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

test("cada tipo vence al alcanzar su intervalo de mantenimiento", async (t) => {
  const types = [["camion", 250], ["excavadora", 500], ["perforadora", 300]];
  const rows = types.flatMap(([tipo, limit]) =>
    [limit - 0.01, limit].map((value) => ({ tipo, horometro: 725, horas_desde_ultimo: value })),
  );
  const base = await serve(t, async () => ({ rows }));
  const response = await fetch(`${base}/api/equipos`);
  assert.equal(response.status, 200);
  const { equipos } = await response.json();
  assert.deepEqual(equipos.map((item) => item.mantenimiento), types.flatMap(([, intervalo]) => [
    { intervalo, horasDesdeUltimo: intervalo - 0.01, requiere: false },
    { intervalo, horasDesdeUltimo: intervalo, requiere: true },
  ]));
});

test("registrar el mismo mantenimiento devuelve el historial existente y rechaza una lectura desactualizada", async (t) => {
  const entry = { id: 1, horometro: 250, fecha: "2026-01-01T18:00:00.000Z" };
  let inserted = false;
  const base = await serve(t, async (sql, params) => {
    if (sql.includes("FOR UPDATE")) return { rows: [{ horometro: 250 }] };
    if (sql.startsWith("SELECT") && sql.includes("FROM mantenimientos")) {
      return { rows: inserted && params[1] === 250 ? [entry] : [] };
    }
    if (sql.startsWith("INSERT")) {
      assert.equal(inserted, false);
      assert.deepEqual(params, [7, 250]);
      inserted = true;
      return { rows: [entry] };
    }
    return { rows: [] };
  });
  const path = `${base}/api/equipos/7/mantenimientos`;
  const register = (body) => fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

  assert.equal((await register({})).status, 400);
  assert.equal((await register({ horometro: 240 })).status, 409);
  const first = await register({ horometro: 250 });
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { mantenimiento: entry });
  const repeated = await register({ horometro: 250 });
  assert.equal(repeated.status, 200);
  assert.deepEqual(await repeated.json(), { mantenimiento: entry });
});
