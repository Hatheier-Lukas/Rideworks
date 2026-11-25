import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

export const COOKIE_NAME = "rideworks_admin";

function secret() {
  if (!process.env.SESSION_SECRET) {
    const error = new Error("Sichere Admin-Sitzungen sind nicht eingerichtet (SESSION_SECRET fehlt).");
    error.statusCode = 503;
    throw error;
  }
  return process.env.SESSION_SECRET;
}

export function sign(value) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  const signature = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verify(token) {
  if (!token || typeof token !== "string") return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", secret()).update(payload).digest();
  let actual;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!value.email || !value.expiresAt || value.expiresAt < Date.now()) return null;
    return value;
  } catch {
    return null;
  }
}

export function getSession(req) {
  const header = req.headers.cookie || "";
  const cookie = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
  return cookie ? verify(decodeURIComponent(cookie.slice(COOKIE_NAME.length + 1))) : null;
}

export function requireAdmin(req) {
  const adminEmail = (process.env.GOOGLE_ADMIN_EMAIL || "hatheierlukas@gmail.com").toLowerCase();
  const session = getSession(req);
  if (!session || session.email.toLowerCase() !== adminEmail) {
    const error = new Error("Admin-Anmeldung erforderlich.");
    error.statusCode = 401;
    throw error;
  }
  return session;
}

export function sessionCookie(token, expiresAt) {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function csrfState() {
  return randomBytes(32).toString("base64url");
}
