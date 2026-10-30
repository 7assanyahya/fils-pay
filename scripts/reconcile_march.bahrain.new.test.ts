import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "pg";
import {
  bahrainMonthBounds,
  fetchResidueRows,
  postResidueCorrection,
} from "./reconcile_march.js";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://filspay:filspay_dev_password@localhost:5432/filspay?sslmode=disable";

test("bahrainMonthBounds shifts UTC bounds by -3 hours for Asia/Bahrain", () => {
  const { start, end } = bahrainMonthBounds(2026, 3);
  assert.equal(start.toISOString(), "2026-02-28T21:00:00.000Z");
  assert.equal(end.toISOString(), "2026-03-31T21:00:00.000Z");
});

test("fetchResidueRows uses Bahrain month window and postResidueCorrection touches no merchant_payable", async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const merchantRes = await client.query<{ id: string }>(
      `INSERT INTO merchants (display_name, mdr_bps, status, test_mode)
       VALUES ('reconcile-march-test-' || gen_random_uuid(), 250, 'active', false)
       RETURNING id`,
    );
    const merchantId = merchantRes.rows[0]!.id;

    // Txn 1: 2026-02-28T22:00Z -> In Bahrain this is 2026-03-01 01:00 (inside March). Must be INCLUDED.
    await client.query(
      `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference, occurred_at)
       VALUES ($1, 'captured', 1007, 1007, 'acq-ref-' || gen_random_uuid(), '2026-02-28T22:00:00Z')`,
      [merchantId],
    );

    // Txn 2: 2026-03-31T22:00Z -> In Bahrain this is 2026-04-01 01:00 (inside April). Must be EXCLUDED.
    await client.query(
      `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference, occurred_at)
       VALUES ($1, 'captured', 2003, 2003, 'acq-ref-' || gen_random_uuid(), '2026-03-31T22:00:00Z')`,
      [merchantId],
    );

    const rows = await fetchResidueRows(client, 2026, 3);
    const merchantRows = rows.filter((r) => r.merchantId === merchantId);

    assert.equal(merchantRows.length, 1, "exactly one transaction should fall within the Bahrain March window");
    assert.equal(merchantRows[0]!.capturedFils, 1007, "2026-02-28T22:00Z (March in Bahrain) must be included");

    // Post correction
    await postResidueCorrection(
      client,
      { merchantId, lineCount: 1, residueFils: 7 },
      new Date("2026-04-05T12:00:00Z"),
    );

    // Verify ledger entries
    const ledgerRows = await client.query<{
      account_id: string;
      direction: string;
      amount_fils: string;
    }>(
      `SELECT account_id, direction, amount_fils FROM ledger_entries WHERE merchant_id = $1`,
      [merchantId],
    );

    assert.equal(ledgerRows.rows.length, 2, "must insert 2 ledger legs");
    const accounts = ledgerRows.rows.map((r) => r.account_id);
    assert.ok(
      !accounts.includes("merchant_payable"),
      "must NOT touch merchant_payable (residue is not charged to merchant)",
    );

    const clearingLeg = ledgerRows.rows.find((r) => r.account_id === "card_scheme_clearing");
    assert.ok(clearingLeg, "must have card_scheme_clearing leg");
    assert.equal(clearingLeg.direction, "credit");
    assert.equal(Number(clearingLeg.amount_fils), 7);

    const residueLeg = ledgerRows.rows.find((r) => r.account_id === "scheme_rounding_residue");
    assert.ok(residueLeg, "must have scheme_rounding_residue leg");
    assert.equal(residueLeg.direction, "debit");
    assert.equal(Number(residueLeg.amount_fils), 7);
  } finally {
    await client.end();
  }
});
