package settlement

import (
	"context"
	"testing"

	"github.com/filspay/settlement/internal/money"
)

// Finance memo: "Lifetime payout estimate drifts for high-volume merchants".
// Past 2^24 fils a float32/REAL accumulator can't represent every integer,
// so adding a payout of 1 fils (or any odd amount) gets rounded away.
func TestUpdateLifetimePayoutMonitoringEstimate_LargeValuesExact(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	merchantID := insertActiveMerchant(t, pool, 250)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	payouts := []money.Fils{40_000_000, 1, 3, 2_500_007}
	var want int64
	for _, net := range payouts {
		want += int64(net)
		if err := UpdateLifetimePayoutMonitoringEstimate(ctx, tx, merchantID, net); err != nil {
			t.Fatalf("UpdateLifetimePayoutMonitoringEstimate(%d): %v", net, err)
		}
	}

	var got float64
	if err := tx.QueryRow(ctx, `SELECT lifetime_net_payout_monitoring_estimate FROM merchants WHERE id = $1`, merchantID).Scan(&got); err != nil {
		t.Fatalf("read back estimate: %v", err)
	}
	if int64(got) != want {
		t.Fatalf("estimate = %.0f, want exactly %d", got, want)
	}
}
