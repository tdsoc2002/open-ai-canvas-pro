package canvas

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

func (s *Service) SaveAssetToLibrary(userID, assetID, resourceID string) (json.RawMessage, error) {
	var saved *model.Asset
	err := s.host.WithStorageLock(func() error {
		asset, err := s.repo.AssetForUser(userID, assetID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return kernel.NotFound("素材不存在")
		}
		if err != nil {
			return err
		}
		var payload map[string]json.RawMessage
		if err := json.Unmarshal([]byte(asset.PayloadJSON), &payload); err != nil || payload == nil {
			return kernel.NewAppError(http.StatusConflict, "素材数据格式无效，无法保存")
		}
		if resourceID != "" {
			var data map[string]json.RawMessage
			var storageKey string
			if json.Unmarshal(payload["data"], &data) != nil || json.Unmarshal(data["storageKey"], &storageKey) != nil || storageKey != "resource:"+resourceID {
				return kernel.NewAppError(http.StatusConflict, "素材文件已变化，请刷新结果后重试")
			}
		}
		var metadata map[string]json.RawMessage
		if raw, exists := payload["metadata"]; exists {
			if err := json.Unmarshal(raw, &metadata); err != nil {
				return kernel.NewAppError(http.StatusConflict, "素材元数据格式无效，无法保存")
			}
		}
		if asset.Status != model.AssetVersionStatusArchived && bytes.Equal(bytes.TrimSpace(metadata["librarySaved"]), []byte("true")) {
			saved = asset
			return nil
		}
		if metadata == nil {
			metadata = make(map[string]json.RawMessage)
		}
		metadata["librarySaved"] = json.RawMessage("true")
		payload["metadata"], err = json.Marshal(metadata)
		if err != nil {
			return err
		}
		status := asset.Status
		if status == model.AssetVersionStatusArchived {
			status = model.AssetVersionStatusConfirmed
			payload["status"] = json.RawMessage(`"confirmed"`)
		}
		raw, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		if err := s.host.StructuredQuota(userID, "asset", false, int64(len(raw)-len(asset.PayloadJSON))); err != nil {
			return err
		}
		saved, err = s.repo.CompareAndSetAssetLibraryState(*asset, string(raw), status)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return kernel.NewAppError(http.StatusConflict, "素材已更新，请刷新后重试")
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	return ClientAssetPayload(*saved), nil
}
