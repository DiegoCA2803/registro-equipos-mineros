# Registro de equipos mineros

Inventario de camiones, excavadoras y perforadoras. La pantalla consulta una API REST y muestra el código, el tipo y el horómetro de cada equipo almacenado en PostgreSQL.

Desde el inventario puedes crear, editar y eliminar equipos, ver cuándo requieren mantenimiento y registrar cada servicio. El botón **Usar usuario de prueba** rellena el acceso público de solo lectura a los equipos de ejemplo y su historial. Usa la cuenta privada para probar las operaciones de edición. La API usa JWT de una hora. Los dos servicios se despliegan desde la terminal.

## Versión publicada

| Servicio | Enlace |
| --- | --- |
| Frontend | [Inventario de equipos](https://registro-equipos-mineros.onrender.com) |
| API | [Listado de equipos con autenticación](https://registro-equipos-mineros-api.onrender.com/api/equipos) |
| Estado de la API | [Comprobación de PostgreSQL](https://registro-equipos-mineros-api.onrender.com/health) |

## Ejecutar en local

Necesitas Node.js 22.12 o superior, npm y PostgreSQL. Los siguientes comandos de PowerShell se ejecutan desde la raíz del repositorio. Para usar la base de desarrollo incluida, inicia Docker Desktop con contenedores Linux.

Si empiezas desde una copia nueva, clona el repositorio.

```powershell
git clone https://github.com/DiegoCA2803/registro-equipos-mineros.git
Set-Location registro-equipos-mineros
```

**1. Preparar los servicios.** Copia los ejemplos la primera vez e instala las dependencias.

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
npm ci --prefix backend
npm ci --prefix frontend
npm --prefix backend run auth:setup
```

Guarda el usuario y la contraseña que muestra `auth:setup` la primera vez. El comando guarda el hash y la clave de firma en `backend/.env`.

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

Abre [el inventario local](http://localhost:5173) e inicia sesión. Puedes crear un equipo desde la web o cargar cuatro equipos ficticios y un historial de ejemplo con este comando. Vuélvelo a ejecutar si necesitas recuperar un equipo de demo que hayas borrado.

```powershell
npm --prefix backend run seed:demo
```

Para detener la aplicación, pulsa Ctrl+C en ambas terminales y ejecuta `docker compose --env-file backend/.env stop`.

## Mantenimiento

| Tipo | Intervalo |
| --- | ---: |
| Camión | 250 h |
| Excavadora | 500 h |
| Perforadora | 300 h |

El estado cambia a **Requiere mantenimiento** cuando las horas del ciclo alcanzan el intervalo del tipo. El cálculo resta al horómetro total la lectura del último mantenimiento. Antes del primer servicio, el ciclo parte de 0 h.

En el inventario, abre **Mantenimiento** para ver el progreso y el historial. **Registrar mantenimiento** guarda la fecha y la lectura actual en PostgreSQL. Esa lectura pasa a ser el inicio del siguiente ciclo y el horómetro total se conserva. Puedes registrar servicios antes del vencimiento y cada equipo admite un registro por lectura.

Para probarlo, crea un camión con 250 h. Comprueba que aparezca el aviso y registra un mantenimiento. El inventario conserva las 250 h de horómetro total, el estado cambia a **Al día** y el ciclo vuelve a 0 h.

Puedes corregir el horómetro hasta la lectura del último servicio. Si cambias el tipo, el sistema aplica el intervalo del tipo nuevo al ciclo en curso. Al eliminar un equipo, también se elimina su historial.

## Comprobar la base

| Ruta de la API | Resultado esperado |
| --- | --- |
| `GET /health` | HTTP 200 y `{"status":"ok"}` si PostgreSQL responde. HTTP 503 si falla la consulta. |
| `GET /api/auth/demo` | Devuelve el usuario y la contraseña temporal del acceso público de solo lectura. |
| `POST /api/auth/login` | Recibe `username` y `password` y devuelve `{"token":"..."}` si son correctos. |
| `GET /api/equipos` | HTTP 200 con `equipos` ordenados por código y `puedeEditar` según el acceso. Cada equipo incluye el horómetro total y el objeto `mantenimiento` con `intervalo`, `horasDesdeUltimo` y `requiere`. |
| `POST /api/equipos` | HTTP 201, la ubicación del equipo y `{"equipo":{...}}`. Recibe `codigo`, `tipo` y `horometro`. |
| `PATCH /api/equipos/:id` | HTTP 200 y `{"equipo":{...}}`. Recibe en JSON los campos que se quieren cambiar. |
| `DELETE /api/equipos/:id` | HTTP 204 al eliminar el equipo. |
| `GET /api/equipos/:id/mantenimientos` | HTTP 200 y `{"mantenimientos":[...]}`. Cada registro contiene `id`, `horometro` y `fecha` en UTC. |
| `POST /api/equipos/:id/mantenimientos` | Recibe `{"horometro":250}` con la lectura actual. Devuelve `{"mantenimiento":{...}}` con HTTP 201 al registrar un servicio o 200 si ya existía para esa lectura. |

Las rutas de equipos y mantenimiento requieren la cabecera `Authorization: Bearer <token>`. El endpoint `/health` es público. El usuario de prueba recibe solo los equipos marcados como ejemplos y su historial. Las credenciales con permiso de edición se comparten en privado con quien evalúe el proyecto.

El código es único y admite hasta 80 caracteres. La API quita los espacios al inicio y al final. Los tipos permitidos son `camion`, `excavadora` y `perforadora`. El horómetro acepta 0 y valores positivos con hasta dos decimales. La API devuelve `400` para datos inválidos, `404` si el equipo no existe y `409` si el código está en uso, la lectura enviada para registrar el servicio está desactualizada o la edición dejaría el horómetro por debajo de un servicio registrado.

Con la base local en marcha, estos comandos crean un equipo, editan su horómetro y lo eliminan.

```powershell
$api = 'http://localhost:3001/api/equipos'
$credencial = Get-Credential -UserName 'demo' -Message 'Ingresa el acceso local'
$login = @{ username = $credencial.UserName; password = $credencial.GetNetworkCredential().Password } | ConvertTo-Json
$jwt = Invoke-RestMethod 'http://localhost:3001/api/auth/login' -Method Post -ContentType 'application/json' -Body $login
$headers = @{ Authorization = "Bearer $($jwt.token)" }
$alta = @{ codigo = 'CAM-01'; tipo = 'camion'; horometro = 25.5 } | ConvertTo-Json
$creado = Invoke-RestMethod $api -Headers $headers -Method Post -ContentType 'application/json' -Body $alta
$equipoUrl = "$api/$($creado.equipo.id)"
Invoke-RestMethod $equipoUrl -Headers $headers -Method Patch -ContentType 'application/json' -Body '{"horometro":30}'
Invoke-RestMethod $equipoUrl -Headers $headers -Method Delete
```

```powershell
Invoke-RestMethod http://localhost:3001/health
Invoke-RestMethod http://localhost:3001/api/equipos -Headers $headers | ConvertTo-Json -Depth 4
npm --prefix backend test
npm --prefix frontend run build
```

Las migraciones están en `backend/migrations/`. Cada archivo SQL se registra al aplicarse. Volver a ejecutar `npm --prefix backend run migrate` conserva los equipos existentes.

## Preparar la publicación en Render y Neon

El frontend y la API se publican como servicios independientes desde el mismo repositorio de GitHub. La tabla recoge los ajustes para la primera publicación manual.

| Destino | Configuración |
| --- | --- |
| **Neon Free** | Crear una base PostgreSQL. Guardar la cadena de conexión con TLS como secreto. Aplicar las migraciones con la cadena directa de Neon en `DATABASE_URL` del proceso que ejecute `npm --prefix backend run migrate`. |
| **Render Web Service · Free** | Raíz `backend`, entorno Node, build `npm ci`, inicio `npm start`, health check `/health`. Configurar `DATABASE_URL`, `FRONTEND_ORIGIN`, `AUTH_USERNAME`, `AUTH_PASSWORD_HASH` y `JWT_SECRET`. Render asigna `PORT`. |
| **Render Static Site** | Raíz `frontend`, build `npm ci --include=dev && npm run build`, directorio público `dist`. Configurar `API_BASE_URL` con el origen HTTPS de la API antes de compilar. |

Reserva ambos servicios para conocer sus direcciones. Genera el acceso de la demo en una configuración separada con `auth:setup` y usa los valores del backend en Render. Configura `FRONTEND_ORIGIN` con el origen HTTPS exacto del sitio estático y `DATABASE_URL` con la conexión de Neon. Aplica la migración, publica la API y luego el sitio. Si cambias `API_BASE_URL`, vuelve a compilar el frontend. Comprueba `/health` e inicia sesión desde la web publicada.

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

El comando verifica que `HEAD` coincide con la punta de `main` en GitHub y que ambos destinos de Render apuntan al mismo repositorio. Instala las dependencias, prueba la API, compila el frontend, aplica las migraciones pendientes y pide a Render construir y publicar el mismo commit en ambos servicios. Espera que Render confirme cada despliegue, comprueba la página y `/health`, y verifica que la API rechace el acceso al inventario sin sesión con HTTP 401.

Puedes repetir el comando sobre el mismo commit. Las migraciones ya registradas se omiten y se conservan los datos. Si falla una etapa, el comando indica dónde ocurrió y termina con un código distinto de cero. Revisa el despliegue indicado en Render antes de reintentar.

La API gratuita de Render entra en reposo tras 15 minutos sin tráfico y su primera respuesta puede tardar alrededor de un minuto. Neon ofrece un plan gratuito sin límite de tiempo. [Condiciones de Render](https://render.com/docs/free) · [Plan gratuito de Neon](https://neon.com/pricing)

## Uso de IA

Se utilizó OpenAI Codex para implementar la API, la interfaz, el inicio de sesión, las migraciones, la automatización del despliegue y las pruebas. También se usó para redactar esta guía y preparar las instrucciones para grabar la demostración.
