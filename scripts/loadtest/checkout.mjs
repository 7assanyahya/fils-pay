#!/usr/bin/env node
// Checkout load test: the "buyer pays a payment link" scenario.
//
// Each simulated user creates nothing; links are created up front with the
// merchant's API key, then every user does what the checkout page does:
// GET the public link, then POST /pay with a fresh Idempotency-Key.
// No dependencies (Node 20+ fetch), so nothing is downloaded to run it.
//
// Usage:
//   API=http://localhost:3000 API_KEY=fp_test_... MERCHANT_ID=<uuid> \
//     node scripts/loadtest/checkout.mjs --users 200 --concurrency 20
//
// Prints status-code counts, latency percentiles and throughput as JSON.
// Correctness is checked separately in SQL (see docs/CAPACITY.md): every
// paid link has exactly one captured transaction and the ledger balances.

import { randomUUID } from "node:crypto";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const API = process.env.API ?? "http://localhost:3000";
const API_KEY = process.env.API_KEY;
const MERCHANT_ID = process.env.MERCHANT_ID;
const USERS = Number(args.users ?? 100);
const CONCURRENCY = Number(args.concurrency ?? 10);
const AMOUNT = Number(args.amount ?? 1000);
const CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

if (!API_KEY || !MERCHANT_ID) {
  console.error("API_KEY and MERCHANT_ID are required");
  process.exit(2);
}

async function createLinks(n) {
  const tokens = [];
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  const queue = Array.from({ length: n }, (_, i) => i);
  async function worker() {
    while (queue.length) {
      const i = queue.shift();
      const res = await fetch(`${API}/v1/merchants/${MERCHANT_ID}/payment-links`, {
        method: "POST",
        headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ amountFils: AMOUNT, reference: `load-${Date.now()}-${i}`, expiresAt }),
      });
      if (res.status !== 201) throw new Error(`create link: ${res.status} ${await res.text()}`);
      tokens.push((await res.json()).token);
    }
  }
  await Promise.all(Array.from({ length: Math.min(10, n) }, worker));
  return tokens;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main() {
  const tokens = await createLinks(USERS);
  const statuses = {};
  const latencies = [];
  const started = performance.now();
  const queue = [...tokens];

  async function user() {
    while (queue.length) {
      const token = queue.shift();
      const t0 = performance.now();
      let code;
      try {
        const read = await fetch(`${API}/v1/payment-links/${token}`);
        await read.arrayBuffer();
        const pay = await fetch(`${API}/v1/payment-links/${token}/pay`, {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": randomUUID() },
          body: JSON.stringify({ card: CARD }),
        });
        await pay.arrayBuffer();
        code = read.status === 200 ? String(pay.status) : `read_${read.status}`;
      } catch (err) {
        code = `error_${err.cause?.code ?? err.name}`;
      }
      latencies.push(performance.now() - t0);
      statuses[code] = (statuses[code] ?? 0) + 1;
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, user));
  const seconds = (performance.now() - started) / 1000;
  latencies.sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        users: USERS,
        concurrency: CONCURRENCY,
        seconds: Number(seconds.toFixed(2)),
        checkoutsPerSecond: Number((USERS / seconds).toFixed(2)),
        statuses,
        latencyMs: {
          p50: Math.round(percentile(latencies, 50)),
          p95: Math.round(percentile(latencies, 95)),
          p99: Math.round(percentile(latencies, 99)),
          max: Math.round(latencies[latencies.length - 1]),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
