package settlement

import (
	"context"
	"testing"
	"time"
)

// Finance memo: "MDR recalculation changed batches that were already paid
// out. Those should never change." A paid batch's figures stay as paid; the
// difference is still posted to the ledger.
func TestRecalculateMDR_PaidBatchFiguresNeverChange(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	const originalMdrBps = 250
	merchantID := insertActiveMerchant(t, pool, originalMdrBps)

	businessDate := time.Date(2026, 4, 3, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)
	insertCaptureEvent(t, pool, merchantID, originalMdrBps, 8_000, start.Add(time.Hour))

	closed, err := CloseBatch(ctx, pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	if _, err := PayoutBatch(ctx, pool, closed.BatchID); err != nil {
		t.Fatalf("PayoutBatch: %v", err)
	}

	if _, err := pool.Exec(ctx, `UPDATE merchants SET mdr_bps = 300 WHERE id = $1`, merchantID); err != nil {
		t.Fatalf("update mdr_bps: %v", err)
	}
	from, to := recalcWindow(businessDate)
	result, err := RecalculateMDR(ctx, pool, merchantID, from, to)
	if err != nil {
		t.Fatalf("RecalculateMDR: %v", err)
	}
	if len(result.Adjusted) != 1 {
		t.Fatalf("len(Adjusted) = %d, want 1 (the difference is still recognised)", len(result.Adjusted))
	}

	var fee, net int64
	if err := pool.QueryRow(ctx, `SELECT fee_fils, net_payout_fils FROM settlement_batches WHERE id = $1`, closed.BatchID).
		Scan(&fee, &net); err != nil {
		t.Fatalf("read batch: %v", err)
	}
	if fee != int64(closed.FeeFils) || net != int64(closed.NetPayoutFils) {
		t.Errorf("paid batch changed: fee %d->%d, net %d->%d", closed.FeeFils, fee, closed.NetPayoutFils, net)
	}
	if n := countRows(t, pool, `SELECT COUNT(*) FROM ledger_entries WHERE settlement_batch_id = $1 AND description = 'MDR recalculation adjustment'`, closed.BatchID); n != 2 {
		t.Errorf("adjustment legs = %d, want 2", n)
	}
}
