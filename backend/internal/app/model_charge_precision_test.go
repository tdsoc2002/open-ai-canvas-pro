package app

import "testing"

func TestModelChargePrecisionCatalogDoesNotRoundBeforeTheHalfCent(t *testing.T) {
	if got := effectiveCatalogPrice(9_999, 5_000); got != 4_999 {
		t.Fatalf("effective catalog price just below half cent = %d", got)
	}
	if got := effectiveCatalogPrice(10_000, 5_000); got != 5_000 {
		t.Fatalf("effective catalog price at half cent = %d", got)
	}
	if got := effectiveCatalogPrice(1, 1); got != 1 {
		t.Fatalf("tiny positive catalog price = %d", got)
	}
}
