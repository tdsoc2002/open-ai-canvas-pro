package app

import (
	"encoding/json"
	"errors"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

// TaskOutputAsset 返回已保存结果对应的原素材，历史手动入库不需要重新登记资源或推算序号。
func (s *Service) TaskOutputAsset(userID, taskID, resourceID string) (json.RawMessage, error) {
	resourceID = strings.TrimSpace(resourceID)
	if resourceID == "" {
		return nil, BadAuthRequest("请选择已保存的生成资源")
	}
	task, err := s.repo.TaskForUser(userID, taskID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("任务不存在")
	}
	if err != nil {
		return nil, err
	}
	if task.Status != model.TaskStatusSucceeded {
		return nil, BadAuthRequest("生成任务尚未成功")
	}
	resource, err := s.repo.ResourceForUser(userID, resourceID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("生成资源不存在")
	}
	if err != nil {
		return nil, err
	}
	if resource.Status != model.ResourceStatusReady {
		return nil, BadAuthRequest("生成资源尚未保存完成")
	}
	var result any
	if json.Unmarshal([]byte(task.ResultJSON), &result) != nil || !taskOutputContainsResource(result, resource.ID) {
		return nil, NotFound("所选资源不属于该任务的生成结果")
	}
	asset, err := s.repo.TaskOutputAssetForUser(userID, task.ID, resource.ID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("未找到与所选生成资源一致的素材，无法保存")
	}
	if err != nil {
		return nil, err
	}
	return clientAssetPayload(*asset), nil
}

func taskOutputContainsResource(value any, resourceID string) bool {
	switch item := value.(type) {
	case string:
		path, _, _ := strings.Cut(strings.TrimSpace(item), "?")
		path, _, _ = strings.Cut(path, "#")
		return strings.TrimSpace(item) == "resource:"+resourceID || path == resourceFileURL(resourceID)
	case []any:
		for _, entry := range item {
			if taskOutputContainsResource(entry, resourceID) {
				return true
			}
		}
	case map[string]any:
		if id, ok := item["resourceId"].(string); ok && id == resourceID {
			return true
		}
		// 只沿输出字段查找，不把输入、参考图或元数据中的资源当成生成结果。
		for _, key := range []string{"storageKey", "url", "dataUrl", "imageUrl", "videoUrl", "audioUrl", "resultUrl", "outputUrl",
			"image", "images", "video", "videos", "audio", "audios", "artifact", "artifacts", "artifactRef", "result", "results", "output", "outputs", "media"} {
			if taskOutputContainsResource(item[key], resourceID) {
				return true
			}
		}
	}
	return false
}
