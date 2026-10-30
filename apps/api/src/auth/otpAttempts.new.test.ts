/**
 * OTP hardening: a burst of parallel wrong guesses can't exceed
 * max_attempts, and codes come from the CSPRNG.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { randomDigits } from "../lib/random.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("otpAttempts.new.test.ts requires DATABASE_URL");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  OTP_DEV_EXPOSE: "true",
  OTP_MAX_ATTEMPTS: "5",
  INTERNAL_API_TOKEN: "test-internal-token",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});

const pool = new Pool({ connectionString: databaseUrl, max: 10 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

test("40 parallel wrong OTP guesses: at most max_attempts are evaluated, then the real code is refused", async () => {
  const email = `otp-race-${randomUUID()}@example.test`;
  const password = "correct horse battery staple 1!";
  const signup = await app.inject({
    method: "POST",
    url: "/v1/merchants",
    payload: {
      businessProfile: {
        legalName: `OTP Race ${randomUUID()}`,
        registrationNumber: `RC-${randomUUID().slice(0, 8)}`,
        businessType: "llc",
        contactEmail: `c-${randomUUID()}@example.test`,
        contactPhone: "+97300000000",
        addressLine1: "1 Test Street",
        city: "Manama",
      },
      owner: { email, password },
    },
  });
  assert.equal(signup.statusCode, 201, signup.body);
  const { merchantId } = signup.json() as { merchantId: string };

  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { merchantId, email, password } });
  assert.equal(login.statusCode, 200, login.body);
  const realCode = (login.json() as { devOtpCode: string }).devOtpCode;
  const setCookie = login.headers["set-cookie"];
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(";")[0]!;

  const wrong = realCode === "000000" ? "000001" : "000000";
  const guesses = await Promise.all(
    Array.from({ length: 40 }, () =>
      app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie }, payload: { code: wrong } }),
    ),
  );
  const evaluated = guesses.filter((r) => r.statusCode === 401 && r.json().error === "invalid_code").length;
  assert.ok(evaluated <= 5, `only max_attempts guesses may be checked, got ${evaluated}`);

  const final = await app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    headers: { cookie },
    payload: { code: realCode },
  });
  assert.notEqual(final.statusCode, 200, "the correct code must not work once attempts are exhausted");
});

test("randomDigits never calls Math.random", () => {
  const original = Math.random;
  Math.random = () => {
    throw new Error("Math.random used for a secret");
  };
  try {
    const code = randomDigits(6);
    assert.match(code, /^\d{6}$/);
  } finally {
    Math.random = original;
  }
});
