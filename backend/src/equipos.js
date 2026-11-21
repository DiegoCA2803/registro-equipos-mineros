const columns = "id, codigo, tipo, horometro::float8 AS horometro";
const fields = new Set(["codigo", "tipo", "horometro"]);
const types = new Set(["camion", "excavadora", "perforadora"]);
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

export async function readEquipment(request, { partial = false } = {}) {
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
  if (Object.hasOwn(data, "tipo") && !types.has(data.tipo)) {
    throw new RequestError(400, "El tipo debe ser camion, excavadora o perforadora.");
  }
  if (Object.hasOwn(data, "horometro") &&
      (typeof data.horometro !== "number" || !/^\d{1,10}(?:\.\d{1,2})?$/.test(String(data.horometro)))) {
    throw new RequestError(400, "El horómetro debe ser un número no negativo con hasta 10 dígitos enteros y 2 decimales.");
  }
  return data;
}

export async function listEquipment(pool) {
  const { rows } = await pool.query(`SELECT ${columns} FROM equipos ORDER BY codigo`);
  return rows;
}

export async function createEquipment(pool, { codigo, tipo, horometro }) {
  const { rows } = await pool.query(
    `INSERT INTO equipos (codigo, tipo, horometro) VALUES ($1, $2, $3) RETURNING ${columns}`,
    [codigo, tipo, horometro],
  );
  return rows[0];
}

export async function updateEquipment(pool, id, { codigo = null, tipo = null, horometro = null }) {
  const { rows } = await pool.query(
    `UPDATE equipos
     SET codigo = COALESCE($1, codigo), tipo = COALESCE($2, tipo), horometro = COALESCE($3, horometro)
     WHERE id = $4
     RETURNING ${columns}`,
    [codigo, tipo, horometro, id],
  );
  return rows[0];
}

export async function deleteEquipment(pool, id) {
  const { rowCount } = await pool.query("DELETE FROM equipos WHERE id = $1", [id]);
  return rowCount === 1;
}
