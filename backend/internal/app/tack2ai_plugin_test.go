package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
	"yingce/backend/internal/protocol"
)

func tack2aiTestRuntime(t *testing.T) *pluginRuntime {
	t.Helper()
	// Exercise upload into a host which has not already bundled this package.
	t.Setenv("CANVAS_OFFICIAL_PLUGIN_DIR", t.TempDir())
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "tack2ai.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	view, err := center.install(data, "tack2ai.yingce-plugin")
	if err != nil {
		t.Fatal(err)
	}
	if view.Manifest.ID != "tack2ai" || view.Source != "uploaded" || view.SHA256 == "" || view.Status != "enabled" {
		t.Fatalf("uploaded package = %#v", view)
	}
	return center
}

func TestTack2AIUploadEnableDisableAndRestore(t *testing.T) {
	center := tack2aiTestRuntime(t)
	svc := &Service{pluginRuntime: center}
	for _, scope := range []protocol.Surface{protocol.SurfaceAdminSystemChannel, protocol.SurfaceUserCustomChannel} {
		catalog := svc.PluginProviderCatalog(string(scope), "", false)
		found := 0
		for _, item := range catalog {
			if strings.HasPrefix(item.ID, "tack2ai-") && item.Enabled {
				found++
			}
		}
		if found != 4 {
			t.Fatalf("scope %s has %d enabled providers, want 4", scope, found)
		}
	}
	if _, err := center.setEnabled("tack2ai", false); err != nil {
		t.Fatal(err)
	}
	if err := svc.validateGenerationInterface("video", "tack2ai-video"); err == nil {
		t.Fatal("disabled plugin remained runnable")
	}
	if _, err := center.setEnabled("tack2ai", true); err != nil {
		t.Fatal(err)
	}
	restored, err := newPluginRuntime(filepath.Dir(center.registryPath))
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"tack2ai-chat", "tack2ai-image", "tack2ai-video", "tack2ai-audio"} {
		adapter, ok := restored.registrySnapshot().Resolve(id)
		if !ok || !adapter.Metadata().Enabled {
			t.Fatalf("provider %s was not restored", id)
		}
	}
	if err := restored.uninstall("tack2ai"); err != nil {
		t.Fatal(err)
	}
	if _, ok := restored.registrySnapshot().Resolve("tack2ai-video"); ok {
		t.Fatal("uninstalled provider remained registered")
	}
}

func TestTack2AIInstalledHTTPGenerationAndVideoResume(t *testing.T) {
	allowLoopbackProviderTest(t)
	center := tack2aiTestRuntime(t)
	ctx := withProtocolRegistry(context.Background(), center.registrySnapshot())
	videoCreates, videoPolls, videoDownloads := 0, 0, 0
	const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDioAAAAASUVORK5CYII="
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-only-key" || r.Header.Get("X-TD-Contract") != "" {
			t.Errorf("unexpected authentication or TD protocol header")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/images/edits" {
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Error(err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			defer r.MultipartForm.RemoveAll()
			if r.FormValue("model") == "http-error" {
				w.WriteHeader(http.StatusBadRequest)
				fmt.Fprint(w, `{"error":{"message":"model is unavailable","code":"model_not_allowed"}}`)
				return
			}
			if len(r.MultipartForm.File["image"]) != 1 || r.FormValue("model") != "image-model" {
				t.Error("image edit lost the real multipart file or model")
			}
			fmt.Fprintf(w, `{"data":[{"b64_json":%q}]}`, png)
			return
		}
		var body map[string]any
		if r.Method == http.MethodPost {
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			if r.Header.Get("Idempotency-Key") == "" {
				t.Error("create request is missing its stable idempotency key")
			}
		}
		if body["model"] == "http-error" {
			w.WriteHeader(http.StatusBadRequest)
			fmt.Fprint(w, `{"error":{"message":"model is unavailable","code":"model_not_allowed"}}`)
			return
		}
		switch r.URL.Path {
		case "/v1/chat/completions":
			if body["stream"] == true {
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\n\ndata: [DONE]\n\n")
				return
			}
			fmt.Fprint(w, `{"choices":[{"message":{"content":"你好"}}]}`)
		case "/v1/images/generations":
			fmt.Fprintf(w, `{"data":[{"b64_json":%q}]}`, png)
		case "/v1/audio/speech":
			if body["input"] != "你好" {
				t.Errorf("unexpected speech request: %#v", body)
			}
			switch body["model"] {
			case "speech-with-json-error":
				fmt.Fprint(w, `{"error":{"message":"not available"}}`)
				return
			case "speech-with-ogg-output":
				if body["response_format"] != "ogg_opus" {
					t.Errorf("missing declared output format: %#v", body)
				}
				w.Header().Set("Content-Type", "audio/ogg")
				fmt.Fprint(w, "OggS\x00mock-opus-fixture")
				return
			case "speech-with-reference":
				meta, _ := body["metadata"].(map[string]any)
				refs, _ := meta["references"].([]any)
				if len(refs) != 1 || refs[0].(map[string]any)["audio_url"] != "https://example.com/ref.mp3" || body["voice"] != nil {
					t.Errorf("unexpected speech reference encoding: %#v", body)
				}
			case "speech-with-declared-voice":
				if body["voice"] != "catalog-speaker" || body["response_format"] != "mp3" || body["metadata"] != nil {
					t.Errorf("unexpected declared speech parameters: %#v", body)
				}
			default:
				if _, sentVoice := body["voice"]; sentVoice {
					t.Errorf("undeclared default voice in request: %#v", body)
				}
			}
			w.Header().Set("Content-Type", "audio/mpeg")
			fmt.Fprint(w, "ID3mock-audio-fixture")
		case "/v1/videos":
			videoCreates++
			if body["seconds"] != "5" || body["input"] != nil || body["parameters"] != nil {
				t.Errorf("video does not use OpenAI encoding: %#v", body)
			}
			fmt.Fprint(w, `{"id":"tack-job","status":"queued"}`)
		case "/v1/videos/tack-job":
			videoPolls++
			fmt.Fprint(w, `{"id":"tack-job","status":"completed","metadata":{"url":"https://example.invalid/do-not-fetch.mp4"}}`)
		case "/v1/videos/tack-job/content":
			videoDownloads++
			w.Header().Set("Content-Type", "video/mp4")
			fmt.Fprint(w, "mock-video-fixture")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	for _, tc := range []struct{ mode, protocolID, model string }{
		{"text", "tack2ai-chat", "chat-model"}, {"image", "tack2ai-image", "image-model"}, {"audio", "tack2ai-audio", "tts-model"},
	} {
		adapter, ok := center.registrySnapshot().Resolve(tc.protocolID)
		if !ok {
			t.Fatal(tc.protocolID)
		}
		input := canvasGenerationInput{Mode: tc.mode, Prompt: "你好", Config: providerConfig{BaseURL: server.URL + "/v1", APIKey: "test-only-key", Model: tc.model, InterfaceType: tc.protocolID}}
		output, err := runProtocolAdapterTaskWithPolicy(ctx, input, adapter, fastVideoPollPolicy())
		if err != nil || output["mode"] != tc.mode {
			t.Fatalf("%s generation = %#v, %v", tc.mode, output, err)
		}
		if tc.mode == "text" {
			input.StreamText = true
			output, err = runProtocolAdapterTaskWithPolicy(ctx, input, adapter, fastVideoPollPolicy())
			if err != nil || output["text"] != "你好" {
				t.Fatalf("streamed text = %#v, %v", output, err)
			}
		}
		if tc.mode == "image" {
			input.ReferenceImages = []providerMedia{{DataURL: "data:image/png;base64," + png}}
			if _, err := runProtocolAdapterTaskWithPolicy(ctx, input, adapter, fastVideoPollPolicy()); err != nil {
				t.Fatalf("image edit: %v", err)
			}
		}
		input.Config.Model = "http-error"
		if _, err := runProtocolAdapterTaskWithPolicy(ctx, input, adapter, fastVideoPollPolicy()); err == nil {
			t.Fatalf("%s HTTP error was hidden", tc.mode)
		}
	}
	for _, tc := range []struct {
		model   string
		audio   AudioCapabilityConfig
		samples []providerMedia
		wantErr bool
	}{
		{model: "speech-with-declared-voice", audio: AudioCapabilityConfig{VoiceDefault: "catalog-speaker", FormatDefault: "mp3"}},
		{model: "speech-with-reference", audio: AudioCapabilityConfig{ReferenceEncoding: "metadata.references", MaxAudios: 1, MaxReferences: 1}, samples: []providerMedia{{URL: "https://example.com/ref.mp3"}}},
		{model: "speech-with-ogg-output", audio: AudioCapabilityConfig{FormatDefault: "ogg_opus"}},
		{model: "speech-with-json-error", wantErr: true},
	} {
		input := canvasGenerationInput{Mode: "audio", Prompt: "你好", ReferenceAudios: tc.samples, Config: providerConfig{
			BaseURL: server.URL, APIKey: "test-only-key", Model: tc.model, InterfaceType: tack2aiAudioProtocol,
			CapabilityConfig: &ModelCapabilityConfig{Version: 1, Audio: &tc.audio},
		}}
		output, err := runAudioTask(ctx, input)
		if tc.wantErr {
			if err == nil {
				t.Fatalf("%s accepted non-audio as a successful result: %#v", tc.model, output)
			}
			continue
		}
		if err != nil || output["mode"] != "audio" {
			t.Fatalf("%s generation = %#v, %v", tc.model, output, err)
		}
		if tc.model == "speech-with-ogg-output" && output["audio"].(map[string]interface{})["mimeType"] != "audio/ogg" {
			t.Fatalf("unexpected Ogg audio output: %#v", output)
		}
	}
	adapter, _ := center.registrySnapshot().Resolve("tack2ai-video")
	input := canvasGenerationInput{Mode: "video", Prompt: "海边日落", Config: providerConfig{BaseURL: server.URL + "/v1", APIKey: "test-only-key", Model: "video-model", InterfaceType: "tack2ai-video", VideoSeconds: "5", Size: "16:9", VQuality: "720P"}}
	_, err := runProtocolAdapterTaskWithPolicy(ctx, input, adapter, fastVideoPollPolicy())
	var pending providerStatePendingError
	if !errors.As(err, &pending) || pending.TaskID != "tack-job" || !pending.Detached || videoCreates != 1 || videoPolls != 0 {
		t.Fatalf("submitted video = %#v, %v; create=%d poll=%d", pending, err, videoCreates, videoPolls)
	}
	// Resume the original upstream ID through the real scheduler-facing path.
	resumeCtx := context.WithValue(ctx, providerAnalyticsKey{}, providerAnalyticsContext{ProviderRequestID: pending.TaskID})
	output, err := runProtocolAdapterTaskWithPolicy(resumeCtx, input, adapter, fastVideoPollPolicy())
	if err != nil || output["mode"] != "video" || videoCreates != 1 || videoPolls != 1 || videoDownloads != 1 {
		t.Fatalf("video resume = %#v, %v; create=%d poll=%d download=%d", output, err, videoCreates, videoPolls, videoDownloads)
	}
}

func TestTack2AIAudioAdmissionUsesDeclaredReferenceLimit(t *testing.T) {
	input := map[string]any{
		"mode": "audio", "prompt": "你好",
		"config": map[string]any{
			"interfaceType": "tack2ai-audio", "model": "catalog-only/tts-feature",
			"audioVoice": "selected-voice",
			"capabilityConfig": map[string]any{
				"version": 1, "audio": map[string]any{
					"referenceEncoding": "metadata.references", "maxImages": 1, "maxReferences": 1,
				},
			},
		},
		"referenceImages": []map[string]any{{"storageKey": "fixture.png"}},
	}
	if err := (&Service{}).ValidateTaskCapability(input); err == nil {
		t.Fatal("speech admission accepted incompatible explicit voice and image reference")
	}
	config := input["config"].(map[string]any)
	delete(config, "audioVoice")
	if err := (&Service{}).ValidateTaskCapability(input); err != nil {
		t.Fatalf("declared image reference rejected: %v", err)
	}
	input["referenceAudios"] = []map[string]any{{"storageKey": "fixture.wav"}}
	if err := (&Service{}).ValidateTaskCapability(input); err == nil {
		t.Fatal("speech admission accepted an undeclared reference kind")
	}
}

func TestTack2AIAdminSpeechTestUsesMatchingSavedDefaults(t *testing.T) {
	allowLoopbackProviderTest(t)
	t.Setenv("REDIS_URL", "")
	svc, db := newChannelModelTestService(t)
	svc.pluginRuntime = tack2aiTestRuntime(t)
	if err := db.AutoMigrate(&model.Asset{}, &model.CanvasProject{}, &model.TaskLog{}, &model.Result{}, &model.TaskTextDelta{}, &model.ApiCallLog{}, &model.ModelPricing{}); err != nil {
		t.Fatal(err)
	}
	coordinator, err := platform.NewCoordinator("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	svc.coordinator = coordinator
	requests := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body["model"] == "catalog-voice/upstream" && (body["voice"] != "declared-speaker" || body["response_format"] != "mp3") {
			t.Errorf("saved defaults did not reach upstream: %#v", body)
		}
		if body["model"] == "different-upstream" && body["voice"] != nil {
			t.Errorf("borrowed another upstream ID's voice: %#v", body)
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		fmt.Fprint(w, "ID3mock-audio-fixture")
	}))
	defer upstream.Close()
	channel := model.ModelChannel{ID: "tack2ai-test-channel", Scope: model.ChannelScopeSystem, Enabled: true, BaseURL: upstream.URL, APIKey: "fixture-key"}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	for _, item := range []model.ChannelModel{
		{ID: "saved-speaker", ChannelID: channel.ID, ModelKey: "saved-speaker", ProviderModelKey: "catalog-voice/upstream", Capability: "audio", Protocol: tack2aiAudioProtocol, CapabilityConfigJSON: `{"version":1,"audio":{"voiceRequired":true,"voiceDefault":"declared-speaker","formatDefault":"mp3"}}`},
		{ID: "requires-speaker", ChannelID: channel.ID, ModelKey: "requires-speaker", ProviderModelKey: "catalog-voice/other", Capability: "audio", Protocol: tack2aiAudioProtocol, CapabilityConfigJSON: `{"version":1,"audio":{"voiceRequired":true}}`},
	} {
		if err := db.Create(&item).Error; err != nil {
			t.Fatal(err)
		}
	}
	actor := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	call := func(key, upstream string) error {
		_, err := svc.TestAdminChannelModel(context.Background(), actor, channel.ID, ChannelModelRequest{ModelKey: key, ProviderModelKey: upstream, Capability: "audio", Protocol: tack2aiAudioProtocol})
		return err
	}
	if err := call("saved-speaker", "catalog-voice/upstream"); err != nil {
		t.Fatal(err)
	}
	if err := call("saved-speaker", "different-upstream"); err != nil {
		t.Fatal(err)
	}
	if err := call("requires-speaker", "catalog-voice/other"); err == nil || !strings.Contains(err.Error(), "默认音色") || requests != 2 {
		t.Fatalf("required unspecified voice must return a local error without contacting upstream: requests=%d, err=%v", requests, err)
	}
}
