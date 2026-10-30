package internalapi

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestRebuildBalancesLedger_UsesLedgerTotal(t *testing.T) {
	pool := mustPool(t)
	server := newTestServer(t, pool)

	merchantID := insertActiveMerchant(t, pool)
	// Seed ledger legs: gross capture of 15000 fils (credit to merchant_payable)
	insertCaptureEvent(t, pool, merchantID, 15000, time.Date(2026, 4, 12, 9, 0, 0, 0, time.UTC))

	// Drift cached balance to 999999
	_, err := pool.Exec(context.Background(), `
		INSERT INTO merchant_balances (merchant_id, cached_payable_fils, updated_at)
		VALUES ($1, 999999, now())
		ON CONFLICT (merchant_id) DO UPDATE SET cached_payable_fils = 999999
	`, merchantID)
	if err != nil {
		t.Fatalf("seed drifted cache: %v", err)
	}

	// Seed a conflicting scheme export line with a different amount (7000 fils)
	var batchID uuid.UUID
	err = pool.QueryRow(context.Background(), `
		INSERT INTO settlement_batches (merchant_id, batch_date, status, gross_fils, fee_fils, net_payout_fils, closed_at)
		VALUES ($1, '2026-04-12', 'closed', 7000, 175, 6825, now())
		RETURNING id
	`, merchantID).Scan(&batchID)
	if err != nil {
		t.Fatalf("seed settlement batch: %v", err)
	}
	_, err = pool.Exec(context.Background(), `
		INSERT INTO scheme_export_lines (settlement_batch_id, transaction_id, amount_fils, line_sequence)
		SELECT $1, id, 7000, 1 FROM transactions WHERE merchant_id = $2 LIMIT 1
	`, batchID, merchantID)
	if err != nil {
		t.Fatalf("seed scheme export line: %v", err)
	}

	// Call the new route /internal/rebuild-balances-ledger
	resp := post(t, server, "/internal/rebuild-balances-ledger", "Bearer "+testToken, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	var diffs map[string]rebuildDiffResponse
	decodeJSON(t, resp, &diffs)

	diff, ok := diffs[merchantID.String()]
	if !ok {
		t.Fatalf("response has no diff entry for merchant %s", merchantID)
	}
	if diff.MerchantID != merchantID.String() {
		t.Errorf("merchantId = %q, want %q", diff.MerchantID, merchantID)
	}
	if diff.Before != 999999 {
		t.Errorf("before = %d, want 999999 (the drifted cached value)", diff.Before)
	}
	// Authoritative ledger total is 15000, NOT the scheme export line total 7000
	if diff.After != 15000 {
		t.Errorf("after = %d, want 15000 (the ledger total), got %d (used scheme line?)", diff.After, diff.After)
	}
}
