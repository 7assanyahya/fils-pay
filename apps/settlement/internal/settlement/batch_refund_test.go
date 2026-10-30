package settlement

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/filspay/settlement/internal/money"
)

func insertSucceededRefund(t *testing.T, pool *pgxpool.Pool, merchantID, txnID uuid.UUID, amount, feeReversed money.Fils, occurredAt time.Time) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(), `
		INSERT INTO refunds (transaction_id, merchant_id, amount_fils, fee_reversed_fils, status,
		                     acquirer_reference, created_by_type, created_by_id, occurred_at)
		VALUES ($1, $2, $3, $4, 'succeeded', 'acq_test', 'merchant_api_key', $5, $6)
		RETURNING id
	`, txnID, merchantID, int64(amount), int64(feeReversed), uuid.New(), occurredAt).Scan(&id)
	if err != nil {
		t.Fatalf("insertSucceededRefund: %v", err)
	}
	return id
}

// FP-212: a refund that happened before the close must come off that
// batch's payout, and be claimed by it so the next batch can't take it again.
func TestCloseBatch_DeductsUnbatchedRefunds(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)

	businessDate := time.Date(2026, 4, 10, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)

	txnID, fee := insertCaptureEvent(t, pool, merchantID, mdrBps, 10_000, start.Add(time.Hour))
	refundID := insertSucceededRefund(t, pool, merchantID, txnID, 4_000, 100, start.Add(2*time.Hour))

	result, err := CloseBatch(context.Background(), pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}

	wantNet := money.Fils(10_000-4_000) - (fee - 100)
	if result.NetPayoutFils != wantNet {
		t.Errorf("NetPayoutFils = %d, want %d (captured 10000, fee %d, refund 4000, fee reversed 100)", result.NetPayoutFils, wantNet, fee)
	}
	if result.GrossFils-result.FeeFils != result.NetPayoutFils {
		t.Errorf("net (%d) must equal gross (%d) - fee (%d)", result.NetPayoutFils, result.GrossFils, result.FeeFils)
	}
	if n := countRows(t, pool, `SELECT COUNT(*) FROM refunds WHERE id = $1 AND settlement_batch_id = $2`, refundID, result.BatchID); n != 1 {
		t.Errorf("refund not claimed by the batch")
	}
}

// A refund bigger than the day's sales must not drive the payout negative;
// it waits for a later batch instead of being dropped.
func TestCloseBatch_RefundLargerThanDayCarriesForward(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)

	day1 := time.Date(2026, 4, 11, 0, 0, 0, 0, time.UTC)
	start1, _ := BusinessDayWindow(day1)
	bigTxn, _ := insertCaptureEvent(t, pool, merchantID, mdrBps, 50_000, start1.Add(-48*time.Hour))
	insertCaptureEvent(t, pool, merchantID, mdrBps, 1_000, start1.Add(time.Hour))
	refundID := insertSucceededRefund(t, pool, merchantID, bigTxn, 20_000, 500, start1.Add(2*time.Hour))

	r1, err := CloseBatch(context.Background(), pool, merchantID, day1)
	if err != nil {
		t.Fatalf("CloseBatch day1: %v", err)
	}
	if r1.NetPayoutFils < 0 {
		t.Fatalf("NetPayoutFils = %d, must never be negative", r1.NetPayoutFils)
	}
	if n := countRows(t, pool, `SELECT COUNT(*) FROM refunds WHERE id = $1 AND settlement_batch_id IS NULL`, refundID); n != 1 {
		t.Fatalf("oversized refund should still be unbatched after day1")
	}

	day2 := day1.AddDate(0, 0, 1)
	start2, _ := BusinessDayWindow(day2)
	insertCaptureEvent(t, pool, merchantID, mdrBps, 30_000, start2.Add(time.Hour))
	r2, err := CloseBatch(context.Background(), pool, merchantID, day2)
	if err != nil {
		t.Fatalf("CloseBatch day2: %v", err)
	}
	if n := countRows(t, pool, `SELECT COUNT(*) FROM refunds WHERE id = $1 AND settlement_batch_id = $2`, refundID, r2.BatchID); n != 1 {
		t.Errorf("refund should be claimed by day2's batch")
	}
	if r2.GrossFils != 30_000-20_000 {
		t.Errorf("day2 GrossFils = %d, want 10000", r2.GrossFils)
	}
}
