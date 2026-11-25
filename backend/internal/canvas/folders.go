package canvas

import (
	"errors"
	"strings"
	"unicode/utf8"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

func (s *Service) CanvasFolders(ownerKey string) ([]model.CanvasFolder, error) {
	return s.repo.CanvasFolders(ownerKey)
}

func (s *Service) CreateCanvasFolder(ownerKey, name string) (model.CanvasFolder, error) {
	name, err := canvasFolderName(name)
	if err != nil {
		return model.CanvasFolder{}, err
	}
	folder := model.CanvasFolder{ID: kernel.NewID(), UserID: ownerKey, Name: name}
	err = s.repo.CreateCanvasFolder(&folder)
	return folder, err
}

func (s *Service) RenameCanvasFolder(ownerKey, folderID, name string) error {
	name, err := canvasFolderName(name)
	if err != nil {
		return err
	}
	return canvasFolderWriteError(s.repo.RenameCanvasFolder(ownerKey, folderID, name), "文件夹不存在")
}

func (s *Service) DeleteCanvasFolder(ownerKey, folderID string) error {
	return canvasFolderWriteError(s.repo.DeleteCanvasFolder(ownerKey, folderID), "文件夹不存在")
}

func (s *Service) MoveCanvasProjectsToFolder(ownerKey, folderID string, canvasIDs []string) error {
	if len(canvasIDs) == 0 || len(canvasIDs) > 200 {
		return kernel.BadAuthRequest("请选择 1 至 200 个画布")
	}
	if len(folderID) > 36 {
		return kernel.BadAuthRequest("文件夹 ID 无效")
	}
	ids := make([]string, 0, len(canvasIDs))
	seen := make(map[string]bool, len(canvasIDs))
	for _, id := range canvasIDs {
		if strings.TrimSpace(id) == "" || len(id) > 80 {
			return kernel.BadAuthRequest("画布 ID 无效")
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	return canvasFolderWriteError(s.repo.MoveCanvasProjectsToFolder(ownerKey, folderID, ids), "部分画布或目标文件夹不存在")
}

func canvasFolderName(value string) (string, error) {
	name := strings.TrimSpace(value)
	if name == "" || utf8.RuneCountInString(name) > 40 {
		return "", kernel.BadAuthRequest("请输入 1 至 40 个字符的文件夹名称")
	}
	return name, nil
}

func canvasFolderWriteError(err error, message string) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return kernel.NotFound(message)
	}
	return err
}
