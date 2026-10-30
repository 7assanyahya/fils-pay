package settlement

import (
	"context"
	"testing"
	"time"
)

// QA follow-up (UC8): recalculating at the rate a batch was already charged
// must be a no-op (TestRecalculateMDR_UnchangedRateAdjustsNothing). Three
// cases broke that: a batch that had claimed refunds (their fee reversals
// were charged again), a merchant whose current rate comes from
// fee_schedules rather than merchants.mdr_bps, and a batch with no linked
// capture events, which was re-priced to a fee of zero.

func TestRecalculateMDR_ClaimedRefundsKeepUnchangedRateANoOp(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)

	businessDate := time.Date(2026, 4, 20, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)
	txnID, _ := insertCaptureEvent(t, pool, merchantID, mdrBps, 10_000, start.Add(time.Hour))
	insertSucceededRefund(t, pool, merchantID, txnID, 4_000, 100, start.Add(2*time.Hour))
	if _, err := CloseBatch(ctx, pool, merchantID, businessDate); err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}

	from, to := recalcWindow(businessDate)
	result, err := RecalculateMDR(ctx, pool, merchantID, from, to)
	if err != nil {
		t.Fatalf("RecalculateMDR: %v", err)
	}
	if len(result.Adjusted) != 0 {
		t.Errorf("Adjusted = %+v, want none: the rate did not change", result.Adjusted)
	}
}

func TestRecalculateMDR_UsesTheEffectiveScheduleRate(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	merchantID := insertActiveMerchant(t, pool, 250)
	insertFeeSchedule(t, pool, merchantID, 225, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))

	businessDate := time.Date(2026, 4, 21, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)
	insertCaptureEvent(t, pool, merchantID, 225, 10_000, start.Add(time.Hour))
	closed, err := CloseBatch(ctx, pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	if closed.FeeFils != ComputeSettlementFee(10_000, 225, 0) {
		t.Fatalf("CloseBatch fee = %d, want the 225 bps schedule rate", closed.FeeFils)
	}

	from, to := recalcWindow(businessDate)
	result, err := RecalculateMDR(ctx, pool, merchantID, from, to)
	if err != nil {
		t.Fatalf("RecalculateMDR: %v", err)
	}
	if len(result.Adjusted) != 0 {
		t.Errorf("Adjusted = %+v, want none: the current (schedule) rate is the one already charged", result.Adjusted)
	}
}

func TestRecalculateMDR_BatchWithoutLinkedEventsIsLeftAlone(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	merchantID := insertActiveMerchant(t, pool, 250)
	businessDate := time.Date(2026, 4, 22, 0, 0, 0, 0, time.UTC)

	var batchID string
	err := pool.QueryRow(ctx, `
		INSERT INTO settlement_batches (merchant_id, batch_date, status, gross_fils, fee_fils, net_payout_fils, closed_at)
		VALUES ($1, $2, 'closed', 10000, 250, 9750, now())
		RETURNING id
	`, merchantID, businessDate).Scan(&batchID)
	if err != nil {
		t.Fatalf("insert batch: %v", err)
	}

	from, to := recalcWindow(businessDate)
	result, err := RecalculateMDR(ctx, pool, merchantID, from, to)
	if err != nil {
		t.Fatalf("RecalculateMDR: %v", err)
	}
	if len(result.Adjusted) != 0 {
		t.Errorf("Adjusted = %+v, want none: there are no events to re-price", result.Adjusted)
	}
	var fee, net int64
	if err := pool.QueryRow(ctx, `SELECT fee_fils, net_payout_fils FROM settlement_batches WHERE id = $1`, batchID).Scan(&fee, &net); err != nil {
		t.Fatalf("read batch: %v", err)
	}
	if fee != 250 || net != 9750 {
		t.Errorf("batch rewritten to fee %d / net %d, want 250 / 9750", fee, net)
	}
}
