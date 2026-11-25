import test from "node:test";
import assert from "node:assert/strict";
import { createPasswordHash, isValidPasswordHash, verifyPassword } from "../lib/password.js";

test("scrypt password hashes verify only the matching password", async () => {
  const encoded = createPasswordHash("test-password-123");
  assert.match(encoded, /^scrypt\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.equal(isValidPasswordHash(encoded), true);
  assert.equal(await verifyPassword("test-password-123", encoded), true);
  assert.equal(await verifyPassword("wrong-password", encoded), false);
  assert.equal(await verifyPassword("test-password-123", "invalid"), false);
  assert.equal(isValidPasswordHash("invalid"), false);
});

test("password hashing rejects weak or oversized input", () => {
  assert.throws(() => createPasswordHash("short"));
  assert.throws(() => createPasswordHash("x".repeat(257)));
});
