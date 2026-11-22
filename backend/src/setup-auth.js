import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createAuth, hashPassword } from "./auth.js";

const envFile = new URL("../.env", import.meta.url);
try {
  const current = await readFile(envFile, "utf8");
  const values = parseEnv(current);
  if (values.AUTH_PASSWORD_HASH || values.JWT_SECRET) {
    createAuth(values);
    console.log("El acceso local ya está configurado.");
  } else {
    const username = values.AUTH_USERNAME?.trim() || "demo";
    const password = randomBytes(18).toString("base64url");
    const generated = {
      AUTH_USERNAME: username,
      AUTH_PASSWORD_HASH: await hashPassword(password),
      JWT_SECRET: randomBytes(32).toString("hex"),
    };
    createAuth(generated);
    let output = current.trimEnd();
    for (const [key, value] of Object.entries(generated)) {
      const line = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
      output = line.test(output) ? output.replace(line, () => `${key}=${value}`) : `${output}\n${key}=${value}`;
    }
    await writeFile(envFile, output + "\n", { mode: 0o600 });
    console.log(`Usuario local: ${username}\nContraseña local: ${password}`);
  }
} catch (error) {
  console.error(error.code === "ENOENT" ? "Primero copia backend/.env.example a backend/.env." : error.message);
  process.exitCode = 1;
}
