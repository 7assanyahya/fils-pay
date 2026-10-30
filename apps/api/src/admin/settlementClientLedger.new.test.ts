import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import {
  triggerLedgerBalanceRebuild,
  type SettlementInternalConfig,
} from "./settlementClient.js";

interface FakeSettlement {
  url: string;
  requests: Array<{ method: string; path: string; authorization?: string; body: string }>;
  close: () => Promise<void>;
}

async function startFakeSettlement(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void,
): Promise<FakeSettlement> {
  const requests: FakeSettlement["requests"] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({
        method: req.method ?? "",
        path: req.url ?? "",
        authorization: req.headers.authorization,
        body,
      });
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("startFakeSettlement: could not determine listening port");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function configFor(url: string, timeoutMs = 5_000): SettlementInternalConfig {
  return {
    settlementInternalUrl: url,
    settlementInternalToken: "test-settlement-token",
    settlementInternalRequestTimeoutMs: timeoutMs,
  };
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": bytes.length,
  });
  res.end(bytes);
}

test("triggerLedgerBalanceRebuild posts to /internal/rebuild-balances-ledger", async () => {
  const fake = await startFakeSettlement((_req, res) => {
    sendJson(res, 200, {
      "11111111-1111-1111-1111-111111111111": {
        MerchantID: "11111111-1111-1111-1111-111111111111",
        CachedBefore: 100,
        Rebuilt: 250,
      },
    });
  });
  try {
    const summary = await triggerLedgerBalanceRebuild(configFor(fake.url));
    assert.equal(fake.requests[0]!.path, "/internal/rebuild-balances-ledger");
    assert.equal(fake.requests[0]!.authorization, "Bearer test-settlement-token");
    assert.equal(summary.rebuiltCount, 1);
    assert.equal(summary.changed.length, 1);
    assert.equal(summary.changed[0]!.merchantId, "11111111-1111-1111-1111-111111111111");
    assert.equal(summary.changed[0]!.before, 100);
    assert.equal(summary.changed[0]!.after, 250);
  } finally {
    await fake.close();
  }
});
