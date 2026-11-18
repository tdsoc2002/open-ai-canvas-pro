package app

import (
	"encoding/json"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestWorkbenchMediaDeliveryIsVisibleInLibrary(t *testing.T) {
	for _, test := range []struct {
		name          string
		mode          string
		workbenchKind string
		wantSaved     bool
	}{
		{name: "canvas-image", mode: "image"},
		{name: "workbench-image", mode: "image", workbenchKind: model.WorkbenchKindImage, wantSaved: true},
		{name: "workbench-video", mode: "video", workbenchKind: model.WorkbenchKindVideo, wantSaved: true},
		{name: "audio", mode: "audio"},
		{name: "mismatched-kind", mode: "video", workbenchKind: model.WorkbenchKindImage},
	} {
		t.Run(test.name, func(t *testing.T) {
			s, db := newMediaRecoveryTestService(t)
			task := seedMediaTask(t, db, providerConfig{})
			task.Type, task.WorkbenchKind = "canvas_"+test.mode, test.workbenchKind
			if err := db.Save(task).Error; err != nil {
				t.Fatal(err)
			}
			resource := model.Resource{ID: newID(), UserID: task.UserID, Kind: test.mode, Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "generated", MimeType: "application/octet-stream", Size: 80, UploadKey: mediaUploadKey(task.ID, 0)}
			if err := db.Create(&resource).Error; err != nil {
				t.Fatal(err)
			}
			checkpoint := &mediaCheckpoint{Mode: test.mode, StartedAt: time.Now(), Items: []mediaCheckpointItem{{ResourceID: resource.ID, MIMEType: resource.MimeType}}}
			if err := s.saveMediaCheckpoint(task, checkpoint, "register"); err != nil {
				t.Fatal(err)
			}
			if err := s.registerRecoveredMediaAssets(*task); err != nil {
				t.Fatal(err)
			}
			asset, err := s.repo.AssetForUser(task.UserID, generationMediaAssetID(task.ID, 0))
			if err != nil {
				t.Fatal(err)
			}
			var payload struct {
				Metadata struct {
					LibrarySaved *bool `json:"librarySaved"`
				} `json:"metadata"`
			}
			if err := json.Unmarshal([]byte(asset.PayloadJSON), &payload); err != nil {
				t.Fatal(err)
			}
			if payload.Metadata.LibrarySaved == nil || *payload.Metadata.LibrarySaved != test.wantSaved {
				t.Fatalf("librarySaved missing or wrong in %s, want %v", asset.PayloadJSON, test.wantSaved)
			}
			_, total, err := s.repo.UserAssetsPage(task.UserID, 1, 20, repository.UserAssetPageFilter{Status: "active"})
			wantTotal := int64(0)
			if test.wantSaved {
				wantTotal = 1
			}
			if err != nil || total != wantTotal {
				t.Fatalf("library total=%d, want %d; err=%v", total, wantTotal, err)
			}
		})
	}
}
