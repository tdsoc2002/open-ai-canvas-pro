package model

import "time"

// AigcQuotaSnapshot stores the last successful or failed quota check for a VOD channel.
type AigcQuotaSnapshot struct {
	ID           string    `json:"id" gorm:"primaryKey;size:36"`
	ChannelID    string    `json:"channelId" gorm:"uniqueIndex:idx_aigc_quota_channel_type,priority:1;size:36"`
	QuotaType    string    `json:"quotaType" gorm:"uniqueIndex:idx_aigc_quota_channel_type,priority:2;size:16"`
	QuotaLimit   int64     `json:"quotaLimit"`
	Usage        int64     `json:"usage"`
	Remaining    int64     `json:"remaining"`
	Unit         string    `json:"unit" gorm:"size:16"`
	QuotaPeriod  string    `json:"quotaPeriod" gorm:"size:16"`
	Status       string    `json:"status" gorm:"size:24;index"`
	ErrorCode    string    `json:"errorCode,omitempty" gorm:"size:120"`
	ErrorMessage string    `json:"errorMessage,omitempty" gorm:"size:500"`
	UpdatedAt    time.Time `json:"updatedAt"`
}
