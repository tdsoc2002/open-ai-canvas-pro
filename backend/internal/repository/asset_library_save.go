package repository

import (
	"bytes"
	"encoding/json"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

// 保留当前行的明确入库意图；应用层读到的旧素材可能早于手动入库提交。
func assetPayloadKeepingLibrarySave(db *gorm.DB, payloadJSON string) any {
	var payload map[string]json.RawMessage
	if err := json.Unmarshal([]byte(payloadJSON), &payload); err != nil || payload == nil {
		return payloadJSON
	}
	var metadata map[string]json.RawMessage
	if raw, exists := payload["metadata"]; exists {
		if err := json.Unmarshal(raw, &metadata); err != nil {
			metadata = nil
		}
	}
	if bytes.Equal(bytes.TrimSpace(metadata["librarySaved"]), []byte("true")) {
		return payloadJSON
	}
	if metadata == nil {
		metadata = make(map[string]json.RawMessage)
	}
	metadata["librarySaved"] = json.RawMessage("true")
	normalizedMetadata, err := json.Marshal(metadata)
	if err != nil {
		return payloadJSON
	}
	payload["metadata"] = normalizedMetadata
	normalizedPayload, err := json.Marshal(payload)
	if err != nil {
		return payloadJSON
	}
	currentlySaved := `CASE WHEN json_valid(payload_json) THEN json_type(payload_json, '$.metadata.librarySaved') = 'true' ELSE FALSE END`
	if db.Dialector.Name() == "postgres" {
		currentlySaved = `CASE WHEN pg_input_is_valid(payload_json, 'jsonb') THEN payload_json::jsonb #> '{metadata,librarySaved}' = 'true'::jsonb ELSE FALSE END`
	}
	return gorm.Expr("CASE WHEN ("+currentlySaved+") THEN ? ELSE ? END", string(normalizedPayload), payloadJSON)
}

func (r *Repository) CompareAndSetAssetLibraryState(before model.Asset, payloadJSON string, status model.AssetVersionStatus) (*model.Asset, error) {
	updates := map[string]any{"payload_json": payloadJSON}
	if status != before.Status {
		updates["status"] = status
	}
	// 项目写入不一定经过进程内存储锁；只在原 payload 和状态仍未改变时提交。
	var updated model.Asset
	result := r.db.Model(&updated).Clauses(clause.Returning{}).
		Where("id = ? AND user_id = ? AND payload_json = ? AND COALESCE(status, '') = ?", before.ID, before.UserID, before.PayloadJSON, before.Status).
		UpdateColumns(updates)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	return &updated, nil
}
