package repository

import (
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func (r *Repository) CanvasFolders(userID string) ([]model.CanvasFolder, error) {
	folders := []model.CanvasFolder{}
	err := r.db.Where("user_id = ?", userID).Order("name asc, id asc").Find(&folders).Error
	return folders, err
}

func (r *Repository) CreateCanvasFolder(folder *model.CanvasFolder) error {
	return r.db.Create(folder).Error
}

func (r *Repository) RenameCanvasFolder(userID, folderID, name string) error {
	result := r.db.Model(&model.CanvasFolder{}).Where("user_id = ? AND id = ?", userID, folderID).Update("name", name)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *Repository) DeleteCanvasFolder(userID, folderID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Delete(&model.CanvasFolder{}, "user_id = ? AND id = ?", userID, folderID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return tx.Model(&model.CanvasProject{}).Where("user_id = ? AND folder_id = ?", userID, folderID).UpdateColumn("folder_id", "").Error
	})
}

func (r *Repository) MoveCanvasProjectsToFolder(userID, folderID string, canvasIDs []string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if folderID != "" {
			// 与删除目录争用同一行。SQLite 也在读取任何快照前取得写锁。
			folder := tx.Model(&model.CanvasFolder{}).Where("user_id = ? AND id = ?", userID, folderID).UpdateColumn("name", gorm.Expr("name"))
			if folder.Error != nil {
				return folder.Error
			}
			if folder.RowsAffected != 1 {
				return gorm.ErrRecordNotFound
			}
		}
		result := tx.Model(&model.CanvasProject{}).Where("user_id = ? AND id IN ?", userID, canvasIDs).UpdateColumn("folder_id", folderID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != int64(len(canvasIDs)) {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
}
