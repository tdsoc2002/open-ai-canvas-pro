package database

import "testing"

func TestMigrateModelChargePrecisionDoesNotRepriceExistingOrders(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-model-charge-v105?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE TABLE billing_orders (id TEXT PRIMARY KEY, amount_microcredits BIGINT NOT NULL)").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO billing_orders (id, amount_microcredits) VALUES ('old', 45000)").Error; err != nil {
		t.Fatal(err)
	}
	latest := schemaMigrations[len(schemaMigrations)-1]
	for range 2 {
		if err := latest.apply(db); err != nil {
			t.Fatal(err)
		}
	}
	var old struct {
		RoundChargeToCent  bool
		AmountMicrocredits int64
	}
	if err := db.Table("billing_orders").Where("id = ?", "old").Take(&old).Error; err != nil {
		t.Fatal(err)
	}
	if old.RoundChargeToCent || old.AmountMicrocredits != 45_000 {
		t.Fatalf("existing order changed: %+v", old)
	}
}
