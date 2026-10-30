package settlement

import (
	"context"
	"testing"
)

func TestRecordPlatformProcessedVolume_BeyondInt32(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	resetPlatformStats(t, pool)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Set initial counter to 2,147,000,000 (fits in int32)
	_, err = tx.Exec(ctx, `UPDATE platform_stats SET total_processed_fils = $1 WHERE id = 1`, 2_147_000_000)
	if err != nil {
		t.Fatalf("seed initial total: %v", err)
	}

	current, err := ReadAndLockPlatformProcessedFils(ctx, tx)
	if err != nil {
		t.Fatalf("ReadAndLockPlatformProcessedFils: %v", err)
	}

	// Record 1,000,000 fils -> sum is 2,148,000,000 (exceeds int32 max 2,147,483,647)
	if err := RecordPlatformProcessedVolume(ctx, tx, current, 1_000_000); err != nil {
		t.Fatalf("RecordPlatformProcessedVolume: %v", err)
	}

	var got int64
	err = tx.QueryRow(ctx, `SELECT total_processed_fils FROM platform_stats WHERE id = 1`).Scan(&got)
	if err != nil {
		t.Fatalf("read back total: %v", err)
	}

	const want int64 = 2_148_000_000
	if got != want {
		t.Fatalf("total_processed_fils = %d, want %d (wrapped negative or truncated?)", got, want)
	}
}
