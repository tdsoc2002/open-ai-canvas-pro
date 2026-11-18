package repository

import (
	"gorm.io/gorm"

	"yingce/backend/internal/model"
)

func (r *Repository) TaskOutputAssetForUser(userID, taskID, resourceID string) (*model.Asset, error) {
	versions := r.db.Table("asset_versions AS versions").Select("versions.asset_id").
		Joins("JOIN asset_representations AS representations ON representations.asset_version_id = versions.id").
		Where("representations.task_id = ? AND representations.resource_id = ?", taskID, resourceID)
	// 版本表现能证明任务关联，但不能用同一素材后来换上的文件替代历史结果。
	matchPayload := `CASE WHEN json_valid(payload_json) THEN
		json_extract(payload_json, '$.data.storageKey') = ?
		AND (id IN (?) OR json_extract(payload_json, '$.metadata.taskId') = ?)
		ELSE FALSE END`
	if r.db.Dialector.Name() == "postgres" {
		matchPayload = `CASE WHEN pg_input_is_valid(payload_json, 'jsonb') THEN
			payload_json::jsonb #>> '{data,storageKey}' = ?
			AND (id IN (?) OR payload_json::jsonb #>> '{metadata,taskId}' = ?)
			ELSE FALSE END`
	}
	var matches []struct {
		model.Asset
		HasRepresentation bool
	}
	err := r.db.Model(&model.Asset{}).
		Select("assets.*, id IN (?) AS has_representation", versions).
		Where("user_id = ?", userID).
		Where(matchPayload, "resource:"+resourceID, versions, taskID).
		Order("has_representation DESC").Limit(2).Find(&matches).Error
	if err != nil {
		return nil, err
	}
	// 版本表现优先；同一优先级无法唯一定位时不猜原素材。
	if len(matches) == 0 || len(matches) > 1 && matches[0].HasRepresentation == matches[1].HasRepresentation {
		return nil, gorm.ErrRecordNotFound
	}
	return &matches[0].Asset, nil
}
