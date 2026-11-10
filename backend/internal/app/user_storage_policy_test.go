package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestPersonalStoragePolicyBlocksBoundWritesAfterRevocation(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	svc := newResourceTestService(t)
	setPersonalStorageAllowed(t, svc, true)
	actor := &model.User{ID: "user-1"}
	_, err := svc.UpdateUserOSSSetting(actor, OSSSettingRequest{Enabled: true, Provider: "aliyun", Endpoint: server.URL, Bucket: "personal", AccessKeyID: "test-id", AccessKeySecret: "test-secret"})
	if err != nil {
		t.Fatal(err)
	}
	setting, _, err := svc.readUserOSSSetting(actor.ID)
	if err != nil {
		t.Fatal(err)
	}
	location := &model.StorageLocation{ID: newID(), Scope: "user", OwnerID: actor.ID, Provider: "aliyun", LocationDigest: newID(), ValueJSON: setting.ValueJSON}
	if err := svc.repo.CreateStorageLocation(location); err != nil {
		t.Fatal(err)
	}
	setPersonalStorageAllowed(t, svc, false)
	for _, id := range []string{setting.ID, location.ID, ""} {
		resource := &model.Resource{UserID: actor.ID, Provider: "aliyun", Endpoint: server.URL, Bucket: "personal", StorageSettingID: id, ObjectKey: "test.txt", MimeType: "text/plain", Size: 4}
		if _, err := svc.ossSettingForResource(actor.ID, resource); err != nil {
			t.Fatalf("historical read configuration unavailable: %v", err)
		}
		_, err = svc.storeResourceObject(resource, "test.txt", strings.NewReader("test"))
		var denied *AppError
		if !errors.As(err, &denied) || denied.Status != http.StatusForbidden {
			t.Fatalf("bound resource write not denied: %v", err)
		}
		_, err = svc.storeTaskMediaObjectContext(context.Background(), resource, strings.NewReader("test"))
		if !errors.As(err, &denied) || denied.Status != http.StatusForbidden {
			t.Fatalf("bound task media write not denied: %v", err)
		}
	}
	if requests != 0 {
		t.Fatalf("revoked personal storage received %d requests", requests)
	}
	platform := &model.StorageLocation{ID: newID(), Scope: "platform", Provider: "aliyun", LocationDigest: newID(), ValueJSON: setting.ValueJSON}
	if err := svc.repo.CreateStorageLocation(platform); err != nil {
		t.Fatal(err)
	}
	resource := &model.Resource{UserID: actor.ID, Provider: "aliyun", Endpoint: server.URL, Bucket: "personal", StorageSettingID: platform.ID, ObjectKey: "platform.txt", MimeType: "text/plain", Size: 4}
	if _, err := svc.storeResourceObject(resource, "platform.txt", strings.NewReader("test")); err != nil {
		t.Fatalf("platform storage write was blocked: %v", err)
	}
	if requests != 1 {
		t.Fatalf("platform storage did not receive its write: %d", requests)
	}
}

func setPersonalStorageAllowed(t *testing.T, svc *Service, allowed bool) {
	t.Helper()
	_, value, err := svc.readOSSSetting()
	if err != nil {
		t.Fatal(err)
	}
	value.AllowUserS3 = allowed
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(encoded)}); err != nil {
		t.Fatal(err)
	}
}

func TestPersonalStoragePolicyRejectsSaveAndTestForEveryProvider(t *testing.T) {
	for _, provider := range []string{"aliyun", "tencent", "qiniu", "volcengine", "s3"} {
		t.Run(provider, func(t *testing.T) {
			svc := newResourceTestService(t)
			actor := &model.User{ID: "user-1"}
			assertForbidden := func(err error) {
				t.Helper()
				var appErr *AppError
				if !errors.As(err, &appErr) || appErr.Status != http.StatusForbidden {
					t.Fatalf("expected policy denial before validation or upstream access, got %v", err)
				}
			}
			for _, enabled := range []bool{false, true} {
				_, err := svc.UpdateUserOSSSetting(actor, OSSSettingRequest{Enabled: enabled, Provider: provider})
				assertForbidden(err)
			}
			_, err := svc.TestUserOSSSetting(actor, OSSSettingRequest{Provider: provider})
			assertForbidden(err)
			setting, _, err := svc.readUserOSSSetting(actor.ID)
			if err != nil || setting != nil {
				t.Fatalf("blocked request persisted configuration: %v, %v", setting, err)
			}
		})
	}
}

func TestPersonalStoragePolicyDisablesExistingProvidersAndFallsBack(t *testing.T) {
	for _, provider := range []string{"aliyun", "tencent", "qiniu", "volcengine", "s3"} {
		t.Run(provider, func(t *testing.T) {
			svc := newResourceTestService(t)
			actor := &model.User{ID: "user-1"}
			value := ossSettingValue{Enabled: true, Provider: provider, Endpoint: "https://storage.example.com", Bucket: "personal", Region: "test-region", AccessKeyID: "test-id", AccessKeySecret: "test-secret"}
			stored, err := svc.encryptOSSSettingSecrets(value)
			if err != nil {
				t.Fatal(err)
			}
			encoded, _ := json.Marshal(stored)
			setting := model.UserOSSSetting{ID: newID(), UserID: actor.ID, Enabled: true, ValueJSON: string(encoded)}
			if err := svc.repo.CreateUserOSSSetting(&setting); err != nil {
				t.Fatal(err)
			}
			public, err := svc.UserOSSSetting(actor)
			if err != nil || public.Enabled || public.AllowUserS3 {
				t.Fatalf("disabled personal storage still reported enabled: %v", err)
			}
			_, _, useOSS, err := svc.activeResourceOSSSetting(actor.ID)
			if err != nil || useOSS {
				t.Fatalf("disabled personal storage selected for upload: useOSS=%v err=%v", useOSS, err)
			}
			platform := ossSettingValue{Enabled: true, Provider: "aliyun", Endpoint: "https://platform.example.com", Bucket: "platform", AccessKeyID: "test-id", AccessKeySecret: "test-secret"}
			encoded, _ = json.Marshal(platform)
			if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(encoded)}); err != nil {
				t.Fatal(err)
			}
			active, _, useOSS, err := svc.activeResourceOSSSetting(actor.ID)
			if err != nil || !useOSS || active.Bucket != "platform" {
				t.Fatalf("platform fallback failed: useOSS=%v err=%v", useOSS, err)
			}
			if provider == "aliyun" {
				historical, err := svc.ossSettingForResource(actor.ID, &model.Resource{UserID: actor.ID, Provider: provider, StorageSettingID: setting.ID, Endpoint: value.Endpoint, Bucket: value.Bucket})
				if err != nil || historical.Bucket != "personal" {
					t.Fatalf("existing resource lost its bound storage: %v", err)
				}
			}
		})
	}
}
