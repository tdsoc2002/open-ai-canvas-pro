package main

import (
	"fmt"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func migrateIDSequences(source, target *gorm.DB, copyRows bool) (int, error) {
	var sourceRows []model.IDSequence
	if err := source.Find(&sourceRows).Error; err != nil {
		return 0, err
	}
	if err := validateExplicitStringLengths(source, "id_sequences", sourceRows); err != nil {
		return 0, err
	}
	if copyRows && len(sourceRows) > 0 {
		// 目标结构初始化已写入同名序列，合并时保留较大的已分配值。
		merge := clause.OnConflict{
			Columns:   []clause.Column{{Name: "name"}},
			DoUpdates: clause.AssignmentColumns([]string{"value", "updated_at"}),
			Where: clause.Where{Exprs: []clause.Expression{clause.Lte{
				Column: clause.Column{Table: "id_sequences", Name: "value"},
				Value:  clause.Column{Table: "excluded", Name: "value"},
			}}},
		}
		if err := target.Clauses(merge).CreateInBatches(&sourceRows, 100).Error; err != nil {
			return 0, err
		}
	}

	var targetRows []model.IDSequence
	if err := target.Find(&targetRows).Error; err != nil {
		return 0, err
	}
	targetValues := make(map[string]int64, len(targetRows))
	for _, row := range targetRows {
		targetValues[row.Name] = row.Value
	}
	for _, row := range sourceRows {
		if value, exists := targetValues[row.Name]; !exists || value < row.Value {
			return 0, fmt.Errorf("目标序列 %s 缺失或小于源库值 %d", row.Name, row.Value)
		}
	}
	return len(sourceRows), nil
}
