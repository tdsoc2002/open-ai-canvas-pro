package repository

import (
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newAssetLibraryTestRepository(t *testing.T) (*Repository, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:asset-library-test-%d?mode=memory&cache=shared", time.Now().UnixNano())), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Asset{}, &model.AssetFolder{}); err != nil {
		t.Fatal(err)
	}
	return New(db), db
}

func TestUserCharacterAssetsPageReturnsStablePages(t *testing.T) {
	repo, db := newAssetLibraryTestRepository(t)
	now := time.Now().UTC()
	for index, title := range []string{"甲", "乙", "丙"} {
		asset := model.Asset{ID: fmt.Sprintf("character-%d", index), UserID: "user-1", Kind: "entity", Category: model.AssetCategoryCharacter, Status: model.AssetVersionStatusConfirmed, Title: title, PayloadJSON: "{}", CreatedAt: now, UpdatedAt: now.Add(time.Duration(index) * time.Second)}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&model.Asset{ID: "image-1", UserID: "user-1", Kind: "image", Category: model.AssetCategoryMaterial, Status: model.AssetVersionStatusConfirmed, Title: "不是角色", PayloadJSON: "{}", CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	first, total, err := repo.UserCharacterAssetsPage("user-1", "", 1, 2)
	if err != nil {
		t.Fatal(err)
	}
	second, _, err := repo.UserCharacterAssetsPage("user-1", "乙", 1, 2)
	if err != nil {
		t.Fatal(err)
	}
	if total != 3 || len(first) != 2 || first[0].ID != "character-2" || len(second) != 1 || second[0].Title != "乙" {
		t.Fatalf("page = total %d first %#v search %#v", total, first, second)
	}
}

func TestUserAssetsPagePaginatesAndIsolatesUsers(t *testing.T) {
	repo, db := newAssetLibraryTestRepository(t)
	now := time.Now().UTC()
	for _, asset := range []model.Asset{
		{ID: "asset-1", UserID: "user-1", Kind: "image", Category: model.AssetCategoryMaterial, Status: model.AssetVersionStatusConfirmed, Title: "海边", PayloadJSON: `{"id":"asset-1","title":"海边"}`, CreatedAt: now, UpdatedAt: now},
		{ID: "asset-2", UserID: "user-1", Kind: "image", Category: model.AssetCategoryMaterial, Status: model.AssetVersionStatusConfirmed, Title: "室内", PayloadJSON: `{"id":"asset-2","title":"室内"}`, CreatedAt: now, UpdatedAt: now.Add(time.Second)},
		{ID: "asset-3", UserID: "user-1", Kind: "text", Category: model.AssetCategoryOther, Status: model.AssetVersionStatusConfirmed, Title: "提示词", PayloadJSON: `{"id":"asset-3","title":"提示词"}`, CreatedAt: now, UpdatedAt: now.Add(2 * time.Second)},
		{ID: "asset-4", UserID: "user-2", Kind: "image", Category: model.AssetCategoryMaterial, Status: model.AssetVersionStatusConfirmed, Title: "他人素材", PayloadJSON: `{"id":"asset-4","title":"他人素材"}`, CreatedAt: now, UpdatedAt: now},
	} {
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
	}

	assets, total, err := repo.UserAssetsPage("user-1", 2, 1, UserAssetPageFilter{Kind: "image", Status: "active"})
	if err != nil {
		t.Fatal(err)
	}
	if total != 2 || len(assets) != 1 || assets[0].ID != "asset-1" {
		t.Fatalf("page result = total %d, assets %#v; want total 2 and asset-1", total, assets)
	}
}

func TestUserAssetLibraryMembershipFiltersPagesAndFacetsOnly(t *testing.T) {
	repo, db := newAssetLibraryTestRepository(t)
	for i, tc := range []struct {
		id, owner, status, payload string
	}{
		{"legacy-manual", "user", "confirmed", `{"metadata":{"source":"canvas-manual"}}`},
		{"unknown", "user", "confirmed", `{"metadata":{"source":"future"}}`},
		{"saved", "user", "confirmed", `{"metadata":{"source":"generation-task","librarySaved":true}}`},
		{"generation-task", "user", "confirmed", `{"metadata":{"source":"generation-task","librarySaved":"true"}}`},
		{"canvas-generation", "user", "confirmed", `{"metadata":{"source":"canvas-generation","librarySaved":null}}`},
		{"canvas-upload", "user", "confirmed", `{"metadata":{"source":"canvas-upload","librarySaved":1}}`},
		{"short-drama-workflow", "user", "confirmed", `{"metadata":{"source":"short-drama-workflow"}}`},
		{"short-drama", "user", "confirmed", `{"metadata":{"source":"short-drama"}}`},
		{"previs", "user", "confirmed", `{"metadata":{"source":"previs"}}`},
		{"public-reference-gallery", "user", "confirmed", `{"metadata":{"source":"public-reference-gallery"}}`},
		{"explicit-hidden", "user", "confirmed", `{"metadata":{"source":"canvas-manual","librarySaved":false}}`},
		{"legacy-empty", "user", "confirmed", ""},
		{"legacy-archived", "user", "archived", `{}`},
		{"hidden-archived", "user", "archived", `{"metadata":{"source":"short-drama"}}`},
		{"foreign", "other", "confirmed", `{"metadata":{"librarySaved":true}}`},
	} {
		asset := model.Asset{ID: tc.id, UserID: tc.owner, Kind: "image", Category: model.AssetCategoryMaterial, FolderID: "folder", Title: "Match", Status: model.AssetVersionStatus(tc.status), PayloadJSON: tc.payload, UpdatedAt: time.Unix(int64(i), 0)}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
	}
	page, total, err := repo.UserAssetsPage("user", 2, 2, UserAssetPageFilter{Status: "active", Query: "match"})
	if err != nil || total != 4 || len(page) != 2 || page[0].ID != "unknown" || page[1].ID != "legacy-manual" {
		t.Fatalf("filtered page: %#v, total=%d, err=%v", page, total, err)
	}
	kinds, categories, folders, err := repo.UserAssetFacets("user", "active")
	if err != nil {
		t.Fatal(err)
	}
	for label, rows := range map[string][]UserAssetFacetRow{"kind": kinds, "category": categories, "folder": folders} {
		if len(rows) != 1 || rows[0].Count != total {
			t.Errorf("%s facets: %#v, want %d", label, rows, total)
		}
	}
	archived, total, err := repo.UserAssetsPage("user", 1, 20, UserAssetPageFilter{Status: "archived"})
	if err != nil || total != 1 || len(archived) != 1 || archived[0].ID != "legacy-archived" {
		t.Fatalf("archived page: %#v, total=%d, err=%v", archived, total, err)
	}
	asset, err := repo.AssetForUser("user", "short-drama")
	if err != nil || asset.PayloadJSON != `{"metadata":{"source":"short-drama"}}` || asset.Status != "confirmed" {
		t.Fatalf("library visibility changed project asset: %#v, err=%v", asset, err)
	}
	assets, err := repo.Assets("user")
	if err != nil || len(assets) != 14 {
		t.Fatalf("full sync read: %d assets, err=%v", len(assets), err)
	}
}

func TestDeleteAssetFolderMovesAssetsToUncategorized(t *testing.T) {
	repo, db := newAssetLibraryTestRepository(t)
	now := time.Now().UTC()
	folder := model.AssetFolder{ID: "folder-1", UserID: "user-1", Name: "灵感", NameKey: "灵感", Position: 0, CreatedAt: now, UpdatedAt: now}
	asset := model.Asset{ID: "asset-1", UserID: "user-1", FolderID: folder.ID, Kind: "image", Category: model.AssetCategoryMaterial, Status: model.AssetVersionStatusConfirmed, Title: "海边", PayloadJSON: `{"id":"asset-1","folderId":"folder-1"}`, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&folder).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}

	if err := repo.DeleteAssetFolder("user-1", folder.ID); err != nil {
		t.Fatal(err)
	}
	var moved model.Asset
	if err := db.First(&moved, "id = ?", asset.ID).Error; err != nil {
		t.Fatal(err)
	}
	if moved.FolderID != "" || strings.Contains(moved.PayloadJSON, "folderId") {
		t.Fatalf("asset after folder deletion = %#v", moved)
	}
}

func TestMoveUserAssetsToFolderRollsBackWhenAnyAssetIsForeign(t *testing.T) {
	repo, db := newAssetLibraryTestRepository(t)
	now := time.Now().UTC()
	folder := model.AssetFolder{ID: "folder-1", UserID: "user-1", Name: "灵感", NameKey: "灵感", Position: 0, CreatedAt: now, UpdatedAt: now}
	assets := []model.Asset{
		{ID: "asset-1", UserID: "user-1", Kind: "image", Category: model.AssetCategoryMaterial, Status: model.AssetVersionStatusConfirmed, Title: "海边", PayloadJSON: `{"id":"asset-1"}`, CreatedAt: now, UpdatedAt: now},
		{ID: "asset-2", UserID: "user-2", Kind: "image", Category: model.AssetCategoryMaterial, Status: model.AssetVersionStatusConfirmed, Title: "他人素材", PayloadJSON: `{"id":"asset-2"}`, CreatedAt: now, UpdatedAt: now},
	}
	if err := db.Create(&folder).Error; err != nil {
		t.Fatal(err)
	}
	for index := range assets {
		if err := db.Create(&assets[index]).Error; err != nil {
			t.Fatal(err)
		}
	}

	if err := repo.MoveUserAssetsToFolder("user-1", []string{"asset-1", "asset-2"}, folder.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("move error = %v, want record-not-found", err)
	}
	var unchanged model.Asset
	if err := db.First(&unchanged, "id = ?", "asset-1").Error; err != nil {
		t.Fatal(err)
	}
	if unchanged.FolderID != "" {
		t.Fatalf("foreign asset caused partial move: %#v", unchanged)
	}
}
