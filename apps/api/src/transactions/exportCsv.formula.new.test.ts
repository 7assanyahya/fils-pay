/**
 * Security review: a transaction reference is free text from the merchant's
 * integration (often a customer-supplied order ref). Exported as-is, a value
 * starting with =, +, -, @, tab or CR runs as a formula when the CSV is
 * opened in a spreadsheet (CSV/formula injection). Such cells are prefixed
 * with a single quote. Requires a real, migrated Postgres via DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { Pool } from "pg";
import { buildTransactionsExportCsv } from "./exportCsv.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("exportCsv.formula.new.test.ts requires DATABASE_URL (run `npm run migrate` first)");
}
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
after(async () => {
  await pool.end();
});

test("references that would run as spreadsheet formulas are neutralised", async () => {
  const merchantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
      [`CSV formula ${randomUUID()}`],
    )
  ).rows[0]!.id;
  const refs = ['=HYPERLINK("http://evil.example","x")', "+1+1", "@SUM(A1)", "-2+3", "order-42"];
  for (const ref of refs) {
    await pool.query(
      `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference, reference, occurred_at)
       VALUES ($1, 'captured', 1000, 1000, $2, $3, now())`,
      [merchantId, `acq_${randomUUID()}`, ref],
    );
  }
  const csv = await buildTransactionsExportCsv(pool, { merchantId });
  const referenceCells = csv
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.split(",").slice(4, -1).join(","));
  for (const cell of referenceCells) {
    const value = cell.startsWith('"') ? cell.slice(1) : cell;
    assert.ok(!/^[=+\-@\t\r]/.test(value), `formula-leading cell exported raw: ${cell}`);
  }
  assert.ok(referenceCells.includes("order-42"), "ordinary references are unchanged");
});
