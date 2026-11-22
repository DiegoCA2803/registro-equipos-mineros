import { createPool } from "./db.js";

try {
  const pool = createPool();
  try {
    const { rows: [result] } = await pool.query(`
      WITH nuevos AS (
        INSERT INTO equipos (codigo, tipo, horometro, es_demo) VALUES
          ('DEMO-CAM-01', 'camion', 250, true),
          ('DEMO-CAM-02', 'camion', 135.75, true),
          ('DEMO-EXC-01', 'excavadora', 830, true),
          ('DEMO-PERF-01', 'perforadora', 120.50, true)
        ON CONFLICT (codigo) DO NOTHING
        RETURNING id, codigo
      ), servicios AS (
        INSERT INTO mantenimientos (equipo_id, horometro, fecha)
        SELECT id, 500, now() - interval '3 days' FROM nuevos WHERE codigo = 'DEMO-EXC-01'
        RETURNING id
      )
      SELECT (SELECT count(*) FROM nuevos) AS equipos, (SELECT count(*) FROM servicios) AS mantenimientos
    `);
    console.log(`Demo cargada. Equipos nuevos: ${result.equipos}. Registros de mantenimiento nuevos: ${result.mantenimientos}.`);
  } finally {
    await pool.end();
  }
} catch {
  console.error("Falló la carga de la demo. Comprueba la conexión y aplica las migraciones.");
  process.exitCode = 1;
}
