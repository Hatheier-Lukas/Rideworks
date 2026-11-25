import { randomBytes } from "node:crypto";
import { isValidPasswordHash, verifyPassword } from "../../lib/password.js";
import { sign, sessionCookie } from "../../lib/session.js";

const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

function requestIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  return ((typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "") ||
    req.socket?.remoteAddress || "unknown").slice(0, 128);
}

function rateLimited(ip, now = Date.now()) {
  const current = attempts.get(ip);
  if (!current || now - current.startedAt >= WINDOW_MS) return false;
  return current.failures >= MAX_FAILURES;
}

function recordFailure(ip, now = Date.now()) {
  if (attempts.size >= 1000 && !attempts.has(ip)) {
    const oldestIp = attempts.keys().next().value;
    if (oldestIp) attempts.delete(oldestIp);
  }
  const current = attempts.get(ip);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    attempts.set(ip, { startedAt: now, failures: 1 });
  } else {
    current.failures++;
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Methode nicht erlaubt." });
  }

  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== (req.headers["x-forwarded-host"] || req.headers.host)) {
        return res.status(403).json({ error: "Ungültige Anfragequelle." });
      }
    } catch {
      return res.status(403).json({ error: "Ungültige Anfragequelle." });
    }
  }

  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!username || username.length > 120 || !password || password.length > 256) {
    return res.status(400).json({ error: "Benutzername und Passwort sind erforderlich." });
  }

  const adminUsername = process.env.ADMIN_USERNAME || "admin";
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  const sessionSecret = process.env.SESSION_SECRET;
  if (!isValidPasswordHash(passwordHash) || !sessionSecret) {
    return res.status(503).json({
      error: "Passwort-Login ist nicht eingerichtet. Prüfe ADMIN_PASSWORD_HASH und SESSION_SECRET."
    });
  }

  const ip = requestIp(req);
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "Zu viele Anmeldeversuche. Bitte später erneut versuchen." });
  }

  const passwordMatches = await verifyPassword(password, passwordHash);
  const email = (process.env.GOOGLE_ADMIN_EMAIL || "hatheierlukas@gmail.com").toLowerCase();
  const usernameMatches = username.toLowerCase() === adminUsername.toLowerCase() ||
    username.toLowerCase() === email;
  if (!usernameMatches || !passwordMatches) {
    recordFailure(ip);
    return res.status(401).json({ error: "Benutzername oder Passwort ist falsch." });
  }

  attempts.delete(ip);
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  const token = sign({ email, expiresAt, authMethod: "password", sessionId: randomBytes(16).toString("base64url") });
  res.setHeader("Set-Cookie", sessionCookie(token, expiresAt));
  return res.status(200).json({ admin: true });
}
