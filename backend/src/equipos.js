const columns = "id, codigo, tipo, horometro::float8 AS horometro";
const fields = new Set(["codigo", "tipo", "horometro"]);
const intervals = new Map([["camion", 250], ["excavadora", 500], ["perforadora", 300]]);
const maxBodyBytes = 16 * 1024;

export class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function equipmentId(segment) {
  const id = Number(segment);
  if (!/^\d{1,10}$/.test(segment) || id < 1 || id > 2_147_483_647) {
    throw new RequestError(400, "El identificador del equipo debe ser un entero positivo válido.");
  }
  return id;
}

export async function readJsonObject(request) {
  const contentType = request.headers["content-type"]?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    request.resume();
    throw new RequestError(415, "Envía el cuerpo como application/json.");
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      request.resume();
      throw new RequestError(413, "El cuerpo de la solicitud supera los 16 KiB.");
    }
    chunks.push(chunk);
  }

  let data;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError(400, "El cuerpo debe contener JSON válido.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new RequestError(400, "El cuerpo debe ser un objeto JSON.");
  }
  return data;
}

export function validateHourMeter(value) {
  if (typeof value !== "number" || !/^\d{1,10}(?:\.\d{1,2})?$/.test(String(value))) {
    throw new RequestError(400, "El horómetro debe ser un número no negativo con hasta 10 dígitos enteros y 2 decimales.");
  }
}

export async function readEquipment(request, { partial = false } = {}) {
  const data = await readJsonObject(request);
  const keys = Object.keys(data);
  if (keys.some((key) => !fields.has(key))) {
    throw new RequestError(400, "Los campos permitidos son codigo, tipo y horometro.");
  }
  if (partial ? keys.length === 0 : keys.length !== fields.size) {
    const message = partial
      ? "Envía al menos un campo para editar."
      : "El código, el tipo y el horómetro son obligatorios.";
    throw new RequestError(400, message);
  }

  if (Object.hasOwn(data, "codigo")) {
    const code = typeof data.codigo === "string" ? data.codigo.trim() : "";
    if (!code || code.length > 80 || code.includes("\0")) {
      throw new RequestError(400, "El código debe tener entre 1 y 80 caracteres válidos.");
    }
    data.codigo = code;
  }
  if (Object.hasOwn(data, "tipo") && !intervals.has(data.tipo)) {
    throw new RequestError(400, "El tipo debe ser camion, excavadora o perforadora.");
  }
  if (Object.hasOwn(data, "horometro")) validateHourMeter(data.horometro);
  return data;
}

export async function listEquipment(pool, soloDemo) {
  const { rows } = await pool.query(`
    SELECT e.id, e.codigo, e.tipo, e.horometro::float8 AS horometro,
           (e.horometro - COALESCE(ultimo.horometro, 0))::float8 AS horas_desde_ultimo
    FROM equipos e
    LEFT JOIN LATERAL (
      SELECT horometro FROM mantenimientos WHERE equipo_id = e.id ORDER BY horometro DESC LIMIT 1
    ) ultimo ON true
    WHERE NOT $1::boolean OR e.es_demo
    ORDER BY e.codigo
  `, [soloDemo]);
  return rows.map(({ horas_desde_ultimo: horasDesdeUltimo, ...equipo }) => {
    const intervalo = intervals.get(equipo.tipo);
    return {
      ...equipo,
      mantenimiento: { intervalo, horasDesdeUltimo, requiere: horasDesdeUltimo >= intervalo },
    };
  });
}

export async function createEquipment(pool, { codigo, tipo, horometro }) {
  const { rows } = await pool.query(
    `INSERT INTO equipos (codigo, tipo, horometro) VALUES ($1, $2, $3) RETURNING ${columns}`,
    [codigo, tipo, horometro],
  );
  return rows[0];
}

// Las ediciones del horómetro y el registro de servicios se serializan por equipo.
export async function withEquipmentLock(pool, id, action) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [equipment] } = await client.query(
      "SELECT horometro::float8 AS horometro FROM equipos WHERE id = $1 FOR UPDATE",
      [id],
    );
    const result = equipment ? await action(client, equipment) : undefined;
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function updateEquipment(pool, id, { codigo = null, tipo = null, horometro = null }) {
  async function update(client) {
    const { rows } = await client.query(
      `UPDATE equipos
       SET codigo = COALESCE($1, codigo), tipo = COALESCE($2, tipo), horometro = COALESCE($3, horometro)
       WHERE id = $4
       RETURNING ${columns}`,
      [codigo, tipo, horometro, id],
    );
    return rows[0];
  }
  if (horometro === null) return update(pool);

  return withEquipmentLock(pool, id, async (client) => {
    const { rows: [last] } = await client.query(
      "SELECT horometro::float8 AS horometro FROM mantenimientos WHERE equipo_id = $1 ORDER BY horometro DESC LIMIT 1",
      [id],
    );
    if (last && horometro < last.horometro) {
      throw new RequestError(409, "El horómetro no puede ser menor que la lectura del último mantenimiento.");
    }
    return update(client);
  });
}

export async function deleteEquipment(pool, id) {
  const { rowCount } = await pool.query("DELETE FROM equipos WHERE id = $1", [id]);
  return rowCount === 1;
}
