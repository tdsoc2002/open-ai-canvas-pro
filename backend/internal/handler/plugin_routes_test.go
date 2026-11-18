package handler

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestApplicationPluginRoutesSeparatePersonalAndAdminCatalogs(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const protocolID = "openai-chat-completions"
	const eagleID = "eagle-asset-connector"
	officialDir := t.TempDir()
	pkg, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", protocolID+".yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(officialDir, protocolID+".yingce-plugin"), pkg, 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CANVAS_OFFICIAL_PLUGIN_DIR", officialDir)
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "test.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.UserGroup{}, &model.AuthSession{}, &model.SystemSetting{}, &model.PluginPlatformState{}, &model.UserPluginState{}); err != nil {
		t.Fatal(err)
	}
	for _, role := range []model.UserRole{model.UserRoleAdmin, model.UserRoleUser} {
		id := string(role)
		if err := db.Create(&model.User{ID: id, Username: id, Email: id + "@example.invalid", Role: role, Status: model.UserStatusActive}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.AuthSession{ID: id, UserID: id, TokenHash: auth.HashToken("fixture-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&model.SystemSetting{Key: "feature_availability", ValueJSON: `{"pluginCenterEnabled":true,"systemPluginsVisibleToUsers":true}`}).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), t.TempDir())
	t.Cleanup(func() {
		if err := svc.Close(); err != nil {
			t.Error(err)
		}
	})
	router := gin.New()
	RegisterPluginRoutes(router.Group("/api"), svc)

	for _, role := range []string{"user", "admin"} {
		for _, path := range []string{"/api/plugins", "/api/plugins/status"} {
			w := profileRequest(router, http.MethodGet, path, "", role+".fixture-token")
			body := w.Body.String()
			if w.Code != http.StatusOK || !strings.Contains(body, `"`+eagleID+`"`) || strings.Contains(body, `"`+protocolID+`"`) {
				t.Errorf("%s %s: %d %s", role, path, w.Code, body)
			}
		}
	}
	if w := profileRequest(router, http.MethodGet, "/api/admin/plugins", "", "user.fixture-token"); w.Code != http.StatusForbidden {
		t.Fatalf("user admin catalog: %d %s", w.Code, w.Body)
	}
	if w := profileRequest(router, http.MethodGet, "/api/admin/plugins", "", "admin.fixture-token"); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"id":"`+protocolID+`"`) {
		t.Fatalf("admin catalog: %d %s", w.Code, w.Body)
	}
	pkgPath := "/api/plugins/" + protocolID + "/package"
	if w := profileRequest(router, http.MethodGet, pkgPath, "", "user.fixture-token"); w.Code != http.StatusForbidden {
		t.Errorf("user managed package: %d", w.Code)
	}
	if w := profileRequest(router, http.MethodGet, pkgPath, "", "admin.fixture-token"); w.Code != http.StatusOK || w.Header().Get("Content-Type") != "application/zip" {
		t.Errorf("admin managed package: %d", w.Code)
	}
	if w := profileRequest(router, http.MethodPut, "/api/plugins/"+eagleID+"/activation", `{"enabled":true}`, "user.fixture-token"); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"effectiveEnabled":true`) {
		t.Errorf("user Eagle activation: %d %s", w.Code, w.Body)
	}
}
