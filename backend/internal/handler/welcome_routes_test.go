package handler

import (
	"encoding/json"
	"maps"
	"net/http"
	"net/http/httptest"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestWelcomeAndWorkspaceNavigationPublicRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	RegisterFeatureAvailabilityRoutes(router.Group("/api"), service.New(repository.New(db), t.TempDir()))
	readPublic := func(path string, want map[string]bool) {
		t.Helper()
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s: unexpected public response: %d %s", path, response.Code, response.Body.String())
		}
		var body struct {
			Code int             `json:"code"`
			Data map[string]bool `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body.Code != 0 || !maps.Equal(body.Data, want) {
			t.Fatalf("%s: unexpected public payload: %s", path, response.Body.String())
		}
	}
	for _, enabled := range []bool{true, false, true} {
		navigation := map[string]bool{
			"shortDramaEnabled": !enabled, "taskCenterEnabled": !enabled,
			"teamsEnabled": enabled, "imageWorkbenchEnabled": enabled,
			"videoWorkbenchEnabled": enabled, "ecommerceEnabled": enabled,
		}
		config := maps.Clone(navigation)
		config["welcomeEnabled"] = enabled
		config["creditsEnabled"] = !enabled
		payload, err := json.Marshal(config)
		if err != nil {
			t.Fatal(err)
		}
		if err := db.Save(&model.SystemSetting{Key: "feature_availability", ValueJSON: string(payload), UpdatedBy: "admin-test-id"}).Error; err != nil {
			t.Fatal(err)
		}
		readPublic("/api/public/welcome", map[string]bool{"welcomeEnabled": enabled})
		readPublic("/api/public/workspace-navigation", navigation)
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/features", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("authenticated features returned %d to a guest", response.Code)
	}
}
