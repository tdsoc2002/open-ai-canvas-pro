package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

func TestUILanguageAvailabilityRoutes(t *testing.T) {
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
	if err := db.AutoMigrate(&model.User{}, &model.UserGroup{}, &model.AuthSession{}, &model.SystemSetting{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	for _, role := range []model.UserRole{model.UserRoleAdmin, model.UserRoleUser} {
		id := string(role)
		if err := db.Create(&model.User{ID: id, Username: id, Email: id + "@example.invalid", Role: role, Status: model.UserStatusActive}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.AuthSession{ID: id, UserID: id, TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	RegisterFeatureAvailabilityRoutes(router.Group("/api"), service.New(repository.New(db), t.TempDir()))
	call := func(method, path, role, payload string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(payload))
		r.Header.Set("Content-Type", "application/json")
		if role != "" {
			r.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: role + ".test-token"})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	readPublic := func(want bool) {
		t.Helper()
		w := call(http.MethodGet, "/api/public/ui-language", "", "")
		var body struct {
			Code int             `json:"code"`
			Data map[string]bool `json:"data"`
		}
		err := json.Unmarshal(w.Body.Bytes(), &body)
		got, present := body.Data["multilingualEnabled"]
		if w.Code != http.StatusOK || w.Header().Get("Cache-Control") != "no-store" || err != nil || body.Code != 0 || len(body.Data) != 1 || !present || got != want {
			t.Fatalf("unexpected public response: %d %s", w.Code, w.Body.String())
		}
	}
	readPublic(false)
	if err := db.Create(&model.SystemSetting{Key: "feature_availability", ValueJSON: `{"welcomeEnabled":false}`}).Error; err != nil {
		t.Fatal(err)
	}
	readPublic(false)
	const adminPath = "/api/admin/settings/features"
	for role, status := range map[string]int{"": http.StatusUnauthorized, "user": http.StatusForbidden} {
		if w := call(http.MethodPatch, adminPath, role, `{"multilingualEnabled":true}`); w.Code != status {
			t.Fatalf("PATCH role %q returned %d: %s", role, w.Code, w.Body.String())
		}
	}
	if w := call(http.MethodPatch, adminPath, "admin", `{"multilingualEnabled":"true"}`); w.Code != http.StatusBadRequest {
		t.Fatalf("non-boolean update returned %d: %s", w.Code, w.Body.String())
	}
	for _, payload := range []string{`{"multilingualEnabled":true}`, `{"multilingualEnabled":false}`} {
		want := strings.Contains(payload, "true")
		if w := call(http.MethodPatch, adminPath, "admin", payload); w.Code != http.StatusOK {
			t.Fatalf("admin update returned %d: %s", w.Code, w.Body.String())
		}
		readPublic(want)
		w := call(http.MethodGet, adminPath, "admin", "")
		if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), strings.Trim(payload, "{}")) || !strings.Contains(w.Body.String(), `"welcomeEnabled":false`) {
			t.Fatalf("admin read did not reflect saved flags: %d %s", w.Code, w.Body.String())
		}
	}
	var count int64
	if err := db.Model(&model.AdminAuditEvent{}).Where("action = ?", "feature_availability.update").Count(&count).Error; err != nil || count != 2 {
		t.Fatalf("expected two audited updates, got %d, err=%v", count, err)
	}
}
