// 用户分组与分组渠道绑定的持久化。分组本身和渠道绑定必须在同一事务内写入，
// 避免出现“分组已限制渠道但绑定尚未落库”的窗口把用户的模型目录清空。
package repository

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

// ErrUserGroupInUse 表示分组仍有用户，不能删除。
var ErrUserGroupInUse = errors.New("user group in use")
var ErrUserGroupChanged = errors.New("user group changed")

func (r *Repository) UserGroups() ([]model.UserGroup, error) {
	var groups []model.UserGroup
	err := r.db.Order("sort_order asc").Order("created_at asc").Order("id asc").Find(&groups).Error
	return groups, err
}

func (r *Repository) UserGroup(id string) (*model.UserGroup, error) {
	var group model.UserGroup
	if err := r.db.First(&group, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &group, nil
}

func (r *Repository) UserGroupByCode(code string) (*model.UserGroup, error) {
	var group model.UserGroup
	if err := r.db.First(&group, "code = ?", code).Error; err != nil {
		return nil, err
	}
	return &group, nil
}

func (r *Repository) UserGroupChannels() ([]model.UserGroupChannel, error) {
	var rows []model.UserGroupChannel
	err := r.db.Order("group_id asc").Order("channel_id asc").Find(&rows).Error
	return rows, err
}

// SaveUserGroupWithChannels 同时保存分组、渠道绑定和管理审计。
func (r *Repository) SaveUserGroupWithChannels(group *model.UserGroup, channelIDs []string, create bool, audit *model.AdminAuditEvent) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		previousUpdate := group.UpdatedAt
		group.UpdatedAt = now
		if create {
			group.CreatedAt = now
			if err := tx.Create(group).Error; err != nil {
				return err
			}
		} else {
			result := tx.Model(group).Where("updated_at = ?", previousUpdate).Select("*").Updates(group)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrUserGroupChanged
			}
		}
		if err := tx.Where("group_id = ?", group.ID).Delete(&model.UserGroupChannel{}).Error; err != nil {
			return err
		}
		if len(channelIDs) != 0 {
			rows := make([]model.UserGroupChannel, 0, len(channelIDs))
			for _, channelID := range channelIDs {
				rows = append(rows, model.UserGroupChannel{GroupID: group.ID, ChannelID: channelID, CreatedAt: now})
			}
			if err := tx.Create(&rows).Error; err != nil {
				return err
			}
		}
		if audit != nil {
			return tx.Create(audit).Error
		}
		return nil
	})
}

// DeleteUserGroup 在同一事务内确认分组没有用户后删除分组和绑定；默认分组由 service 层禁止删除。
func (r *Repository) DeleteUserGroup(group *model.UserGroup, audit *model.AdminAuditEvent) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&model.User{}).Where("user_group = ?", group.Code).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return ErrUserGroupInUse
		}
		if err := tx.Where("group_id = ?", group.ID).Delete(&model.UserGroupChannel{}).Error; err != nil {
			return err
		}
		deleted := tx.Delete(&model.UserGroup{}, "id = ? AND updated_at = ?", group.ID, group.UpdatedAt)
		if deleted.Error != nil {
			return deleted.Error
		}
		if deleted.RowsAffected != 1 {
			return ErrUserGroupChanged
		}
		return tx.Create(audit).Error
	})
}

// UserGroupUserCounts 返回每个分组编码的用户数；空编码原样返回，由调用方归入默认分组。
func (r *Repository) UserGroupUserCounts() (map[string]int64, error) {
	var rows []struct {
		UserGroup string
		Count     int64
	}
	if err := r.db.Model(&model.User{}).Select("user_group, count(*) as count").Group("user_group").Scan(&rows).Error; err != nil {
		return nil, err
	}
	result := make(map[string]int64, len(rows))
	for _, row := range rows {
		result[row.UserGroup] += row.Count
	}
	return result, nil
}
