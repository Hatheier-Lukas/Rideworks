import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt);
const KEY_LENGTH = 32;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function parsePasswordHash(encodedHash) {
  if (typeof encodedHash !== "string") return null;
  const [algorithm, saltText, keyText, extra] = encodedHash.split("$");
  if (algorithm !== "scrypt" || !saltText || !keyText || extra) return null;

  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(keyText, "base64url");
  return salt.length === 16 && expected.length === KEY_LENGTH ? { salt, expected } : null;
}

export function createPasswordHash(password) {
  if (typeof password !== "string" || password.length < 8 || password.length > 256) {
    throw new Error("Das Passwort muss zwischen 8 und 256 Zeichen lang sein.");
  }
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export function isValidPasswordHash(encodedHash) {
  return Boolean(parsePasswordHash(encodedHash));
}

export async function verifyPassword(password, encodedHash) {
  if (typeof password !== "string" || password.length > 256) return false;
  const parsed = parsePasswordHash(encodedHash);
  if (!parsed) return false;

  const actual = await derive(password, parsed.salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return timingSafeEqual(actual, parsed.expected);
}
