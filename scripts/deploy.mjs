import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const renderApi = "https://api.render.com/v1";
const branch = "main";
const requestTimeout = 15_000;
const deployTimeout = 10 * 60_000;
const smokeTimeout = 2 * 60_000;
const pending = new Set(["created", "queued", "build_in_progress", "pre_deploy_in_progress", "update_in_progress"]);
const secretKeys = new Set(["RENDER_API_KEY", "DATABASE_URL"]);
const childEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !secretKeys.has(key.toUpperCase())),
);
let step = "Configuración";

function configuration() {
  let file = {};
  try {
    file = parseEnv(readFileSync(new URL("../.env.deploy.local", import.meta.url), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("No se pudo leer .env.deploy.local.");
  }

  const keys = ["RENDER_API_KEY", "DATABASE_URL", "RENDER_BACKEND_ID", "RENDER_FRONTEND_ID", "BACKEND_URL", "FRONTEND_URL"];
  const config = Object.fromEntries(keys.map((key) => [key, (process.env[key] ?? file[key])?.trim()]));
  const missing = keys.filter((key) => !config[key]);
  if (missing.length) {
    throw new Error(`Falta configurar ${missing.join(", ")} en el entorno o en .env.deploy.local.`);
  }
  const { RENDER_BACKEND_ID, RENDER_FRONTEND_ID } = config;
  if ([RENDER_BACKEND_ID, RENDER_FRONTEND_ID].some((id) => !/^srv-[a-z0-9]+$/.test(id)) ||
      RENDER_BACKEND_ID === RENDER_FRONTEND_ID) {
    throw new Error("Configura dos identificadores de servicio de Render distintos y válidos.");
  }

  let database;
  try {
    database = new URL(config.DATABASE_URL);
  } catch {
    throw new Error("DATABASE_URL debe ser una URL de PostgreSQL válida.");
  }
  if (!["postgres:", "postgresql:"].includes(database.protocol) || !database.hostname ||
      !["require", "verify-full"].includes(database.searchParams.get("sslmode")) ||
      database.hostname.includes("-pooler.")) {
    throw new Error("DATABASE_URL debe usar la conexión directa de PostgreSQL con TLS.");
  }
  return config;
}

function httpsOrigin(value, label) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password &&
        url.pathname === "/" && !url.search && !url.hash) return url.origin;
  } catch {
    // Muestra el nombre de la variable sin imprimir su valor.
  }
  throw new Error(`${label} debe ser un origen HTTPS sin ruta ni credenciales.`);
}

function git(args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: { ...childEnv, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
    timeout: 30_000,
  });
  if (result.error?.code === "ENOENT") throw new Error("Git no está disponible en PATH.");
  if (result.status !== 0) throw new Error(`Falló git ${args[0]}. Comprueba el repositorio y el acceso a origin.`);
  return result.stdout.trim();
}

function npm(folder, args, env = {}, { quiet = false } = {}) {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, ...args], {
    cwd: new URL(`../${folder}/`, import.meta.url),
    env: { ...childEnv, ...env },
    stdio: quiet ? "ignore" : "inherit",
    timeout: 3 * 60_000,
  });
  if (result.error?.code === "ETIMEDOUT") throw new Error("Se agotó el tiempo del comando npm.");
  if (result.status !== 0) {
    const hint = quiet ? " Comprueba la conexión y revisa la migración antes de repetir el despliegue." : "";
    throw new Error(`Falló npm ${args.join(" ")} en ${folder}.${hint}`);
  }
}

function githubRepo(value) {
  const match = value?.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)\/?$/i);
  if (!match) throw new Error("El remoto y los servicios deben apuntar al repositorio de GitHub.");
  return `${match[1]}/${match[2].replace(/\.git$/, "")}`.toLowerCase();
}

async function render(path, key, body) {
  const method = body ? "POST" : "GET";
  let response;
  try {
    response = await fetch(renderApi + path, {
      method,
      headers: { Accept: "application/json", Authorization: `Bearer ${key}`, ...(body && { "Content-Type": "application/json" }) },
      body: body && JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(requestTimeout),
    });
  } catch {
    throw new Error(`No se pudo completar ${method} ${path} en Render.`);
  }
  if (!response.ok) {
    const hint = [401, 403].includes(response.status) ? " Comprueba la clave y sus permisos en Render." : "";
    throw new Error(`Render devolvió HTTP ${response.status} en ${method} ${path}.${hint}`);
  }
  const location = response.headers.get("Location");
  const data = await response.json().catch(() => null);
  if (data) return data;
  const deployId = location?.match(/\/(dep-[a-z0-9]+)\/?$/)?.[1];
  if (body && deployId) return { id: deployId };
  throw new Error(`Render no devolvió los datos esperados en ${method} ${path}.`);
}

async function deploy(service, sha, key) {
  const path = `/services/${service.id}/deploys`;
  const { id } = await render(path, key, { commitId: sha });
  if (!/^dep-[a-z0-9]+$/.test(id)) throw new Error("Render no devolvió un identificador de despliegue válido.");
  console.log(`  Render aceptó ${id} para ${sha.slice(0, 7)}.`);
  const deadline = Date.now() + deployTimeout;
  while (Date.now() < deadline) {
    const current = await render(`${path}/${id}`, key);
    if (current.status === "live") {
      if (current.commit?.id !== sha) throw new Error(`Render activó un commit distinto en ${id}.`);
      console.log(`  Render confirmó ${id} como activo.`);
      return;
    }
    if (!pending.has(current.status)) {
      throw new Error(`Render terminó ${id} con estado ${current.status ?? "desconocido"}. Revisa sus logs en el panel.`);
    }
    await delay(5_000);
  }
  throw new Error(`Render no confirmó ${id} en 10 minutos. Revisa su estado en el panel.`);
}

async function verify(label, url, validate, headers = {}, expectedStatus = 200) {
  const deadline = Date.now() + smokeTimeout;
  let lastError = "sin respuesta";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        headers, cache: "no-store", redirect: "error",
        signal: AbortSignal.timeout(Math.min(requestTimeout, deadline - Date.now())),
      });
      if (response.status !== expectedStatus) throw new Error(`HTTP ${response.status}`);
      if (!await validate(response)) throw new Error("respuesta inesperada");
      console.log(`  ${label}: HTTP ${expectedStatus}.`);
      return;
    } catch (error) {
      lastError = error.message;
      await delay(Math.min(4_000, Math.max(0, deadline - Date.now())));
    }
  }
  throw new Error(`${label} no pasó la comprobación en 2 minutos (${lastError}).`);
}

async function main() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new Error("Necesitas Node.js 22.12 o superior.");
  if (!process.env.npm_execpath) throw new Error("Ejecuta npm run deploy desde la raíz.");
  const config = configuration();
  const backend = { id: config.RENDER_BACKEND_ID, origin: httpsOrigin(config.BACKEND_URL, "BACKEND_URL"), type: "web_service", root: "backend" };
  const frontend = { id: config.RENDER_FRONTEND_ID, origin: httpsOrigin(config.FRONTEND_URL, "FRONTEND_URL"), type: "static_site", root: "frontend" };
  const key = config.RENDER_API_KEY;

  step = "Verificar Git y los destinos";
  if (git(["status", "--porcelain"])) throw new Error("Guarda tus cambios en Git y sube el commit antes de desplegar.");
  const repo = githubRepo(git(["remote", "get-url", "origin"]));
  const sha = git(["rev-parse", "HEAD"]);
  const remoteSha = git(["ls-remote", "--exit-code", "origin", `refs/heads/${branch}`]).split(/\s/)[0];
  if (sha !== remoteSha) throw new Error(`HEAD debe coincidir con origin/${branch}. Sube o incorpora los cambios de esa rama.`);
  for (const service of [backend, frontend]) {
    const target = await render(`/services/${service.id}`, key);
    if (target.type !== service.type || target.rootDir !== service.root || target.branch !== branch ||
        githubRepo(target.repo) !== repo || target.autoDeployTrigger !== "off" ||
        target.serviceDetails?.url?.replace(/\/$/, "") !== service.origin) {
      throw new Error(`${service.root}: comprueba repositorio, rama, raíz, URL y Auto-Deploy en Off en Render.`);
    }
  }
  console.log(`Commit confirmado en GitHub: ${sha.slice(0, 7)}`);

  step = "Preparar backend";
  npm("backend", ["ci", "--no-audit", "--no-fund"]);
  npm("backend", ["test"]);
  step = "Compilar frontend";
  npm("frontend", ["ci", "--include=dev", "--no-audit", "--no-fund"]);
  npm("frontend", ["run", "build"], { API_BASE_URL: backend.origin });

  step = "Aplicar migraciones";
  console.log("Aplicando migraciones a PostgreSQL…");
  npm("backend", ["run", "migrate"], { DATABASE_URL: config.DATABASE_URL }, { quiet: true });
  console.log("Migraciones completadas.");

  step = "Publicar backend";
  await deploy(backend, sha, key);
  step = "Publicar frontend";
  await deploy(frontend, sha, key);

  step = "Verificar la publicación";
  await verify("API /health", `${backend.origin}/health`, async (response) => (await response.json()).status === "ok");
  await verify("Inventario protegido", `${backend.origin}/api/equipos`, (response) =>
    response.headers.get("Access-Control-Allow-Origin") === frontend.origin && response.headers.get("WWW-Authenticate") === "Bearer",
  { Origin: frontend.origin }, 401);
  await verify("Frontend", frontend.origin, async (response) =>
    response.headers.get("Content-Type")?.includes("text/html") && /<html[\s>]/i.test(await response.text()));
  console.log(`Despliegue verificado: ${frontend.origin}`);
}

try {
  await main();
} catch (error) {
  console.error(`Error en «${step}»: ${error.message}`);
  process.exitCode = 1;
}
