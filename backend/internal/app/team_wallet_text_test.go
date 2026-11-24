package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
)

func newTeamGenerationTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	allowLoopbackProviderTest(t)
	svc, db, _, _ := creationTestService(t)
	t.Setenv("REDIS_URL", "")
	coordinator, err := platform.NewCoordinator("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	svc.coordinator = coordinator
	svc.activeCancels = make(map[string]context.CancelFunc)
	svc.platform = platform.New(svc.repo, coordinator, platformHost{svc: svc})
	if err := svc.EnsureDefaultUserGroup(); err != nil {
		t.Fatal(err)
	}
	for _, item := range []any{
		&model.User{ID: "worker", Username: "worker", Role: model.UserRoleUser, Status: model.UserStatusActive, UserGroup: "worker"},
		&model.UserGroup{ID: "worker-group", Code: "worker", Name: "成员分组", RatioBasisPoints: 5000, AllChannels: true, PointsPerUSD: 7 * CreditScale, PointsPerCNY: CreditScale, ModelOverridesJSON: "[]"},
		&model.CreditAccount{UserID: "worker", AvailableMicrocredits: 1234},
		&model.Team{ID: "team", Name: "文本团队", OwnerUserID: "user", Status: model.TeamActive},
		&model.TeamMembership{ID: "owner-member", TeamID: "team", UserID: "user", Role: model.TeamOwner, Status: model.TeamActive},
		&model.TeamMembership{ID: "worker-member", TeamID: "team", UserID: "worker", Role: model.TeamMember, Status: model.TeamActive},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc.invalidateUserGroups()
	if _, err := svc.UpdateFeatureAvailability(&model.User{ID: "admin", Role: model.UserRoleAdmin}, FeatureAvailability{TeamsEnabled: true, CreditsEnabled: true, TaskCenterEnabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.OpenTeamWallets("team", "owner-member", true); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.OpenTeamWallets("team", "worker-member", false); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.repo.TransferTeamCredits("user", "team", "", "fund", 2_000_000, "fund"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.repo.TransferTeamCredits("user", "team", "worker-member", "allocate", 2_000_000, "allocate"); err != nil {
		t.Fatal(err)
	}
	return svc, db
}

func TestTeamWorkspaceTaskQuoteExecutionAndReplay(t *testing.T) {
	svc, db := newTeamGenerationTestService(t)
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"镜头一。"}}],"usage":{"prompt_tokens":4,"completion_tokens":3}}`))
	}))
	defer upstream.Close()
	key, err := svc.encryptSettingSecret(newID())
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": upstream.URL, "api_key": key}).Error; err != nil {
		t.Fatal(err)
	}
	req := creationTextRequest()
	req.Operation = "text"
	req.Input["textOptions"] = map[string]any{"stream": false}
	req.IdempotencyKey = "message-one"
	quote, err := svc.TeamWorkspaceTask("worker", "team", req, true)
	if err != nil {
		t.Fatal(err)
	}
	cap := quote.(map[string]int64)["maxChargeMicrocredits"]
	// 公用夹具的模型单价为 100_000 微积分，成员按 50% 报价。
	if cap != 50_000 {
		t.Fatalf("actor price = %d, want 50000", cap)
	}
	if _, err := svc.TeamWorkspaceTask("worker", "team", req, false); err == nil {
		t.Fatal("missing confirmation accepted")
	}
	lower := cap - 1
	req.MaxChargeMicrocredits = &lower
	if _, err := svc.TeamWorkspaceTask("worker", "team", req, false); err == nil {
		t.Fatal("insufficient cap accepted")
	}
	req.MaxChargeMicrocredits = &cap
	result, err := svc.TeamWorkspaceTask("worker", "team", req, false)
	if err != nil {
		t.Fatal(err)
	}
	task := result.(*model.Task)
	claimed, err := svc.repo.ClaimNextTask("worker-1", time.Minute)
	if err != nil || claimed == nil || claimed.ID != task.ID {
		t.Fatal("team task not queued", err)
	}
	if err := svc.taskWorker().processClaimedTask(claimed, nil); err != nil {
		t.Fatal(err)
	}
	saved, err := svc.repo.TaskForUser(model.TeamContentKey("team"), task.ID)
	if err != nil {
		t.Fatal(err)
	}
	var bound struct {
		AssetID string `json:"assetId"`
	}
	if err := json.Unmarshal([]byte(saved.ResultJSON), &bound); err != nil || bound.AssetID != generationMediaAssetID(task.ID, 0) {
		t.Fatal("missing task result binding", err)
	}
	output, err := svc.repo.AssetForUser(model.TeamContentKey("team"), bound.AssetID)
	if err != nil || !strings.Contains(output.PayloadJSON, "镜头一。") {
		t.Fatal("missing workspace output", err)
	}
	order, err := svc.repo.BillingOrder(task.BillingOrderID)
	if err != nil || order.Status != model.BillingStatusSettled || order.UserID != "worker" || order.BillingAccountID != model.TeamMemberCreditAccountID("worker-member") {
		t.Fatalf("order: %+v, %v", order, err)
	}
	if !order.RoundChargeToCent || order.ActualAmountMicrocredits != cap {
		t.Fatalf("settled charge = %d, round to cent = %t, want %d and true", order.ActualAmountMicrocredits, order.RoundChargeToCent, cap)
	}
	personal, err := svc.repo.CreditAccount("worker")
	if err != nil || personal.AvailableMicrocredits != 1234 || personal.ReservedMicrocredits != 0 {
		t.Fatal("personal balance changed", err)
	}
	account, err := svc.repo.CreditAccountByID(order.BillingAccountID)
	if err != nil || account.AvailableMicrocredits != 1_950_000 || account.ReservedMicrocredits != 0 {
		t.Fatal("wrong team balance", err)
	}
	replayed, err := svc.TeamWorkspaceTask("worker", "team", req, false)
	if err != nil || replayed.(*model.Task).ID != task.ID || calls.Load() != 1 {
		t.Fatal("duplicate submission", err)
	}
	req.Prompt = "different"
	if _, err := svc.TeamWorkspaceTask("worker", "team", req, false); err == nil {
		t.Fatal("idempotent request changed")
	}
}

func TestTeamWorkspaceMediaUsesTeamAllowanceAndStorage(t *testing.T) {
	for _, example := range []struct {
		mode, operation, billingMode string
		protocol                     model.ChannelInterfaceType
		charge                       int64
	}{
		{"image", "image", "fixed_request", model.ChannelInterfaceOpenAIImage, 50_000},
		{"video", "text_to_video", "per_second", model.ChannelInterfaceVolcengineArkVideo, 250_000},
	} {
		t.Run(example.mode, func(t *testing.T) {
			svc, db := newTeamGenerationTestService(t)
			owner := model.TeamContentKey("team")
			picture := base64.StdEncoding.EncodeToString(mediaTestPNG(t))
			var calls atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Content-Type", "application/json")
				_, _ = fmt.Fprintf(w, `{"data":[{"b64_json":%q}]}`, picture)
			}))
			defer upstream.Close()
			key, err := svc.encryptSettingSecret(newID())
			if err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": upstream.URL, "api_key": key}).Error; err != nil {
				t.Fatal(err)
			}
			modelKey := example.mode + "-test"
			if example.mode == "image" {
				modelKey = "gpt-image-1"
			}
			profile := DefaultModelCapabilityConfigForModel(string(example.protocol), modelKey)
			for _, row := range []any{
				&model.ChannelModel{ID: "media-model", ChannelID: "channel", ModelKey: modelKey, Capability: example.mode, Protocol: example.protocol, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, profile), BillingMode: example.billingMode, PriceConfigured: true, Enabled: true},
				&model.ChannelModelPriceTier{ID: "media-tier", ChannelModelID: "media-model", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: example.billingMode, UnitPriceMicrocredits: 100_000, PriceConfigured: true, Enabled: true},
				&model.Resource{ID: "personal-ref", UserID: "worker", Kind: "image", Provider: "local", Status: model.ResourceStatusReady, MimeType: "image/png"},
				&model.Resource{ID: "team-ref", UserID: owner, Kind: "image", Provider: "local", Status: model.ResourceStatusReady, MimeType: "image/png", Width: 1024, Height: 1024, Size: 128},
			} {
				if err := db.Create(row).Error; err != nil {
					t.Fatal(err)
				}
			}
			config := map[string]any{"channelId": "channel", "model": modelKey, "size": "1024x1024", "count": "1"}
			if example.mode == "video" {
				config["size"], config["videoSeconds"], config["vquality"] = "16:9", "5", "720"
			}
			req := CreateTaskRequest{
				Type: "canvas_" + example.mode, Operation: example.operation, Prompt: "团队作品", IdempotencyKey: "media-test",
				Input: map[string]any{"mode": example.mode, "config": config, "metadata": map[string]any{"source": "create-page", "messageId": "message", "batchIndex": float64(1), "batchCount": float64(2)}},
			}
			if _, err := svc.TeamWorkspaceTask("outsider", "team", req, true); err == nil {
				t.Fatal("非成员可报价")
			}
			req.Input["referenceImages"] = []any{map[string]any{"storageKey": "resource:personal-ref"}}
			if _, err := svc.TeamWorkspaceTask("worker", "team", req, true); err == nil {
				t.Fatal("个人参考资源可用于团队任务")
			}
			req.Input["referenceImages"] = []any{map[string]any{"storageKey": "resource:team-ref"}}
			if example.mode == "video" {
				req.Operation = "image_to_video"
				if _, err := svc.TeamWorkspaceTask("worker", "team", req, true); err == nil || !strings.Contains(err.Error(), "支持团队私有素材") {
					t.Fatalf("仅支持公网参考的模型应在报价阶段拒绝团队引用：%v", err)
				}
				req.Operation = example.operation
			} else if _, err := svc.TeamWorkspaceTask("worker", "team", req, true); err != nil {
				t.Fatalf("团队图片引用报价失败：%v", err)
			}
			delete(req.Input, "referenceImages")
			quote, err := svc.TeamWorkspaceTask("worker", "team", req, true)
			if err != nil {
				t.Fatal(err)
			}
			charge := quote.(map[string]int64)["maxChargeMicrocredits"]
			if charge != example.charge {
				t.Fatalf("报价为 %d，预期为 %d", charge, example.charge)
			}
			accountID := model.TeamMemberCreditAccountID("worker-member")
			before, err := svc.repo.CreditAccountByID(accountID)
			if err != nil {
				t.Fatal(err)
			}
			lower := charge - 1
			req.MaxChargeMicrocredits = &lower
			if _, err := svc.TeamWorkspaceTask("worker", "team", req, false); err == nil {
				t.Fatal("超过确认上限仍可提交")
			}
			req.MaxChargeMicrocredits = &charge
			result, err := svc.TeamWorkspaceTask("worker", "team", req, false)
			if err != nil {
				t.Fatal(err)
			}
			task := result.(*model.Task)
			replayed, err := svc.TeamWorkspaceTask("worker", "team", req, false)
			if err != nil || replayed.(*model.Task).ID != task.ID {
				t.Fatalf("重复提交未复用任务：%v", err)
			}
			reserved, err := svc.repo.CreditAccountByID(accountID)
			if err != nil || reserved.ReservedMicrocredits != charge || reserved.AvailableMicrocredits != before.AvailableMicrocredits-charge {
				t.Fatalf("团队冻结额不符：%+v，%v", reserved, err)
			}
			if _, err := svc.repo.TaskForUser("worker", task.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
				t.Fatalf("任务出现在个人空间：%v", err)
			}
			claimed, err := svc.repo.ClaimNextTask("media-worker", time.Minute)
			if err != nil || claimed == nil || claimed.ID != task.ID {
				t.Fatalf("未领取团队任务：%v", err)
			}
			if example.mode == "video" {
				// 使用已存储的检查点模拟视频供应商已返回作品，继续走真实 Worker 登记和结算。
				resource := model.Resource{ID: "generated-video", UserID: owner, Kind: "video", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "generated-video", MimeType: "video/mp4", Size: 80, DurationMs: 5000, UploadKey: mediaUploadKey(task.ID, 0)}
				if err := db.Create(&resource).Error; err != nil {
					t.Fatal(err)
				}
				checkpoint := &mediaCheckpoint{Mode: "video", StartedAt: time.Now(), Items: []mediaCheckpointItem{{ResourceID: resource.ID, MIMEType: resource.MimeType}}}
				if err := svc.saveMediaCheckpoint(claimed, checkpoint, "register"); err != nil {
					t.Fatal(err)
				}
			}
			if err := svc.taskWorker().processClaimedTask(claimed, nil); err != nil {
				t.Fatal(err)
			}
			if example.mode == "image" && calls.Load() != 1 {
				t.Fatalf("图片提交次数为 %d", calls.Load())
			}
			completed, err := svc.repo.TaskForUser(owner, task.ID)
			if err != nil || completed.Status != model.TaskStatusSucceeded || !strings.Contains(completed.ResultJSON, "/api/teams/team/workspace/resources/") {
				t.Fatalf("团队结果路径错误：%+v，%v", completed, err)
			}
			asset, err := svc.repo.AssetForUser(owner, generationMediaAssetID(task.ID, 0))
			if err != nil || asset.CreatedBy != "worker" || asset.Kind != example.mode {
				t.Fatalf("团队素材归属错误：%+v，%v", asset, err)
			}
			order, err := svc.repo.BillingOrder(claimed.BillingOrderID)
			if err != nil || order.Status != model.BillingStatusSettled || order.ActualAmountMicrocredits != charge || order.BillingAccountID != accountID || order.TeamID != "team" {
				t.Fatalf("团队订单结算错误：%+v，%v", order, err)
			}
			personal, err := svc.repo.CreditAccount("worker")
			if err != nil || personal.AvailableMicrocredits != 1234 || personal.ReservedMicrocredits != 0 {
				t.Fatalf("个人余额发生变化：%+v，%v", personal, err)
			}
		})
	}
}
