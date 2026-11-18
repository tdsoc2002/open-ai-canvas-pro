package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestTaskOutputAssetHTTP(t *testing.T) {
	const updatedAssetPayload = `{"data":{"storageKey":"resource:new-frame"},"metadata":{"source":"short-drama-workflow","librarySaved":false}}`
	const completedResult = `{
		"mode":"image",
		"images":[{"resourceId":"first"},{"storageKey":"resource:second"},{"resourceId":"ambiguous"}],
		"artifacts":[{"output":{"url":"/api/resources/workflow/file?download=1"}},{"resourceId":"foreign-resource"},{"resourceId":"foreign-asset"},{"resourceId":"unsaved"}],
		"metadata":{"resourceId":"reference-only"}
	}`

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
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.Task{}, &model.Resource{}, &model.Asset{}, &model.AssetVersion{}, &model.AssetRepresentation{}); err != nil {
		t.Fatal(err)
	}

	for _, item := range []any{
		&model.User{ID: "owner", Username: "owner", Email: "owner@example.invalid", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.AuthSession{ID: "output-session", UserID: "owner", TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)},
		&model.Task{ID: "completed", UserID: "owner", Status: model.TaskStatusSucceeded, ResultJSON: completedResult},
		&model.Task{ID: "historical-task", UserID: "owner", Status: model.TaskStatusSucceeded, ResultJSON: `{"mode":"video","video":{"resourceId":"old-frame"}}`},
		&model.Task{ID: "running", UserID: "owner", Status: model.TaskStatusRunning},
		&model.Task{ID: "foreign-task", UserID: "other", Status: model.TaskStatusSucceeded},
		&model.Resource{ID: "first", UserID: "owner", Kind: "image", Status: model.ResourceStatusReady},
		&model.Resource{ID: "second", UserID: "owner", Kind: "image", Status: model.ResourceStatusReady},
		&model.Resource{ID: "workflow", UserID: "owner", Kind: "image", Status: model.ResourceStatusReady},
		&model.Resource{ID: "old-frame", UserID: "owner", Kind: "image", Status: model.ResourceStatusReady},
		&model.Resource{ID: "new-frame", UserID: "owner", Kind: "image", Status: model.ResourceStatusReady},
		&model.Resource{ID: "unrelated", UserID: "owner", Kind: "image", Status: model.ResourceStatusReady},
		&model.Resource{ID: "metadata-only", UserID: "owner", Kind: "image", Status: model.ResourceStatusReady},
		&model.Resource{ID: "reference-only", UserID: "owner", Kind: "image", Status: model.ResourceStatusReady},
		&model.Resource{ID: "ambiguous", UserID: "owner", Kind: "image", Status: model.ResourceStatusReady},
		&model.Resource{ID: "foreign-asset", UserID: "owner", Kind: "image", Status: model.ResourceStatusReady},
		&model.Resource{ID: "foreign-resource", UserID: "other", Kind: "image", Status: model.ResourceStatusReady},
		&model.Resource{ID: "unsaved", UserID: "owner", Kind: "image", Status: model.ResourceStatusFailed},
		&model.Asset{ID: "old-incomplete-asset", UserID: "owner", PayloadJSON: ""},
		&model.Asset{ID: "old-broken-asset", UserID: "owner", PayloadJSON: "{"},
		&model.Asset{ID: "asset-first", UserID: "owner", Kind: "image", PayloadJSON: `{"data":{"storageKey":"resource:first"},"metadata":{"taskId":"completed","outputIndex":7}}`},
		&model.Asset{ID: "asset-second", UserID: "owner", Kind: "image", PayloadJSON: `{"data":{"storageKey":"resource:second"},"metadata":{"taskId":"completed","outputIndex":0,"librarySaved":false,"prompt":"保留完整投影"}}`},
		&model.Asset{ID: "workflow-copy", UserID: "owner", Kind: "image", PayloadJSON: `{"data":{"storageKey":"resource:workflow"},"metadata":{"taskId":"completed"}}`},
		&model.Asset{ID: "project-asset", UserID: "owner", Kind: "image", PayloadJSON: `{"data":{"storageKey":"resource:workflow"},"metadata":{"source":"short-drama-workflow"}}`},
		&model.Asset{ID: "updated-project-asset", UserID: "owner", Kind: "image", PrimaryVersionID: "new-frame-version", PayloadJSON: updatedAssetPayload},
		&model.Asset{ID: "asset-from-different-task", UserID: "owner", Kind: "image", PayloadJSON: `{"data":{"storageKey":"resource:unrelated"},"metadata":{"taskId":"running"}}`},
		&model.Asset{ID: "asset-without-task-output", UserID: "owner", Kind: "image", PayloadJSON: `{"data":{"storageKey":"resource:metadata-only"},"metadata":{"taskId":"completed"}}`},
		&model.Asset{ID: "asset-with-result-reference", UserID: "owner", Kind: "image", PayloadJSON: `{"data":{"storageKey":"resource:reference-only"},"metadata":{"taskId":"completed"}}`},
		&model.Asset{ID: "asset-ambiguous-a", UserID: "owner", Kind: "image", PayloadJSON: `{"data":{"storageKey":"resource:ambiguous"},"metadata":{"taskId":"completed"}}`},
		&model.Asset{ID: "asset-ambiguous-b", UserID: "owner", Kind: "image", PayloadJSON: `{"data":{"storageKey":"resource:ambiguous"},"metadata":{"taskId":"completed"}}`},
		&model.Asset{ID: "asset-of-other-user", UserID: "other", Kind: "image", PayloadJSON: `{"data":{"storageKey":"resource:foreign-asset"},"metadata":{"taskId":"completed"}}`},
		&model.Asset{ID: "asset-of-foreign-resource", UserID: "owner", Kind: "image", PayloadJSON: `{"data":{"storageKey":"resource:foreign-resource"},"metadata":{"taskId":"completed"}}`},
		&model.AssetVersion{ID: "workflow-version", AssetID: "project-asset", Version: 1},
		&model.AssetRepresentation{ID: "workflow-representation", TaskID: "completed", AssetVersionID: "workflow-version", ResourceID: "workflow", Role: "output"},
		&model.AssetVersion{ID: "old-frame-version", AssetID: "updated-project-asset", Version: 1},
		&model.AssetVersion{ID: "new-frame-version", AssetID: "updated-project-asset", Version: 2},
		&model.AssetRepresentation{ID: "old-frame-representation", TaskID: "historical-task", AssetVersionID: "old-frame-version", ResourceID: "old-frame", Role: "output"},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}

	router := gin.New()
	RegisterTaskRoutes(router.Group("/api"), service.New(repository.New(db), t.TempDir()))
	for _, tc := range []struct {
		name       string
		path       string
		authorized bool
		status     int
		assetID    string
	}{
		{"requires login", "completed/output-asset?resourceId=second", false, http.StatusUnauthorized, ""},
		{"resolves persisted bare resource ID", "completed/output-asset?resourceId=first", true, http.StatusOK, "asset-first"},
		{"uses selected resource, not order", "completed/output-asset?resourceId=second", true, http.StatusOK, "asset-second"},
		{"resolves project representation", "completed/output-asset?resourceId=workflow", true, http.StatusOK, "project-asset"},
		{"does not replace historical output with current asset version", "historical-task/output-asset?resourceId=old-frame", true, http.StatusNotFound, ""},
		{"missing resource ID", "completed/output-asset", true, http.StatusBadRequest, ""},
		{"task must be successful", "running/output-asset?resourceId=unrelated", true, http.StatusBadRequest, ""},
		{"resource must be saved", "completed/output-asset?resourceId=unsaved", true, http.StatusBadRequest, ""},
		{"task belongs to another user", "foreign-task/output-asset?resourceId=first", true, http.StatusNotFound, ""},
		{"resource belongs to another user", "completed/output-asset?resourceId=foreign-resource", true, http.StatusNotFound, ""},
		{"asset belongs to another user", "completed/output-asset?resourceId=foreign-asset", true, http.StatusNotFound, ""},
		{"resource belongs to different task", "completed/output-asset?resourceId=unrelated", true, http.StatusNotFound, ""},
		{"asset metadata alone is not task evidence", "completed/output-asset?resourceId=metadata-only", true, http.StatusNotFound, ""},
		{"task result metadata is not an output", "completed/output-asset?resourceId=reference-only", true, http.StatusNotFound, ""},
		{"metadata-only duplicate assets are ambiguous", "completed/output-asset?resourceId=ambiguous", true, http.StatusNotFound, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/tasks/"+tc.path, nil)
			if tc.authorized {
				req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "output-session.test-token"})
			}
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			if rec.Code != tc.status {
				t.Fatalf("status = %d, want %d: %s", rec.Code, tc.status, rec.Body.String())
			}
			var envelope struct {
				Code   int
				Reason string
				Data   struct {
					Asset struct {
						ID       string
						Metadata struct {
							LibrarySaved *bool
							Prompt       string
						}
					}
				}
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
				t.Fatal(err)
			}
			if tc.assetID == "" {
				if envelope.Code != tc.status || envelope.Reason == "" || envelope.Data.Asset.ID != "" {
					t.Fatalf("want an error envelope without an asset: %s", rec.Body.String())
				}
				return
			}
			if envelope.Code != 0 || envelope.Data.Asset.ID != tc.assetID {
				t.Fatalf("want successful asset %s: %s", tc.assetID, rec.Body.String())
			}
			if metadata := envelope.Data.Asset.Metadata; tc.assetID == "asset-second" && (metadata.LibrarySaved == nil || *metadata.LibrarySaved || metadata.Prompt != "保留完整投影") {
				t.Fatalf("want unchanged asset metadata: %s", rec.Body.String())
			}
		})
	}

	var asset model.Asset
	if err := db.First(&asset, "id = ?", "asset-second").Error; err != nil {
		t.Fatal(err)
	}
	if asset.PayloadJSON != `{"data":{"storageKey":"resource:second"},"metadata":{"taskId":"completed","outputIndex":0,"librarySaved":false,"prompt":"保留完整投影"}}` {
		t.Fatalf("lookup modified stored payload: %s", asset.PayloadJSON)
	}
	asset = model.Asset{}
	if err := db.First(&asset, "id = ?", "updated-project-asset").Error; err != nil {
		t.Fatal(err)
	}
	if asset.PrimaryVersionID != "new-frame-version" || asset.PayloadJSON != updatedAssetPayload {
		t.Fatalf("lookup modified current project asset: %+v", asset)
	}
	var historical model.AssetRepresentation
	if err := db.First(&historical, "id = ?", "old-frame-representation").Error; err != nil {
		t.Fatal(err)
	}
	if historical.AssetVersionID != "old-frame-version" || historical.ResourceID != "old-frame" {
		t.Fatalf("lookup modified historical representation: %+v", historical)
	}
}
