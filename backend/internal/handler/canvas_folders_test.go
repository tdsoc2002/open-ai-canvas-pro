package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/service"
)

func TestCanvasFoldersHTTPMoveAndDelete(t *testing.T) {
	router, db := newCanvasOperationsHTTPTest(t)
	call := func(method, path, body string, want int, data any) {
		t.Helper()
		rec := profileRequest(router, method, "/api"+path, body, "session.test-token")
		if rec.Code != want {
			t.Fatalf("%s %s: got status %d, want %d: %s", method, path, rec.Code, want, rec.Body.String())
		}
		var result struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil || (result.Code == 0) != (want == http.StatusOK) {
			t.Fatalf("unexpected response: %s (%v)", rec.Body.String(), err)
		}
		if data != nil {
			if err := json.Unmarshal(result.Data, data); err != nil {
				t.Fatal(err)
			}
		}
	}
	for _, id := range []string{"first", "second"} {
		call("PATCH", "/canvas-projects/"+id+"/operations", fmt.Sprintf(`{"mutationId":"create-%s","operations":[{"type":"create_canvas","id":%q,"patch":{"title":%q}}]}`, id, id, id), 200, nil)
	}
	for _, row := range []any{
		&model.CanvasProject{ID: "foreign", UserID: "other", PayloadJSON: `{"nodes":[]}`},
		&model.CanvasFolder{ID: "foreign-folder", UserID: "other", Name: "外部目录"},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	var created struct{ Folder model.CanvasFolder }
	call("POST", "/canvas-folders", `{"name":" "}`, 400, nil)
	call("POST", "/canvas-folders", `{"name":" 分镜 "}`, 200, &created)
	if created.Folder.ID == "" || created.Folder.Name != "分镜" {
		t.Fatalf("unexpected folder: %+v", created.Folder)
	}
	call("PATCH", "/canvas-folders/"+created.Folder.ID, `{"name":"预演"}`, 200, nil)
	var folders struct{ Folders []model.CanvasFolder }
	call("GET", "/canvas-folders", "", 200, &folders)
	if len(folders.Folders) != 1 || folders.Folders[0].Name != "预演" {
		t.Fatalf("unexpected folder list: %+v", folders.Folders)
	}

	rootPath := "/canvas-projects?page=1&folderId=root"
	folderPath := "/canvas-projects?page=1&folderId=" + created.Folder.ID
	assertTotal := func(path string, total int64) service.CanvasLibraryPage {
		t.Helper()
		var page service.CanvasLibraryPage
		call("GET", path, "", 200, &page)
		if page.Total != total {
			t.Fatalf("%s: got %d canvases, want %d", path, page.Total, total)
		}
		return page
	}
	call("POST", "/canvas-folders/move", `{"canvasIds":["first"]}`, 400, nil)
	call("POST", "/canvas-folders/move", `{"folderId":"foreign-folder","canvasIds":["first"]}`, 404, nil)
	call("DELETE", "/canvas-folders/foreign-folder", "", 404, nil)
	call("POST", "/canvas-folders/move", fmt.Sprintf(`{"folderId":%q,"canvasIds":["first","foreign"]}`, created.Folder.ID), 404, nil)
	assertTotal(rootPath, 2)
	assertTotal(folderPath, 0)
	move := fmt.Sprintf(`{"folderId":%q,"canvasIds":["first","second","second"]}`, created.Folder.ID)
	call("POST", "/canvas-folders/move", move, 200, nil)
	call("POST", "/canvas-folders/move", move, 200, nil)
	assertTotal(rootPath, 0)
	page := assertTotal(folderPath+"&pageSize=1", 2)
	if !page.HasMore || len(page.Projects) != 1 || page.Projects[0].FolderID != created.Folder.ID || page.Projects[0].Revision != 1 {
		t.Fatalf("unexpected folder pagination: %+v", page)
	}
	call("PATCH", "/canvas-projects/first/operations", `{"mutationId":"rename-first","operations":[{"type":"set_field","field":"title","value":"first-edited","beforeValue":"first"}]}`, 200, nil)
	assertTotal(folderPath+"&q=first-edited", 1)
	assertTotal("/canvas-projects?page=1&q=first-edited", 1)
	call("POST", "/canvas-folders/move", `{"folderId":"","canvasIds":["second"]}`, 200, nil)
	assertTotal(folderPath, 1)
	assertTotal(rootPath, 1)
	call("DELETE", "/canvas-folders/"+created.Folder.ID, "", 200, nil)
	assertTotal(folderPath, 0)
	assertTotal(rootPath, 2)
	call("GET", "/canvas-projects/first", "", 200, nil)
}
