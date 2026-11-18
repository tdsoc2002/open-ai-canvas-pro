package repository

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
)

func TestAssetPayloadUpdatesKeepExplicitLibrarySave(t *testing.T) {
	repo, db := newAssetLibraryTestRepository(t)
	if err := db.AutoMigrate(&model.Project{}, &model.ProjectAssetLink{}, &model.AssetVersion{}, &model.AssetRepresentation{}, &model.Resource{}); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name     string
		category model.AssetCategory
		apply    func(*model.Asset) error
	}{
		{"ordinary upsert", model.AssetCategoryEnvironment, repo.UpsertAsset},
		{"project image", model.AssetCategoryEnvironment, func(next *model.Asset) error {
			applied, err := repo.CommitProjectAssetImage("project", "old-project image", next,
				&model.AssetVersion{ID: next.PrimaryVersionID, AssetID: next.ID, Version: 2},
				&model.AssetRepresentation{ID: "image-representation", TaskID: "image-task", AssetVersionID: next.PrimaryVersionID, ResourceID: "new-resource", MediaType: "image", Role: "primary"})
			if err == nil && !applied {
				return ErrProjectAssetVersionChanged
			}
			return err
		}},
		{"project character", model.AssetCategoryCharacter, func(next *model.Asset) error {
			return repo.SaveCharacterVersion("project", next,
				&model.AssetVersion{ID: next.PrimaryVersionID, AssetID: next.ID, Version: 2}, nil, nil)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := model.Asset{
				ID: tc.name, UserID: "owner", Kind: "image", Category: tc.category,
				Status: model.AssetVersionStatusConfirmed, PrimaryVersionID: "old-" + tc.name,
				Title: "旧素材", PayloadJSON: `{"data":{"storageKey":"resource:old-resource"},"metadata":{"librarySaved":false}}`,
			}
			if err := db.Create(&before).Error; err != nil {
				t.Fatal(err)
			}
			if tc.name == "project image" {
				for _, row := range []any{
					&model.Project{ID: "project", UserID: before.UserID},
					&model.ProjectAssetLink{ID: "project-link", ProjectID: "project", AssetID: before.ID},
					&model.Resource{ID: "new-resource", UserID: before.UserID, Kind: "image", Status: model.ResourceStatusReady},
				} {
					if err := db.Create(row).Error; err != nil {
						t.Fatal(err)
					}
				}
			}
			// 写入方先构造旧快照。用户先入库，旧快照随后才提交。
			next := before
			next.PrimaryVersionID = "new-" + tc.name
			next.PayloadJSON = `{"data":{"storageKey":"resource:new-resource","counter":9007199254740993},"metadata":{"librarySaved":false,"prompt":"新提示"}}`
			if tc.category == model.AssetCategoryCharacter {
				next.PayloadJSON = `{"data":{"storageKey":"resource:new-resource","counter":9007199254740993}}`
			}
			if _, err := repo.CompareAndSetAssetLibraryState(before, `{"data":{"storageKey":"resource:old-resource"},"metadata":{"librarySaved":true}}`, before.Status); err != nil {
				t.Fatal(err)
			}
			if err := tc.apply(&next); err != nil {
				t.Fatal(err)
			}
			asset, err := repo.AssetForUser(before.UserID, before.ID)
			if err != nil {
				t.Fatal(err)
			}
			var payload struct {
				Data struct {
					StorageKey string
					Counter    json.Number
				}
				Metadata struct {
					LibrarySaved bool
					Prompt       string
				}
			}
			if err := json.Unmarshal([]byte(asset.PayloadJSON), &payload); err != nil {
				t.Fatal(err)
			}
			if !payload.Metadata.LibrarySaved || payload.Data.StorageKey != "resource:new-resource" || payload.Data.Counter.String() != "9007199254740993" || asset.PrimaryVersionID != next.PrimaryVersionID {
				t.Fatalf("stale write must retain explicit save without blocking new data: %+v", asset)
			}
			if tc.category != model.AssetCategoryCharacter && payload.Metadata.Prompt != "新提示" {
				t.Fatalf("incoming metadata lost: %s", asset.PayloadJSON)
			}
		})
	}
}
