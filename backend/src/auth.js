import { randomBytes, scrypt as derive, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { jwtVerify, SignJWT } from "jose";
import { RequestError, readJsonObject } from "./equipos.js";

const scrypt = promisify(derive);
const issuer = "registro-equipos-api";
const audience = "registro-equipos-web";
const hashLength = 64;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, hashLength);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function createAuth(env = process.env) {
  const { AUTH_USERNAME: username, AUTH_PASSWORD_HASH: stored, JWT_SECRET: secret } = env;
  if (!/^[a-z0-9._-]{1,80}$/i.test(username ?? "") ||
      !/^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(stored ?? "") || !/^[a-f0-9]{64}$/i.test(secret ?? "")) {
    throw new Error("Configura AUTH_USERNAME, AUTH_PASSWORD_HASH y JWT_SECRET. En local, usa npm run auth:setup.");
  }
  const [salt, hash] = stored.split(":").map((value) => Buffer.from(value, "hex"));
  const key = Buffer.from(secret, "hex");
  let pending = 0;

  return {
    async signIn(request) {
      const { username: submitted, password } = await readJsonObject(request);
      if (typeof submitted !== "string" || !submitted || submitted.length > 80 ||
          typeof password !== "string" || !password || password.length > 128) {
        throw new RequestError(400, "Ingresa tu usuario y tu contraseña.");
      }
      if (pending >= 4) {
        throw new RequestError(429, "Hay varios intentos en curso. Inténtalo de nuevo en unos segundos.");
      }
      pending += 1;
      try {
        const candidate = await scrypt(password, salt, hashLength);
        if (!timingSafeEqual(hash, candidate) || submitted.trim() !== username) {
          throw new RequestError(401, "Usuario o contraseña incorrectos.");
        }
        return new SignJWT({})
          .setProtectedHeader({ alg: "HS256", typ: "JWT" })
          .setIssuer(issuer)
          .setAudience(audience)
          .setSubject(username)
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(key);
      } finally {
        pending -= 1;
      }
    },
    async verify(authorization) {
      const token = authorization?.match(/^Bearer ([A-Za-z0-9_.-]+)$/i)?.[1];
      if (!token) return false;
      try {
        await jwtVerify(token, key, {
          algorithms: ["HS256"],
          typ: "JWT",
          issuer,
          audience,
          subject: username,
          requiredClaims: ["exp", "iat"],
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}
