/**
 * UC7 (QA pass): a malformed JSON request body is a client error. Fastify's
 * body parser (and the acquirer callback route's raw-body parser) reject it
 * with statusCode 400, but the error handler used to ignore that and answer
 * 500 internal_error. Requires DATABASE_URL (buildApp opens a pool lazily).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("errorHandler.badJson.new.test.ts requires DATABASE_URL (run `npm run migrate` first)");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

test("malformed JSON bodies answer 400, not 500", async () => {
  for (const url of ["/v1/acquirer/callbacks", "/v1/auth/login", "/v1/transactions"]) {
    const res = await app.inject({
      method: "POST",
      url,
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    assert.equal(res.statusCode, 400, `${url} -> ${res.statusCode} ${res.body}`);
  }
});
