package app

import (
	"context"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common"
	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common/profile"
	vod "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/vod/v20180717"
	"yingce/backend/internal/model"
)

const tencentVODQuotaBaseURL = "https://vod.tencentcloudapi.com"
const tencentVODQuotaEndpoint = "vod.tencentcloudapi.com"

type AigcQuota struct {
	QuotaType    string `json:"quotaType"`
	QuotaLimit   int64  `json:"quotaLimit"`
	Usage        int64  `json:"usage"`
	Remaining    int64  `json:"remaining"`
	Unit         string `json:"unit"`
	QuotaPeriod  string `json:"quotaPeriod"`
	Status       string `json:"status"`
	ErrorCode    string `json:"errorCode,omitempty"`
	ErrorMessage string `json:"errorMessage,omitempty"`
	UpdatedAt    string `json:"updatedAt,omitempty"`
}

type AdminChannelAigcQuota struct {
	ChannelID    string      `json:"channelId"`
	ChannelName  string      `json:"channelName"`
	AppID        int64       `json:"appId"`
	Status       string      `json:"status"`
	Quotas       []AigcQuota `json:"quotas"`
	UpdatedAt    string      `json:"updatedAt,omitempty"`
	ErrorCode    string      `json:"errorCode,omitempty"`
	ErrorMessage string      `json:"errorMessage,omitempty"`
}

func (s *Service) AdminAigcQuotas(actor *model.User) ([]AdminChannelAigcQuota, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channels, err := s.repo.SystemChannels(true)
	if err != nil {
		return nil, err
	}
	snapshots, err := s.repo.AigcQuotaSnapshots()
	if err != nil {
		return nil, err
	}
	byChannel := make(map[string][]model.AigcQuotaSnapshot)
	for _, row := range snapshots {
		byChannel[row.ChannelID] = append(byChannel[row.ChannelID], row)
	}
	result := make([]AdminChannelAigcQuota, 0)
	for _, channel := range channels {
		if !isTencentVODQuotaChannel(channel) {
			continue
		}
		item := AdminChannelAigcQuota{ChannelID: channel.ID, ChannelName: channel.Name, AppID: channelTencentVODAppID(channel), Status: "not_configured", Quotas: make([]AigcQuota, 0)}
		for _, row := range byChannel[channel.ID] {
			item.Quotas = append(item.Quotas, quotaFromSnapshot(row))
			if item.UpdatedAt == "" && !row.UpdatedAt.IsZero() {
				item.UpdatedAt = row.UpdatedAt.Format(time.RFC3339)
			}
			if row.Status == "error" {
				item.Status, item.ErrorCode, item.ErrorMessage = "error", row.ErrorCode, row.ErrorMessage
			} else if row.Status == "ok" && item.Status != "error" {
				item.Status = "ok"
			}
		}
		result = append(result, item)
	}
	return result, nil
}

func (s *Service) RefreshAdminAigcQuotas(ctx context.Context, actor *model.User) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	return s.refreshAigcQuotas(ctx)
}

func (s *Service) refreshAigcQuotas(ctx context.Context) error {
	channels, err := s.repo.SystemChannels(true)
	if err != nil {
		return err
	}
	for _, channel := range channels {
		if !isTencentVODQuotaChannel(channel) {
			continue
		}
		if err := s.decryptSystemChannelSecrets(&channel); err != nil {
			slog.Warn("AIGC quota channel secret decrypt failed", "channel_id", channel.ID, "error", err)
			continue
		}
		rows, err := queryTencentVODQuotas(ctx, channel)
		if err != nil {
			slog.Warn("AIGC quota channel query failed", "channel_id", channel.ID, "error", err)
			continue
		}
		if err := s.repo.ReplaceAigcQuotaSnapshots(channel.ID, rows); err != nil {
			slog.Warn("AIGC quota snapshot save failed", "channel_id", channel.ID, "error", err)
		}
	}
	return nil
}

func (s *Service) startAigcQuotaWorker() {
	s.runWorkerLoop(func(ctx context.Context) {
		for {
			now := time.Now().In(aigcQuotaLocation())
			next := time.Date(now.Year(), now.Month(), now.Day(), 3, 0, 0, 0, now.Location())
			if !next.After(now) {
				next = next.Add(24 * time.Hour)
			}
			timer := time.NewTimer(time.Until(next))
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
				lease, acquired, leaseErr := s.coordinator.AcquireLease(ctx, "aigc-quota-refresh", 1, 30*time.Minute)
				if leaseErr == nil && acquired {
					if err := s.refreshAigcQuotas(ctx); err != nil {
						slog.Warn("AIGC quota refresh failed", "error", err)
					}
					lease.Release()
				}
			}
		}
	})
}

func aigcQuotaLocation() *time.Location {
	if name := strings.TrimSpace(os.Getenv("CANVAS_TIMEZONE")); name != "" {
		if loc, err := time.LoadLocation(name); err == nil {
			return loc
		}
	}
	return time.FixedZone("Asia/Shanghai", 8*60*60)
}

func isTencentVODQuotaChannel(channel model.ModelChannel) bool {
	return strings.TrimRight(strings.TrimSpace(channel.BaseURL), "/") == tencentVODQuotaBaseURL && channelTencentVODAppID(channel) > 0
}

func channelTencentVODAppID(channel model.ModelChannel) int64 {
	headers, err := ParseOutboundHeadersJSON(channel.HeadersJSON)
	if err != nil {
		return 0
	}
	for _, header := range headers {
		if strings.EqualFold(strings.TrimSpace(header.Name), tencentVODAppIDHeader) {
			value, err := strconv.ParseInt(strings.TrimSpace(header.Value), 10, 64)
			if err == nil {
				return value
			}
		}
	}
	return 0
}

func queryTencentVODQuotas(ctx context.Context, channel model.ModelChannel) ([]model.AigcQuotaSnapshot, error) {
	cred := common.NewCredential(channel.APIKey, channel.SecretKey)
	profile := profile.NewClientProfile()
	profile.HttpProfile.Endpoint = tencentVODQuotaEndpoint
	client, err := vod.NewClient(cred, "ap-guangzhou", profile)
	if err != nil {
		return nil, err
	}
	rows := make([]model.AigcQuotaSnapshot, 0, 3)
	for _, quotaType := range []string{"Image", "Video", "Text"} {
		req := vod.NewDescribeAigcQuotasRequest()
		req.SubAppId = common.Uint64Ptr(uint64(channelTencentVODAppID(channel)))
		req.QuotaType = common.StringPtr(quotaType)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}
		resp, err := client.DescribeAigcQuotas(req)
		if err != nil {
			return nil, err
		}
		if len(resp.Response.QuotaSet) == 0 {
			continue
		}
		for _, item := range resp.Response.QuotaSet {
			limit, usage := int64(*item.QuotaLimit), int64(*item.Usage)
			unit := "token"
			if quotaType == "Image" {
				unit = "张"
			} else if quotaType == "Video" {
				unit = "秒"
			}
			rows = append(rows, model.AigcQuotaSnapshot{QuotaType: quotaType, QuotaLimit: limit, Usage: usage, Remaining: maxInt64(limit-usage, 0), Unit: unit, QuotaPeriod: valueOrEmpty(item.QuotaPeriod), Status: "ok", UpdatedAt: time.Now()})
		}
	}
	return rows, nil
}

func quotaFromSnapshot(row model.AigcQuotaSnapshot) AigcQuota {
	return AigcQuota{QuotaType: row.QuotaType, QuotaLimit: row.QuotaLimit, Usage: row.Usage, Remaining: row.Remaining, Unit: row.Unit, QuotaPeriod: row.QuotaPeriod, Status: row.Status, ErrorCode: row.ErrorCode, ErrorMessage: row.ErrorMessage, UpdatedAt: row.UpdatedAt.Format(time.RFC3339)}
}
func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
