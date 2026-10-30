package settlement

import (
	"context"
	"testing"
	"time"

	"github.com/filspay/settlement/internal/money"
)

func TestCloseBatch_JournalsSchemeRoundingResidue(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	businessDate := time.Date(2026, 4, 15, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)

	// Capture 1: 4,755 fils (residue 5 fils)
	txn1, _ := insertCaptureEvent(t, pool, merchantID, mdrBps, money.Fils(4755), start.Add(time.Hour))
	// Capture 2: 1,333 fils (residue 3 fils)
	txn2, _ := insertCaptureEvent(t, pool, merchantID, mdrBps, money.Fils(1333), start.Add(2*time.Hour))

	result, err := CloseBatch(ctx, pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}

	// 1. Assert residue legs total 5 + 3 = 8 fils
	var residueTotal int64
	var residueLegCount int
	err = pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_fils), 0), count(*)
		  FROM ledger_entries
		 WHERE settlement_batch_id = $1
		   AND account_id = 'scheme_rounding_residue'
		   AND direction = 'debit'
	`, result.BatchID).Scan(&residueTotal, &residueLegCount)
	if err != nil {
		t.Fatalf("query residue legs: %v", err)
	}

	if residueLegCount != 2 {
		t.Fatalf("residue leg count = %d, want 2 (one per non-zero residue txn)", residueLegCount)
	}
	if residueTotal != 8 {
		t.Fatalf("residue total = %d fils, want 8 fils (5 + 3)", residueTotal)
	}

	// 2. Each entry_group_id must net to 0
	var unbalancedGroups int
	err = pool.QueryRow(ctx, `
		SELECT count(*) FROM (
			SELECT entry_group_id,
			       SUM(CASE WHEN direction = 'debit' THEN amount_fils ELSE -amount_fils END) AS net
			  FROM ledger_entries
			 WHERE settlement_batch_id = $1
			 GROUP BY entry_group_id
			HAVING SUM(CASE WHEN direction = 'debit' THEN amount_fils ELSE -amount_fils END) != 0
		) sub
	`, result.BatchID).Scan(&unbalancedGroups)
	if err != nil {
		t.Fatalf("query group balance: %v", err)
	}
	if unbalancedGroups != 0 {
		t.Errorf("found %d unbalanced entry groups for batch", unbalancedGroups)
	}

	// 3. card_scheme_clearing net for the batch equals sum of scheme_export_lines.amount_fils
	// Captures debited clearing by 4755 + 1333 = 6088 fils.
	// Residue credited clearing by 5 + 3 = 8 fils.
	// Net clearing debit = 6088 - 8 = 6080 fils.
	// Scheme export lines: 4750 + 1330 = 6080 fils.
	var clearingNetDebit int64
	err = pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_fils ELSE -amount_fils END), 0)
		  FROM ledger_entries
		 WHERE transaction_id IN ($1, $2)
		   AND account_id = 'card_scheme_clearing'
	`, txn1, txn2).Scan(&clearingNetDebit)
	if err != nil {
		t.Fatalf("query card_scheme_clearing net: %v", err)
	}

	var schemeExportTotal int64
	err = pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_fils), 0)
		  FROM scheme_export_lines
		 WHERE settlement_batch_id = $1
	`, result.BatchID).Scan(&schemeExportTotal)
	if err != nil {
		t.Fatalf("query scheme_export_lines sum: %v", err)
	}

	if schemeExportTotal != 6080 {
		t.Fatalf("scheme_export_lines total = %d, want 6080", schemeExportTotal)
	}
	if clearingNetDebit != schemeExportTotal {
		t.Errorf("card_scheme_clearing net debit (%d) != scheme_export_lines total (%d)", clearingNetDebit, schemeExportTotal)
	}
}
