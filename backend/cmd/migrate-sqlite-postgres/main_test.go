package main

import (
	"strings"
	"testing"

	"yingce/backend/internal/database"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

func TestMigrationListCoversSchemaModels(t *testing.T) {
	db, err := database.Open(database.Config{Driver: "sqlite", DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	conn, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := verifyMigrationCoverage(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE TABLE unexpected_business_table (id INTEGER PRIMARY KEY)").Error; err != nil {
		t.Fatal(err)
	}
	if err := verifyMigrationCoverage(db); err == nil || !strings.Contains(err.Error(), "unexpected_business_table") {
		t.Fatalf("应拒绝未登记的源库业务表，得到 %v", err)
	}
}

func TestCanvasHistoryCompositeKeyMigration(t *testing.T) {
	source, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:history-migration-source?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	target, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:history-migration-target?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	for _, db := range []*gorm.DB{source, target} {
		if err := db.AutoMigrate(&model.Resource{}, &model.CanvasSnapshotResource{}); err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.Resource{ID: "resource"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	refs := []model.CanvasSnapshotResource{{SnapshotID: "b", ResourceID: "resource"}, {SnapshotID: "a", ResourceID: "resource"}}
	if err := source.Create(&refs).Error; err != nil {
		t.Fatal(err)
	}
	count, err := migrateTable[model.CanvasSnapshotResource]("canvas_snapshot_resources").run(source, target, true)
	if err != nil || count != 2 {
		t.Fatalf("history refs not copied/verified: %d %v", count, err)
	}
}

func TestMigrationDependencyOrder(t *testing.T) {
	positions := make(map[string]int)
	for i, migration := range migrations() {
		positions[migration.name] = i
	}
	for _, dependency := range [][2]string{
		{"channel_websites", "model_channels"},
		{"model_channels", "channel_catalog_snapshots"},
		{"channel_websites", "channel_protocol_selections"},
		{"channel_models", "channel_protocol_selections"},
		{"users", "channel_protocol_selections"},
		{"users", "mcp_connection_grants"},
		{"mcp_connections", "mcp_connection_grants"},
		{"users", "mcp_storage_usages"},
		{"users", "agent_storage_usages"},
	} {
		parent, parentFound := positions[dependency[0]]
		child, childFound := positions[dependency[1]]
		if !parentFound || !childFound || parent >= child {
			t.Errorf("migration must copy %s before %s", dependency[0], dependency[1])
		}
	}
}
