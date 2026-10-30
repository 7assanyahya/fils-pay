/**
 * Security review: merchant login had no limit on failed passwords, and a
 * known password could mint unlimited 5-guess OTP challenges. Requires a
 * real, migrated Postgres via DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { hashPassword } from "./passwords.js";
import { createLoginThrottle, LOGIN_WINDOW_MS, MAX_CHALLENGES, MAX_FAILED_LOGINS } from "./loginThrottle.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("loginThrottle.new.test.ts requires DATABASE_URL (run `npm run migrate` first)");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  OTP_DEV_EXPOSE: "true",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const app = buildApp(config, pool);
const PASSWORD = "throttle-test-password!";

test.after(async () => {
  await app.close();
  await pool.end();
});

async function merchantUser(): Promise<{ merchantId: string; email: string }> {
  const merchantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
      [`Throttle ${randomUUID()}`],
    )
  ).rows[0]!.id;
  const email = `owner-${randomUUID()}@example.test`;
  await pool.query(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', $3)`,
    [merchantId, email, await hashPassword(PASSWORD, config)],
  );
  return { merchantId, email };
}

function login(merchantId: string, email: string, password: string) {
  return app.inject({ method: "POST", url: "/v1/auth/login", payload: { merchantId, email, password } });
}

test("failed passwords lock the account out with 429; other accounts are unaffected", async () => {
  const a = await merchantUser();
  const b = await merchantUser();
  for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
    assert.equal((await login(a.merchantId, a.email, "wrong")).statusCode, 401);
  }
  assert.equal((await login(a.merchantId, a.email, "wrong")).statusCode, 429);
  assert.equal((await login(a.merchantId, a.email, PASSWORD)).statusCode, 429, "even the right password waits");
  assert.equal((await login(b.merchantId, b.email, PASSWORD)).statusCode, 200);
});

test("a known password cannot mint unlimited OTP challenges", async () => {
  const a = await merchantUser();
  for (let i = 0; i < MAX_CHALLENGES; i++) {
    assert.equal((await login(a.merchantId, a.email, PASSWORD)).statusCode, 200);
  }
  assert.equal((await login(a.merchantId, a.email, PASSWORD)).statusCode, 429);
});

test("the window expires", () => {
  let now = 1_000_000;
  const throttle = createLoginThrottle(() => now);
  for (let i = 0; i < MAX_FAILED_LOGINS; i++) throttle.recordFailure("k");
  assert.throws(() => throttle.assertCanAttempt("k"), /too_many_login_attempts/);
  now += LOGIN_WINDOW_MS + 1;
  assert.doesNotThrow(() => throttle.assertCanAttempt("k"));
});
