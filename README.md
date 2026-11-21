# Registro de equipos mineros

Inventario de camiones, excavadoras y perforadoras. La pantalla consulta una API REST y muestra el código, el tipo y el horómetro de cada equipo almacenado en PostgreSQL.

La pantalla permite consultar el inventario. La API ya permite crear, editar y eliminar equipos. Los dos servicios se despliegan desde la terminal.

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
| `POST /api/equipos` | HTTP 201, la ubicación del equipo y `{"equipo":{...}}`. Recibe `codigo`, `tipo` y `horometro`. |
| `PATCH /api/equipos/:id` | HTTP 200 y `{"equipo":{...}}`. Recibe en JSON los campos que se quieren cambiar. |
| `DELETE /api/equipos/:id` | HTTP 204 al eliminar el equipo. |

El código es único y admite hasta 80 caracteres. La API quita los espacios al inicio y al final. Los tipos permitidos son `camion`, `excavadora` y `perforadora`. El horómetro acepta 0 y valores positivos con hasta dos decimales. La API devuelve `400` para datos inválidos, `404` si el equipo no existe y `409` si el código ya está en uso.

Con la base local en marcha, estos comandos crean un equipo, editan su horómetro y lo eliminan.

```powershell
$api = 'http://localhost:3001/api/equipos'
$alta = @{ codigo = 'CAM-01'; tipo = 'camion'; horometro = 25.5 } | ConvertTo-Json
$creado = Invoke-RestMethod $api -Method Post -ContentType 'application/json' -Body $alta
$equipoUrl = "$api/$($creado.equipo.id)"
Invoke-RestMethod $equipoUrl -Method Patch -ContentType 'application/json' -Body '{"horometro":30}'
Invoke-RestMethod $equipoUrl -Method Delete
```

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

## Desplegar desde la terminal

En ambos servicios de Render, configura **Auto-Deploy** en **Off**. El script usa Git, Node.js 22.12 o superior, npm y la API de Render. Lee la configuración del entorno o de `.env.deploy.local`, que Git excluye.

Para la configuración inicial, copia el ejemplo desde la raíz.

```powershell
Copy-Item .env.deploy.example .env.deploy.local
```

Completa `RENDER_API_KEY` y `DATABASE_URL` en el archivo local. Crea la clave de Render para el workspace de los servicios con lectura de **Services** y **Deployment information**, y permiso **Run** en **Run deployments**. Usa la cadena directa de Neon con TLS para `DATABASE_URL`, de la misma base que usa el backend publicado. Los identificadores y las URL del ejemplo corresponden a esta demo. [Claves de la API de Render](https://render.com/docs/api)

Guarda el cambio que quieras publicar en un commit y súbelo a `main` en GitHub. Con el repositorio limpio, ejecuta desde la raíz:

```text
npm run deploy
```

El comando verifica que `HEAD` coincide con la punta de `main` en GitHub y que ambos destinos de Render apuntan al mismo repositorio. Instala las dependencias, prueba la API, compila el frontend, aplica las migraciones pendientes y pide a Render construir y publicar el mismo commit en ambos servicios. Espera que Render confirme cada despliegue y verifica la página, `/health` y la consulta del inventario desde el origen del sitio.

Puedes repetir el comando sobre el mismo commit. Las migraciones ya registradas se omiten y se conservan los datos. Si falla una etapa, el comando indica dónde ocurrió y termina con un código distinto de cero. Revisa el despliegue indicado en Render antes de reintentar.

La API gratuita de Render entra en reposo tras 15 minutos sin tráfico y su primera respuesta puede tardar alrededor de un minuto. Neon ofrece un plan gratuito sin límite de tiempo. [Condiciones de Render](https://render.com/docs/free) · [Plan gratuito de Neon](https://neon.com/pricing)

## Uso de IA

Se utilizó OpenAI Codex para preparar la estructura inicial, la API de consulta, la interfaz, las migraciones, las pruebas y esta guía.
