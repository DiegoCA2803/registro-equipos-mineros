# Registro de equipos mineros

Inventario de camiones, excavadoras y perforadoras. La pantalla consulta una API REST y muestra el código, el tipo y el horómetro de cada equipo almacenado en PostgreSQL.

Esta primera versión permite consultar el inventario. Las operaciones de alta, edición y baja, el historial de mantenimiento y el comando de despliegue se incorporarán en las próximas versiones.

## Versión publicada

| Servicio | Enlace |
| --- | --- |
| Frontend | [Inventario de equipos](https://registro-equipos-mineros.onrender.com) |
| API | [Listado de equipos](https://registro-equipos-mineros-api.onrender.com/api/equipos) |
| Estado de la API | [Comprobación de PostgreSQL](https://registro-equipos-mineros-api.onrender.com/health) |

## Ejecutar en local

Necesitas Node.js 22.12 o superior, npm y PostgreSQL. Los siguientes comandos de PowerShell se ejecutan desde la raíz del repositorio. Para usar la base de desarrollo incluida, inicia Docker Desktop con contenedores Linux.

**1. Preparar los servicios.** Copia los ejemplos la primera vez e instala las dependencias.

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
npm ci --prefix backend
npm ci --prefix frontend
```

**2. Iniciar PostgreSQL y aplicar el esquema.** Compose expone la base en el puerto local 5433 y conserva el inventario en un volumen. Si ya tienes una base PostgreSQL dedicada a esta aplicación, configura su cadena en `backend/.env` y ejecuta solo la migración.

```powershell
docker compose --env-file backend/.env up -d --wait
npm --prefix backend run migrate
```

**3. Arrancar la API y el frontend.** Deja una terminal abierta por servicio.

```powershell
# Terminal 1
npm --prefix backend start
```

```powershell
# Terminal 2
npm --prefix frontend run dev
```

Abre [el inventario local](http://localhost:5173). La primera consulta devuelve una lista vacía. Para ver una fila con la base de Compose, puedes cargar este ejemplo local y pulsar **Actualizar**. El comando se puede repetir.

```powershell
docker compose --env-file backend/.env exec db psql -U mineros -d mineros -c "INSERT INTO equipos (codigo, tipo, horometro) VALUES ('EXC-01', 'excavadora', 125.50) ON CONFLICT (codigo) DO NOTHING"
```

Para detener la aplicación, pulsa Ctrl+C en ambas terminales y ejecuta `docker compose --env-file backend/.env stop`.

## Comprobar la base

| Ruta de la API | Resultado esperado |
| --- | --- |
| `GET /health` | HTTP 200 y `{"status":"ok"}` si PostgreSQL responde. HTTP 503 si falla la consulta. |
| `GET /api/equipos` | HTTP 200 y `{"equipos":[...]}`, ordenados por código. El horómetro es un número en horas. |

```powershell
Invoke-RestMethod http://localhost:3001/health
Invoke-RestMethod http://localhost:3001/api/equipos | ConvertTo-Json -Depth 4
npm --prefix backend test
npm --prefix frontend run build
```

Las migraciones están en `backend/migrations/`. Cada archivo SQL se registra al aplicarse. Volver a ejecutar `npm --prefix backend run migrate` conserva los equipos existentes.

## Preparar la publicación en Render y Neon

El frontend y la API se publican como servicios independientes desde el mismo repositorio de GitHub. La tabla recoge los ajustes para la primera publicación manual.

| Destino | Configuración |
| --- | --- |
| **Neon Free** | Crear una base PostgreSQL. Guardar la cadena de conexión con TLS como secreto. Aplicar las migraciones con la cadena directa de Neon en `DATABASE_URL` del proceso que ejecute `npm --prefix backend run migrate`. |
| **Render Web Service · Free** | Raíz `backend`, entorno Node, build `npm ci`, inicio `npm start`, health check `/health`. Configurar `DATABASE_URL` con la conexión de Neon y `FRONTEND_ORIGIN` con el origen HTTPS exacto del sitio estático. Render asigna `PORT`. |
| **Render Static Site** | Raíz `frontend`, build `npm ci --include=dev && npm run build`, directorio público `dist`. Configurar `API_BASE_URL` con el origen HTTPS de la API antes de compilar. |

Reserva ambos servicios para conocer sus direcciones. Aplica la migración, publica la API y luego el sitio. Si cambias `API_BASE_URL`, vuelve a compilar el frontend. Comprueba la URL pública de `/health` y abre el sitio para confirmar que el navegador puede consultar el inventario desde su propio origen.

En los dos servicios de esta demo, `Auto-Deploy` está en `Off`. Tras subir los cambios, usa **Manual Deploy** en cada servicio y comprueba las URL públicas.

La API gratuita de Render entra en reposo tras 15 minutos sin tráfico y su primera respuesta puede tardar alrededor de un minuto. Neon ofrece un plan gratuito sin límite de tiempo. [Condiciones de Render](https://render.com/docs/free) · [Plan gratuito de Neon](https://neon.com/pricing)

## Uso de IA

Se utilizó OpenAI Codex para preparar la estructura inicial, la API de consulta, la interfaz, las migraciones, las pruebas y esta guía.
