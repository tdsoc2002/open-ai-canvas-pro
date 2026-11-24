package main

import (
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/database"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

func TestIDSequenceMigrationMergesInitializedCounters(t *testing.T) {
	open := func() *gorm.DB {
		db, err := database.Open(database.Config{
			Driver: "sqlite",
			DSN:    t.TempDir() + "/sequences.db",
		})
		if err != nil {
			t.Fatal(err)
		}
		conn, err := db.DB()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = conn.Close() })
		if err := db.AutoMigrate(&model.IDSequence{}); err != nil {
			t.Fatal(err)
		}
		return db
	}
	source, target := open(), open()
	sourceTime := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	targetTime := sourceTime.Add(time.Hour)
	sourceRows := []model.IDSequence{
		{Name: "id:CHANNEL", Value: 80, UpdatedAt: sourceTime},
		{Name: "id:MODEL", Value: 12, UpdatedAt: sourceTime},
		{Name: "id:CUSTOM", Value: 17, UpdatedAt: sourceTime},
	}
	targetRows := []model.IDSequence{
		{Name: "id:CHANNEL", Value: 0, UpdatedAt: targetTime},
		{Name: "id:MODEL", Value: 20, UpdatedAt: targetTime},
		{Name: "id:ATTEMPT", Value: 0, UpdatedAt: targetTime},
	}
	if err := source.Create(&sourceRows).Error; err != nil {
		t.Fatal(err)
	}
	if err := target.Create(&targetRows).Error; err != nil {
		t.Fatal(err)
	}

	for _, copyRows := range []bool{true, false} {
		count, err := migrateIDSequences(source, target, copyRows)
		if err != nil || count != len(sourceRows) {
			t.Fatalf("复制模式 %t，得到 %d 行：%v", copyRows, count, err)
		}
	}
	for _, want := range []model.IDSequence{sourceRows[0], targetRows[1], sourceRows[2], targetRows[2]} {
		var got model.IDSequence
		err := target.First(&got, "name = ?", want.Name).Error
		if err != nil || got.Value != want.Value || !got.UpdatedAt.Equal(want.UpdatedAt) {
			t.Fatalf("目标序列 = %+v，预期 %+v：%v", got, want, err)
		}
	}

	if err := target.Model(&model.IDSequence{}).Where("name = ?", sourceRows[0].Name).Update("value", 79).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := migrateIDSequences(source, target, false); err == nil || !strings.Contains(err.Error(), sourceRows[0].Name) {
		t.Fatalf("应拒绝水位低于源库的序列，得到 %v", err)
	}
}

func TestValidateTargetTableNamesAllowsBothMigrationLedgers(t *testing.T) {
	names := []string{"schema_migrations", "yingce_schema_migrations"}
	for _, migration := range migrations() {
		names = append(names, migration.name)
	}
	if err := validateMigrationTableNames("PostgreSQL public schema", names); err != nil {
		t.Fatal(err)
	}
	if err := validateMigrationTableNames("PostgreSQL public schema", append(names, "unrelated_table")); err == nil {
		t.Fatal("应拒绝存在额外业务表的目标库")
	}
}
