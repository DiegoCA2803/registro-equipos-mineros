import { readJsonObject, RequestError, validateHourMeter, withEquipmentLock } from "./equipos.js";

const columns = "id, horometro::float8 AS horometro, fecha";

export async function listMaintenance(pool, id) {
  const { rows } = await pool.query(
    `SELECT m.id, m.horometro::float8 AS horometro, m.fecha
     FROM equipos e LEFT JOIN mantenimientos m ON m.equipo_id = e.id
     WHERE e.id = $1 ORDER BY m.horometro DESC`,
    [id],
  );
  if (rows.length === 0) return undefined;
  return rows[0].id === null ? [] : rows;
}

export async function readMaintenance(request) {
  const data = await readJsonObject(request);
  if (Object.keys(data).length !== 1 || !Object.hasOwn(data, "horometro")) {
    throw new RequestError(400, "Envía únicamente el horómetro actual del equipo.");
  }
  validateHourMeter(data.horometro);
  return data.horometro;
}

export async function registerMaintenance(pool, id, horometro) {
  return withEquipmentLock(pool, id, async (client, equipment) => {
    const params = [id, horometro];
    const { rows: [previous] } = await client.query(
      `SELECT ${columns} FROM mantenimientos WHERE equipo_id = $1 AND horometro = $2`,
      params,
    );
    if (previous) return { maintenance: previous, created: false };
    if (horometro !== equipment.horometro) {
      throw new RequestError(409, "El horómetro cambió. Actualiza el inventario antes de registrar el mantenimiento.");
    }
    const { rows: [maintenance] } = await client.query(
      `INSERT INTO mantenimientos (equipo_id, horometro) VALUES ($1, $2) RETURNING ${columns}`,
      params,
    );
    return { maintenance, created: true };
  });
}
