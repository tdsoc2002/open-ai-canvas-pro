package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestSaveAssetToLibraryHTTP(t *testing.T) {
	const archived = `{"status":"archived","data":{"storageKey":"resource:current-resource","dataUrl":""},"metadata":{"librarySaved":false,"source":"generation-task","prompt":"保留"},"custom":9007199254740993}`
	const previousRacePayload = `{"data":{"storageKey":"resource:before-race"},"metadata":{"librarySaved":false}}`
	const winningRacePayload = `{"data":{"storageKey":"resource:after-race"},"metadata":{"librarySaved":false}}`
	const quotaPrefix = `{"data":{"content":"`
	const quotaSuffix = `"}}`
	fullPayload := quotaPrefix + strings.Repeat("x", (1<<20)-len(quotaPrefix)-len(quotaSuffix)) + quotaSuffix

	gin.SetMode(gin.TestMode)
	t.Setenv("REDIS_URL", "")
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.SystemSetting{}, &model.Asset{}, &model.AssetVersion{}, &model.AssetRepresentation{}, &model.ProjectAssetLink{}, &model.CanvasProject{}, &model.Resource{}); err != nil {
		t.Fatal(err)
	}
	fixedAt := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	for _, item := range []any{
		&model.User{ID: "owner", Username: "owner", Email: "owner@example.invalid", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.User{ID: "other", Username: "other", Email: "other@example.invalid", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.AuthSession{ID: "owner-session", UserID: "owner", TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)},
		&model.AuthSession{ID: "other-session", UserID: "other", TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)},
		&model.SystemSetting{Key: "runtime_policy", ValueJSON: `{"resource":{"structuredDataMB":1}}`},
		&model.Asset{ID: "archived-asset", UserID: "owner", Kind: "image", Status: model.AssetVersionStatusArchived, Title: "原有标题", FolderID: "original-folder", PrimaryVersionID: "original-version", PayloadJSON: archived, CreatedAt: fixedAt, UpdatedAt: fixedAt},
		&model.Asset{ID: "quota-asset", UserID: "other", Kind: "text", Status: model.AssetVersionStatusConfirmed, PayloadJSON: fullPayload},
		&model.Asset{ID: "racing-asset", UserID: "owner", Kind: "image", Status: model.AssetVersionStatusConfirmed, PayloadJSON: previousRacePayload},
		&model.ProjectAssetLink{ID: "original-link", AssetID: "archived-asset", ProjectID: "original-project", Position: 7},
		&model.AssetVersion{ID: "original-version", AssetID: "archived-asset", Version: 1},
		&model.AssetRepresentation{ID: "original-representation", TaskID: "original-task", AssetVersionID: "original-version", ResourceID: "current-resource", Role: "output"},
		&model.Resource{ID: "current-resource", UserID: "owner", Kind: "image", Status: model.ResourceStatusReady, ObjectKey: "original-object"},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	svc := service.New(repository.New(db), t.TempDir())
	previous := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() { ConfigureRuntime(previous) })
	RegisterUserDataRoutes(router.Group("/api"), svc)

	patch := func(t *testing.T, id, session, body string, wantStatus int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPatch, "/api/assets/"+id+"/library", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if session != "" {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: session + ".test-token"})
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != wantStatus {
			t.Fatalf("PATCH %s received %d, want %d: %s", id, rec.Code, wantStatus, rec.Body.String())
		}
		return rec
	}

	t.Run("rejects foreign and malformed input before writing", func(t *testing.T) {
		patch(t, "archived-asset", "", `{}`, http.StatusUnauthorized)
		patch(t, "archived-asset", "other-session", `{}`, http.StatusNotFound)
		patch(t, "missing-asset", "owner-session", `{}`, http.StatusNotFound)
		for _, invalid := range []string{`null`, `{"resourceId":null}`, `{"resourceId":" "}`, `{"asset":{"id":"archived-asset","title":"伪造标题"}}`, `{} {}`} {
			patch(t, "archived-asset", "owner-session", invalid, http.StatusBadRequest)
		}
		patch(t, "archived-asset", "owner-session", `{"resourceId":"stale-resource"}`, http.StatusConflict)
		var asset model.Asset
		if err := db.First(&asset, "id = ?", "archived-asset").Error; err != nil || asset.PayloadJSON != archived || asset.Status != model.AssetVersionStatusArchived {
			t.Fatalf("invalid input changed asset: %+v, %v", asset, err)
		}
	})

	t.Run("preserves asset data and references when restoring archived asset", func(t *testing.T) {
		rec := patch(t, "archived-asset", "owner-session", `{"resourceId":"current-resource"}`, http.StatusOK)
		var resp struct {
			Code int
			Data struct {
				Asset struct {
					ID, Title, FolderID, PrimaryVersionID, Status string
					Data                                          struct{ StorageKey string }
					Metadata                                      struct {
						LibrarySaved bool
						Prompt       string
					}
				}
			}
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
		asset := resp.Data.Asset
		if resp.Code != 0 || asset.ID != "archived-asset" || asset.Status != "confirmed" || asset.Title != "原有标题" || asset.FolderID != "original-folder" || asset.PrimaryVersionID != "original-version" || asset.Data.StorageKey != "resource:current-resource" || !asset.Metadata.LibrarySaved || asset.Metadata.Prompt != "保留" {
			t.Fatalf("expected complete current record: %s", rec.Body.String())
		}
		patch(t, "archived-asset", "owner-session", `{}`, http.StatusOK)
		var saved model.Asset
		if err := db.First(&saved, "id = ?", "archived-asset").Error; err != nil || saved.Status != model.AssetVersionStatusConfirmed || !saved.UpdatedAt.Equal(fixedAt) || !strings.Contains(saved.PayloadJSON, `"custom":9007199254740993`) {
			t.Fatalf("stored fields no longer match: %+v, %v", saved, err)
		}
		var link model.ProjectAssetLink
		if err := db.First(&link, "id = ?", "original-link").Error; err != nil || link.AssetID != saved.ID || link.Position != 7 {
			t.Fatalf("project link was changed: %+v, %v", link, err)
		}
		var representation model.AssetRepresentation
		if err := db.First(&representation, "id = ?", "original-representation").Error; err != nil || representation.AssetVersionID != saved.PrimaryVersionID || representation.ResourceID != "current-resource" {
			t.Fatalf("version representation was changed: %+v, %v", representation, err)
		}
		var resource model.Resource
		if err := db.First(&resource, "id = ?", "current-resource").Error; err != nil || resource.ObjectKey != "original-object" {
			t.Fatalf("resource was changed: %+v, %v", resource, err)
		}
	})

	t.Run("rejects structured quota overflow for existing records", func(t *testing.T) {
		patch(t, "quota-asset", "other-session", `{}`, http.StatusForbidden)
		var stored model.Asset
		if err := db.First(&stored, "id = ?", "quota-asset").Error; err != nil || stored.PayloadJSON != fullPayload {
			t.Fatalf("quota failure changed payload (bytes=%d): %v", len(stored.PayloadJSON), err)
		}
	})

	t.Run("compare and swap does not overwrite a concurrent project replacement", func(t *testing.T) {
		callback := db.Callback().Update()
		if err := callback.Before("gorm:update").Register("test:replace_asset_before_library_save", func(tx *gorm.DB) {
			_, err := tx.Statement.ConnPool.ExecContext(tx.Statement.Context, "UPDATE assets SET payload_json = ? WHERE id = ?", winningRacePayload, "racing-asset")
			tx.AddError(err)
		}); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = callback.Remove("test:replace_asset_before_library_save") })
		patch(t, "racing-asset", "owner-session", `{"resourceId":"before-race"}`, http.StatusConflict)
		var stored model.Asset
		if err := db.First(&stored, "id = ?", "racing-asset").Error; err != nil || stored.PayloadJSON != winningRacePayload {
			t.Fatalf("concurrent asset replacement was overwritten: %+v, %v", stored, err)
		}
	})
}
