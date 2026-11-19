package database

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

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
	for range 2 {
		if err := migrateModelChargePrecision(db); err != nil {
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

func openModelChargeMigrationTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := Open(Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "joysee-migration.db")})
	if err != nil {
		t.Fatal(err)
	}
	conn, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return db
}

func TestMigrateLegacyJoyseeModelChargeLedger(t *testing.T) {
	t.Run("SQLite", func(t *testing.T) {
		verifyLegacyJoyseeModelChargeLedger(t, openModelChargeMigrationTestDB(t))
	})
	t.Run("PostgreSQL", func(t *testing.T) {
		dsn := strings.TrimSpace(os.Getenv("CANVAS_TEST_POSTGRES_DSN"))
		if dsn == "" {
			t.Skip("CANVAS_TEST_POSTGRES_DSN is not configured")
		}
		base, err := Open(Config{Driver: "postgres", DSN: dsn})
		if err != nil {
			t.Fatal(err)
		}
		conn, err := base.DB()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = conn.Close() })
		schema := fmt.Sprintf("test_joysee_migration_%d", time.Now().UnixNano())
		if err := base.Exec("CREATE SCHEMA " + schema).Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if err := base.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
				t.Error(err)
			}
		})
		dsn, err = postgresDSNWithSearchPath(dsn, schema)
		if err != nil {
			t.Fatal(err)
		}
		db, err := Open(Config{Driver: "postgres", DSN: dsn})
		if err != nil {
			t.Fatal(err)
		}
		isolated, err := db.DB()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = isolated.Close() })
		verifyLegacyJoyseeModelChargeLedger(t, db)
	})
}

func verifyLegacyJoyseeModelChargeLedger(t *testing.T, db *gorm.DB) {
	t.Helper()
	// Use the shared migration plan through v104, then record the precise
	// migration identity used by the old Joysee branch.
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	appliedAt := time.Date(2026, time.November, 1, 0, 0, 0, 0, time.UTC)
	for _, step := range schemaMigrations {
		if step.version >= 105 {
			break
		}
		if err := step.apply(db); err != nil {
			t.Fatalf("fixture migration %d: %v", step.version, err)
		}
		if err := db.Create(&schemaMigration{Version: step.version, Name: step.name, Checksum: step.checksum, AppliedAt: appliedAt}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := migrateModelChargePrecision(db); err != nil {
		t.Fatal(err)
	}
	for _, order := range []model.BillingOrder{
		{ID: "old", UserID: "test-user", IdempotencyKey: "old", AmountMicrocredits: 45_000},
		{ID: "joysee", UserID: "test-user", IdempotencyKey: "joysee", AmountMicrocredits: 50_000, RoundChargeToCent: true},
	} {
		if err := db.Create(&order).Error; err != nil {
			t.Fatal(err)
		}
	}
	if db.Migrator().HasColumn(&model.BillingOrder{}, "image_pricing") {
		if err := db.Migrator().DropColumn(&model.BillingOrder{}, "image_pricing"); err != nil {
			t.Fatal(err)
		}
	}
	legacy := schemaMigration{Version: 105, Name: "model_charge_cent_precision", Checksum: "sha256:model-charge-cent-precision-v105", AppliedAt: appliedAt}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := MigrateSchema(db); err != nil {
			t.Fatalf("upgrade old Joysee schema: %v", err)
		}
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != CurrentSchemaVersion || status.YingceCurrent != int64(len(yingceSchemaMigrations)) {
		t.Fatalf("schema not ready: %+v, %v", status, err)
	}
	var upstream schemaMigration
	if err := db.First(&upstream, "version = ?", 105).Error; err != nil || upstream.Name != "image_usage_billing" || upstream.Checksum != "sha256:image-usage-billing-v105" {
		t.Fatalf("upstream migration not installed: %+v, %v", upstream, err)
	}
	if !db.Migrator().HasColumn(&model.BillingOrder{}, "image_pricing") || !db.Migrator().HasTable(&model.Team{}) {
		t.Fatal("upstream billing or team schema was not added")
	}
	var moved yingceSchemaMigration
	if err := db.First(&moved, "version = ?", 5).Error; err != nil || moved.Name != legacy.Name || moved.Checksum != legacy.Checksum || !moved.AppliedAt.Equal(legacy.AppliedAt) {
		t.Fatalf("legacy record not relocated: %+v, %v", moved, err)
	}
	for _, want := range []model.BillingOrder{
		{ID: "old", AmountMicrocredits: 45_000},
		{ID: "joysee", AmountMicrocredits: 50_000, RoundChargeToCent: true},
	} {
		var got model.BillingOrder
		if err := db.First(&got, "id = ?", want.ID).Error; err != nil || got.AmountMicrocredits != want.AmountMicrocredits || got.RoundChargeToCent != want.RoundChargeToCent {
			t.Fatalf("order %s amount or rounding changed: %d, %v; %v", want.ID, got.AmountMicrocredits, got.RoundChargeToCent, err)
		}
	}
}

func TestMigrateModelChargePrecisionDoesNotAcceptMissingBillingTable(t *testing.T) {
	db := openModelChargeMigrationTestDB(t)
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Where("version = ?", modelChargePrecisionExtensionVersion).Delete(&yingceSchemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&model.BillingOrder{}); err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err == nil || !strings.Contains(err.Error(), "billing_orders") {
		t.Fatalf("expected missing billing_orders to be rejected, got %v", err)
	}
	var count int64
	if err := db.Model(&yingceSchemaMigration{}).Where("version = ?", modelChargePrecisionExtensionVersion).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("missing table must not record migration: count=%d, err=%v", count, err)
	}
}

func TestMigrateModelChargePrecisionFromUpstream108(t *testing.T) {
	db := openModelChargeMigrationTestDB(t)
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Where("version = ?", modelChargePrecisionExtensionVersion).Delete(&yingceSchemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropColumn(&model.BillingOrder{}, "RoundChargeToCent"); err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasColumn(&model.BillingOrder{}, "RoundChargeToCent") {
		t.Fatal("the model charge precision column was not added")
	}
	if err := RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}
}

func TestMigrateLegacyJoyseeModelChargeRejectsUnverifiedRecord(t *testing.T) {
	for _, fixture := range []struct {
		name, checksum, wantError string
	}{
		{"wrong checksum", "invalid", "校验和不一致"},
		{"missing column", "sha256:model-charge-cent-precision-v105", "精度字段缺失"},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			db := openModelChargeMigrationTestDB(t)
			if err := db.AutoMigrate(&schemaMigration{}); err != nil {
				t.Fatal(err)
			}
			if err := db.Exec("CREATE TABLE billing_orders (id TEXT PRIMARY KEY, amount_microcredits BIGINT NOT NULL)").Error; err != nil {
				t.Fatal(err)
			}
			legacy := schemaMigration{Version: 105, Name: "model_charge_cent_precision", Checksum: fixture.checksum, AppliedAt: time.Now().UTC()}
			if err := db.Create(&legacy).Error; err != nil {
				t.Fatal(err)
			}
			if err := MigrateSchema(db); err == nil || !strings.Contains(err.Error(), fixture.wantError) {
				t.Fatalf("expected %q rejection, got %v", fixture.wantError, err)
			}
			var got schemaMigration
			if err := db.First(&got, "version = ?", 105).Error; err != nil || got.Name != legacy.Name || got.Checksum != legacy.Checksum {
				t.Fatalf("legacy ledger changed after rejection: %+v, %v", got, err)
			}
			if db.Migrator().HasTable(&yingceSchemaMigration{}) {
				t.Fatal("failed transaction left an extension ledger")
			}
		})
	}
}
