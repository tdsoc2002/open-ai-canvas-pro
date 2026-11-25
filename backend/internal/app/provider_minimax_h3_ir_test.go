package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
)

func TestMinimaxH3IRBeforeVideoCreate(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, tc := range []struct {
		name    string
		enabled bool
		status  string
		paths   []string
	}{
		{"disabled", false, "", []string{"/v2/video_generation"}},
		{"enhanced", true, "succeeded", []string{"/v2/h3_context_ir", "/v2/query/video_generation/ir-1", "/v2/video_generation"}},
		{"failed", true, "failed", []string{"/v2/h3_context_ir", "/v2/query/video_generation/ir-1"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			paths := []string{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				paths = append(paths, r.URL.Path)
				w.Header().Set("Content-Type", "application/json")
				if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
					t.Errorf("wrong authentication on %s: %q", r.URL.Path, got)
				}
				switch r.URL.Path {
				case "/v2/query/video_generation/ir-1":
					_, _ = w.Write([]byte(`{"task":{"id":"ir-1","task_type":"h3_context_ir","status":"` + tc.status + `","content":{"prompt":"enhanced prompt"}}}`))
				case "/v2/h3_context_ir", "/v2/video_generation":
					var payload struct {
						Model    string `json:"model"`
						Duration int    `json:"duration"`
						Content  []struct {
							Text string `json:"text"`
							Role string `json:"role"`
						} `json:"content"`
					}
					if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.Duration != 5 || payload.Model != "MiniMax-H3" || len(payload.Content) != 2 || payload.Content[1].Role != "first_frame" {
						t.Errorf("bad request at %s: %#v, error = %v", r.URL.Path, payload, err)
						w.WriteHeader(http.StatusBadRequest)
						return
					}
					wantPrompt := "original prompt"
					if tc.enabled && r.URL.Path == "/v2/video_generation" {
						wantPrompt = "enhanced prompt"
					}
					if got := payload.Content[0].Text; got != wantPrompt {
						t.Errorf("prompt at %s = %q, want %q", r.URL.Path, got, wantPrompt)
					}
					if r.URL.Path == "/v2/h3_context_ir" {
						_, _ = w.Write([]byte(`{"task_id":"ir-1"}`))
						return
					}
					// Stop at the actual video submission to keep this test independent of media storage.
					w.WriteHeader(http.StatusUnauthorized)
				default:
					t.Errorf("unexpected call: %s", r.URL.Path)
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer server.Close()
			_, err := runVideoTaskForTest(context.Background(), canvasGenerationInput{
				Mode: "video", Prompt: "original prompt",
				Config:          providerConfig{BaseURL: server.URL, APIKey: "test-key", InterfaceType: "minimax-video", Model: "MiniMax-H3", VideoSeconds: "5", VQuality: "768P", minimaxH3IR: tc.enabled},
				ReferenceImages: []providerMedia{{URL: "https://cdn.example/image.png", Role: "first_frame"}},
			})
			if err == nil || !slices.Equal(paths, tc.paths) {
				t.Fatalf("calls = %v, want %v; error = %v", paths, tc.paths, err)
			}
			if tc.enabled && !isRouteDispatchUncertain(err) {
				t.Fatalf("accepted IR must prevent automatic route switching: %v", err)
			}
		})
	}
}
