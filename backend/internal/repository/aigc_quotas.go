package repository

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func (r *Repository) AigcQuotaSnapshots() ([]model.AigcQuotaSnapshot, error) {
	var rows []model.AigcQuotaSnapshot
	err := r.db.Order("channel_id ASC, quota_type ASC").Find(&rows).Error
	return rows, err
}

func (r *Repository) ReplaceAigcQuotaSnapshots(channelID string, rows []model.AigcQuotaSnapshot) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		for _, row := range rows {
			row.ChannelID = channelID
			if row.ID == "" {
				row.ID = uuid.NewString()
			}
			if row.UpdatedAt.IsZero() {
				row.UpdatedAt = time.Now()
			}
			if err := tx.Where("channel_id = ? AND quota_type = ?", channelID, row.QuotaType).Assign(row).FirstOrCreate(&row).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
