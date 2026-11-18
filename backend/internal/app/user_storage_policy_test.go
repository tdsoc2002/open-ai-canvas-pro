package app

import (
	"bytes"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"gorm.io/gorm"

	"yingce/backend/internal/model"
)

func permitPersonalStorage(t *testing.T, svc *Service) {
	t.Helper()
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: `{"allowUserStorage":true}`}); err != nil {
		t.Fatal(err)
	}
}

func TestPlatformOnlyStorageRejectsAllPersonalProviders(t *testing.T) {
	svc, db := newResourceFallbackTestService(t)
	actor := &model.User{ID: "user-1", Role: model.UserRoleUser}
	// 旧开关只授权 S3，不能用来放宽所有供应商。
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: `{"allowUserS3":true}`}); err != nil {
		t.Fatal(err)
	}
	for _, provider := range []string{aliyunOSSProvider, tencentCOSProvider, qiniuKodoProvider, volcengineTOSProvider, s3Provider} {
		t.Run(provider, func(t *testing.T) {
			req := OSSSettingRequest{Provider: provider, Enabled: true}
			_, saveErr := svc.UpdateUserOSSSetting(actor, req)
			_, testErr := svc.TestUserOSSSetting(actor, req)
			for _, err := range []error{saveErr, testErr} {
				var appErr *AppError
				if !errors.As(err, &appErr) || appErr.Status != http.StatusForbidden {
					t.Errorf("个人存储操作应返回 403，实际为 %v", err)
				}
			}
		})
	}
	if _, err := svc.UpdateUserOSSSetting(actor, OSSSettingRequest{Provider: aliyunOSSProvider}); err == nil {
		t.Fatal("关闭时不应接受停用形式的配置写入")
	}
	var count int64
	if err := db.Model(&model.UserOSSSetting{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("拒绝后不应保存配置：count=%d, err=%v", count, err)
	}
}

func TestPlatformOnlyStorageDoesNotRebindHistoricalResources(t *testing.T) {
	svc, db := newResourceFallbackTestService(t)
	actor := &model.User{ID: "user-1", Role: model.UserRoleUser}
	const endpoint = "http://127.0.0.1:1"
	seedOSSEnabled(t, db, actor.ID, endpoint)
	historical, _, err := svc.readUserOSSSetting(actor.ID)
	if err != nil {
		t.Fatal(err)
	}
	old := model.Resource{Provider: aliyunOSSProvider, Endpoint: endpoint, Bucket: "test-bucket", StorageSettingID: historical.ID}
	if public, err := svc.UserOSSSetting(actor); err != nil || public.AllowUserStorage || public.Enabled || public.Bucket != "" {
		t.Fatalf("关闭时不应返回个人配置：%v", err)
	}
	resolved, err := svc.ossSettingForResource(actor.ID, &old)
	if err != nil || resolved.Bucket != old.Bucket || resolved.Endpoint != endpoint {
		t.Fatalf("历史资源应按原位置解析：%v", err)
	}
	var forbidden *AppError
	if _, err := svc.ossSettingForResourceRetry(actor.ID, &old); !errors.As(err, &forbidden) || forbidden.Status != http.StatusForbidden {
		t.Fatalf("关闭后既有个人对象不得继续重试写入：%v", err)
	}
	resource, _, err := svc.storeResource(actor.ID, "image", "new.png", "image/png", 4, 1, 1, 0, bytes.NewReader([]byte("test")), nil, false)
	if err != nil || resource.Provider != "local" || resource.StorageSettingID != "" {
		t.Fatalf("平台本地模式不应再使用个人桶：%v", err)
	}
	if err := db.Create(&model.SystemSetting{Key: ossSettingKey, ValueJSON: `{"enabled":true,"provider":"aliyun","endpoint":"https://oss-cn-hangzhou.aliyuncs.com","bucket":"platform-bucket","accessKeyId":"test","accessKeySecret":"test"}`}).Error; err != nil {
		t.Fatal(err)
	}
	active, binding, enabled, err := svc.activeResourceOSSSetting(actor.ID)
	if err != nil || !enabled || active.Bucket != "platform-bucket" || binding == historical.ID {
		t.Fatalf("应选择平台对象存储：enabled=%v, err=%v", enabled, err)
	}
}

func TestPersonalStoragePolicyBlocksBoundRetriesAfterRevocation(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	svc, db := newMediaRecoveryTestService(t)
	task := seedMediaTask(t, db, providerConfig{})
	actor := &model.User{ID: task.UserID}
	permitPersonalStorage(t, svc)
	if _, err := svc.UpdateUserOSSSetting(actor, OSSSettingRequest{Enabled: true, Provider: aliyunOSSProvider, Endpoint: server.URL, Bucket: "personal", AccessKeyID: "test-id", AccessKeySecret: "test-secret"}); err != nil {
		t.Fatal(err)
	}
	legacy, _, err := svc.readUserOSSSetting(actor.ID)
	if err != nil {
		t.Fatal(err)
	}
	location := &model.StorageLocation{ID: newID(), Scope: "user", OwnerID: actor.ID, Provider: aliyunOSSProvider, LocationDigest: newID(), ValueJSON: legacy.ValueJSON}
	if err := svc.repo.CreateStorageLocation(location); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: `{"allowUserStorage":false}`}); err != nil {
		t.Fatal(err)
	}
	picture := mediaTestPNG(t)
	staged := filepath.Join(t.TempDir(), "generated.png")
	if err := os.WriteFile(staged, picture, 0o600); err != nil {
		t.Fatal(err)
	}
	assertForbidden := func(err error) {
		t.Helper()
		var denied *AppError
		if !errors.As(err, &denied) || denied.Status != http.StatusForbidden {
			t.Fatalf("绑定资源的写重试应被拒绝：%v", err)
		}
	}
	for _, id := range []string{legacy.ID, location.ID, ""} {
		resource := &model.Resource{UserID: actor.ID, Kind: "image", Status: model.ResourceStatusFailed, Provider: aliyunOSSProvider, Endpoint: server.URL, Bucket: "personal", StorageSettingID: id, ObjectKey: "test.png", MimeType: "image/png", Size: int64(len(picture))}
		if _, err := svc.ossSettingForResource(actor.ID, resource); err != nil {
			t.Fatalf("历史资源应可解析：%v", err)
		}
		_, err := svc.retryStoredResource(actor.ID, resource, "image", resource.MimeType, resource.Size, bytes.NewReader(picture))
		assertForbidden(err)
		_, _, err = svc.storeTaskMediaFile(task, 0, staged, resource.MimeType, "image", resource)
		assertForbidden(err)
	}
	foreign := &model.Resource{Provider: aliyunOSSProvider, StorageSettingID: location.ID}
	if _, err := svc.ossSettingForResource("another-user", foreign); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("不能跨用户解析自有绑定：%v", err)
	}
	if requests.Load() != 0 {
		t.Fatal("关闭权限后不应向个人桶发出请求")
	}
}

func TestPlatformOnlyStorageUsesPlatformCredentialsForNewObjects(t *testing.T) {
	svc, db := newMediaRecoveryTestService(t)
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	authorizations := make(chan string, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorizations <- r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	if err := db.Create(&model.SystemSetting{Key: ossSettingKey, ValueJSON: `{"enabled":true,"provider":"aliyun","endpoint":"` + server.URL + `","bucket":"test-bucket","accessKeyId":"platform-id","accessKeySecret":"platform-secret"}`}).Error; err != nil {
		t.Fatal(err)
	}
	const userID = "media-user"
	seedOSSEnabled(t, db, userID, server.URL)
	uploaded, _, err := svc.storeResource(userID, "image", "new.png", "image/png", 4, 1, 1, 0, bytes.NewReader([]byte("test")), nil, false)
	if err != nil {
		t.Fatal(err)
	}
	staged := filepath.Join(t.TempDir(), "generated.png")
	if err := os.WriteFile(staged, mediaTestPNG(t), 0o600); err != nil {
		t.Fatal(err)
	}
	task := seedMediaTask(t, db, providerConfig{})
	resource, fallback, err := svc.storeTaskMediaFile(task, 0, staged, "image/png", "image", nil)
	if err != nil || fallback != nil || resource.Provider != aliyunOSSProvider {
		t.Fatalf("新生成作品应写入平台桶：%v / %v", err, fallback)
	}
	for range 2 {
		select {
		case header := <-authorizations:
			if !strings.Contains(header, "platform-id") {
				t.Fatal("新对象未使用平台密钥签名")
			}
		default:
			t.Fatal("没有收到预期的对象存储写入")
		}
	}
	for _, item := range []*model.Resource{uploaded, resource} {
		for _, resolve := range []func(string, *model.Resource) (ossSettingValue, error){svc.ossSettingForResource, svc.ossSettingForResourceRetry} {
			setting, err := resolve(userID, item)
			if err != nil || setting.AccessKeyID != "platform-id" {
				t.Fatalf("新平台对象的读取和写入重试都应解析到平台凭据：%v", err)
			}
		}
	}
}
