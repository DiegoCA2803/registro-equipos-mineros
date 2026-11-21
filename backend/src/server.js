import { createApi } from "./app.js";
import { createPool } from "./db.js";

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT debe ser un entero entre 1 y 65535.");
}

const pool = createPool();
const server = createApi(pool, process.env.FRONTEND_ORIGIN);
server.listen(port, "0.0.0.0", () => console.log(`API en el puerto ${port}`));

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => server.close(() => pool.end()));
}
