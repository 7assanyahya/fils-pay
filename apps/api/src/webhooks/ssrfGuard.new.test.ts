/**
 * Security review: outbound webhooks must not be usable for SSRF. In
 * production an endpoint can't target loopback/private/link-local hosts,
 * the transport re-checks after DNS, redirects are never followed, and a
 * receiver's response body is read only up to a bound.
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { validateWebhookUrl } from "./create.js";
import { isBlockedAddress } from "./ssrfGuard.js";
import { createFetchTransport } from "./transport.js";

const prod = { nodeEnv: "production" as const };
const dev = { nodeEnv: "development" as const };

async function listen(handler: http.RequestListener): Promise<{ url: string; hits: () => number; close: () => void }> {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/hook`, hits: () => hits, close: () => server.close() };
}

test("isBlockedAddress covers loopback, private, link-local, CGNAT and mapped IPv6", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"]) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

test("production refuses webhook URLs that target internal hosts", () => {
  for (const url of ["https://127.0.0.1/x", "https://localhost/x", "https://169.254.169.254/latest", "https://10.0.0.5/x", "https://[::1]/x"]) {
    assert.throws(() => validateWebhookUrl(url, prod), /invalid_url/, url);
  }
  assert.doesNotThrow(() => validateWebhookUrl("https://example.com/hook", prod));
  // Development keeps local receivers working.
  assert.doesNotThrow(() => validateWebhookUrl("http://127.0.0.1:9/hook", dev));
});

test("the guarded transport never sends to a private destination", async () => {
  const receiver = await listen((_req, res) => res.end("ok"));
  try {
    const send = createFetchTransport({ blockPrivateNetworks: true });
    const res = await send({ url: receiver.url, headers: {}, body: "{}", timeoutMs: 2_000 });
    assert.equal(res.statusCode, null);
    assert.equal(res.errorMessage, "destination_not_allowed");
    assert.equal(receiver.hits(), 0);
  } finally {
    receiver.close();
  }
});

test("redirects are not followed", async () => {
  const target = await listen((_req, res) => res.end("internal"));
  const bouncer = await listen((_req, res) => {
    res.writeHead(302, { location: target.url });
    res.end();
  });
  try {
    const res = await createFetchTransport()({ url: bouncer.url, headers: {}, body: "{}", timeoutMs: 2_000 });
    assert.equal(res.statusCode, 302);
    assert.equal(target.hits(), 0, "the redirect target must not be contacted");
  } finally {
    target.close();
    bouncer.close();
  }
});

test("a huge response body is read only up to the bound", async () => {
  const big = await listen((_req, res) => res.end("x".repeat(2 * 1024 * 1024)));
  try {
    const res = await createFetchTransport()({ url: big.url, headers: {}, body: "{}", timeoutMs: 5_000 });
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.length <= 64 * 1024, `read ${res.body.length} bytes`);
  } finally {
    big.close();
  }
});
