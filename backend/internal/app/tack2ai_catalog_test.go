package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

const tack2aiNewModels = `{"object":"list","contract_version":"1","data":[
  {"id":"models/Brand New Image","supported_endpoint_types":["image-generation"],"x_td":{"modalities":["image"],"capability_revision":"image-r1","parameters":{"size":{"semantic_id":"image.size.dimensions","values":["1024x1024","1024x1536","auto"],"default":"1024x1024"},"quality":{"values":["low","high"],"required":true},"n":{"min":1,"max":2}},"inputs":{"images":{"max":3}},"result":{"resource":"image"}}},
  {"id":"future-tier-image","supported_endpoint_types":["image-generation"],"x_td":{"modalities":["image"],"parameters":{"size":{"semantic_id":"image.size.tier_with_ratio","values":["1K","2K"],"default":"2K"},"aspect_ratio":{"values":["16:9","9:16"]}},"result":{"resource":"image"}}},
  {"id":"future-movie","supported_endpoint_types":["openai-video"],"x_td":{"modalities":["video"],"inputs":{"images":{"max":10},"videos":{"max":2},"audios":{"max":1}},"parameters":{"duration":{"min":4,"max":8,"default":5},"resolution":{"values":["480P","720P"]},"ratio":{"values":["16:9","9:16"]},"mode":{"values":["text_to_video","first_last_frame","multi_ref"]},"input":{"properties":{"media":{"items":{"required":["type","url"]}}}}},"result":{"resource":"video","content_endpoint":"/v1/videos/{id}/content"}}},
  {"id":"future-speech","supported_endpoint_types":["openai"],"x_td":{"modalities":["audio"],"operations":["speech"],"inputs":{"audios":{"max":2}},"parameters":{"input":{"max_length":2048},"voice":{"values":["speaker-x"]},"response_format":{"values":["wav"]}},"reference_media":{"maxTotalItems":2},"result":{"resource":"audio"}}},
  {"id":"future-chat","supported_endpoint_types":["openai"],"x_td":{"modalities":["chat"],"operations":["chat"],"parameters":{"max_tokens":{"max":8192}},"result":{"resource":"json"}}},
  {"id":"not-speech","supported_endpoint_types":["openai"],"x_td":{"modalities":["audio"],"operations":["transcription"],"result":{"resource":"json"}}},
  {"id":"needs-dynamic-parameters","supported_endpoint_types":["openai-video"],"x_td":{"modalities":["video"],"parameters":{"parameters":{"required":true,"properties":{"id":{"required":true}}}}}}
]}`

func TestTack2AICatalogTargetIsLimitedToOfficialOpenAIOrigin(t *testing.T) {
	for _, base := range []string{"https://ai.tack2ai.cn", "https://AI.TACK2AI.CN:443/v1/"} {
		if got := tack2aiCatalogTarget(base, "openai"); got != "https://ai.tack2ai.cn/v1/catalog/models" {
			t.Errorf("target for %q = %q", base, got)
		}
	}
	for _, base := range []string{"https://ai.tack2ai.cn.attacker.example", "http://ai.tack2ai.cn", "https://ai.tack2ai.cn:8443", "https://ai.tack2ai.cn/v1?key=no", "https://user@ai.tack2ai.cn", "https://ai.tack2ai.cn/proxy"} {
		if got := tack2aiCatalogTarget(base, "openai"); got != "" {
			t.Errorf("unexpected target for %q: %q", base, got)
		}
	}
	if tack2aiCatalogTarget("https://ai.tack2ai.cn", "gemini") != "" {
		t.Fatal("Gemini channel selected source-specific catalog")
	}
}

func TestTack2AICatalogImageProfilesBuildTheDeclaredWireShape(t *testing.T) {
	svc := &Service{pluginRuntime: tack2aiTestRuntime(t)}
	var payload struct{ Data []tack2aiCatalogModel }
	if err := json.Unmarshal([]byte(tack2aiNewModels), &payload); err != nil {
		t.Fatal(err)
	}
	catalog := svc.parseTack2AICatalog("image-channel", payload.Data)
	adapter, ok := svc.protocolRegistry().Resolve("tack2ai-image")
	if !ok {
		t.Fatal("plugin adapter did not load")
	}
	for _, tt := range []struct {
		id, size, ratio string
	}{
		{"models/Brand New Image", "1024x1024", ""},
		{"future-tier-image", "2K", "16:9"},
	} {
		draft := catalog.drafts[tt.id]
		cfg, err := DecodeModelCapabilityConfig(draft.config)
		if err != nil || cfg == nil {
			t.Fatalf("%s profile = %v, %v / %s", tt.id, cfg, err, draft.info.UnavailableReason)
		}
		input := canvasGenerationInput{Mode: "image", Prompt: "海边", Config: providerConfig{Model: tt.id, InterfaceType: "tack2ai-image"}}
		if err := applyImageParameterValues(&input.Config, cfg.Image); err != nil {
			t.Fatal(err)
		}
		spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: protocolRequestFromInput(input)})
		if err != nil {
			t.Fatal(err)
		}
		body, ok := spec.Body.(map[string]any)
		if !ok {
			t.Fatalf("unexpected wire body type %T", spec.Body)
		}
		ratio, _ := body["aspect_ratio"].(string)
		if body["model"] != tt.id || body["size"] != tt.size || ratio != tt.ratio {
			t.Fatalf("%s wire shape = %v", tt.id, body)
		}
	}
}

func TestTack2AICatalogRejectsCollidingIDs(t *testing.T) {
	svc := &Service{pluginRuntime: tack2aiTestRuntime(t)}
	var payload struct{ Data []tack2aiCatalogModel }
	if err := json.Unmarshal([]byte(tack2aiNewModels), &payload); err != nil {
		t.Fatal(err)
	}
	duplicate := payload.Data[0]
	duplicate.ID = "brand new image"
	catalog := svc.parseTack2AICatalog("channel", append(payload.Data, duplicate))
	for _, id := range []string{payload.Data[0].ID, duplicate.ID} {
		info := catalog.drafts[id].info
		if info.Fingerprint != "" || info.UnavailableReason == "" {
			t.Fatalf("ambiguous ID %q is importable: %#v", id, info)
		}
	}
}

func TestTack2AICatalogOpenPixelsPassHostValidation(t *testing.T) {
	svc := &Service{pluginRuntime: tack2aiTestRuntime(t)}
	var item tack2aiCatalogModel
	raw := `{"id":"open-pixels","supported_endpoint_types":["image-generation"],"x_td":{"modalities":["image"],"parameters":{"size":{"semantic_id":"image.size.dimensions"}}}}`
	if err := json.Unmarshal([]byte(raw), &item); err != nil {
		t.Fatal(err)
	}
	draft := svc.parseTack2AICatalog("channel", []tack2aiCatalogModel{item}).drafts[item.ID]
	cfg, err := DecodeModelCapabilityConfig(draft.config)
	if err != nil || cfg == nil || !cfg.Image.Size.AllowCustom {
		t.Fatalf("profile = %#v %v %s", cfg, err, draft.info.UnavailableReason)
	}
	if err := imageSizePresetReadyError(cfg.Image, draft.info.Protocol); err != nil {
		t.Fatal(err)
	}
	for _, size := range []string{"1024x1024", "1:1", "bad"} {
		input := providerConfig{InterfaceType: draft.info.Protocol, Size: size}
		if err := applyImageParameterValues(&input, cfg.Image); (err == nil) != (size == "1024x1024") {
			t.Fatalf("size %s: %v", size, err)
		}
	}
}

func TestTack2AICatalogChecksVideoModesBeforeCreate(t *testing.T) {
	svc := &Service{pluginRuntime: tack2aiTestRuntime(t)}
	var item tack2aiCatalogModel
	raw := `{"id":"condition-video","supported_endpoint_types":["openai-video"],"x_td":{"modalities":["video"],"inputs":{"images":{"max":3},"videos":{"max":3}},"parameters":{"duration":{"min":4,"max":15},"ratio":{"values":["16:9","adaptive"]},"mode":{"values":["text_to_video","image_to_video","first_last_frame","multi_ref"],"media_constraints":{"image_to_video":{"required_types":["first_frame"],"allowed_types":["first_frame"]},"multi_ref":{"forbidden_types":["first_frame","last_frame"]}}}},"parameter_conditions":[{"when":{"parameter":"mode","equals":"multi_ref"},"parameters":{"duration":{"max":10}}},{"when":{"parameter":"mode","in":["image_to_video","first_last_frame"]},"parameters":{"ratio":{"values":["adaptive"]}}}]}}`
	if err := json.Unmarshal([]byte(raw), &item); err != nil {
		t.Fatal(err)
	}
	draft := svc.parseTack2AICatalog("channel", []tack2aiCatalogModel{item}).drafts[item.ID]
	cfg, err := DecodeModelCapabilityConfig(draft.config)
	if err != nil || cfg == nil {
		t.Fatalf("profile = %#v %v %s", cfg, err, draft.info.UnavailableReason)
	}
	input := canvasGenerationInput{Mode: "video", Prompt: "山", Config: providerConfig{Model: item.ID, InterfaceType: "tack2ai-video", VideoSeconds: "11", Size: "16:9"},
		Metadata: map[string]any{"videoEditOperation": "reference_to_video"}, ReferenceVideos: []providerMedia{{URL: "https://example.com/reference.mp4"}}, VideoCapability: cfg.Video}
	if err := validateVideoTask(cfg.Video, input); err == nil {
		t.Fatal("conditional multi-reference duration was not enforced")
	}
	input.Config.VideoSeconds = "10"
	if err := validateVideoTask(cfg.Video, input); err != nil {
		t.Fatal(err)
	}
	input.Metadata["videoEditOperation"] = "image_to_video"
	input.ReferenceVideos = nil
	input.ReferenceImages = []providerMedia{{URL: "https://example.com/reference.png", Role: "first_frame"}}
	if err := validateVideoTask(cfg.Video, input); err == nil {
		t.Fatal("conditional image-to-video ratio was not enforced")
	}
	input.Config.Size = "adaptive"
	if err := validateVideoTask(cfg.Video, input); err != nil {
		t.Fatal(err)
	}
	adapter, ok := svc.protocolRegistry().Resolve("tack2ai-video")
	if !ok {
		t.Fatal("plugin adapter did not load")
	}
	spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: protocolRequestFromInput(input)})
	if err != nil {
		t.Fatal(err)
	}
	body := spec.Body.(map[string]any)
	if body["mode"] != "image_to_video" || body["aspect_ratio"] != "adaptive" || body["size"] != nil || body["input_reference"] == nil {
		t.Fatalf("mismatched gateway mode or ratio: %v", body)
	}
	input.VideoCapability.Tack2AI.Media["image_to_video"] = Tack2AIVideoMediaLimit{Allowed: []string{"reference_image"}, Required: []string{"reference_image"}}
	if err := validateVideoTask(cfg.Video, input); err != nil {
		t.Fatal(err)
	}
	spec, err = adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: protocolRequestFromInput(input)})
	if err != nil {
		t.Fatal(err)
	}
	body = spec.Body.(map[string]any)
	if body["input_reference"] != nil || body["references"] == nil {
		t.Fatalf("single-image reference role did not reach wire: %v", body)
	}
	input.Metadata["videoEditOperation"] = "reference_to_video"
	input.ReferenceVideos = []providerMedia{{URL: "https://example.com/reference.mp4"}}
	if err := validateVideoTask(cfg.Video, input); err == nil {
		t.Fatal("forbidden first frame was accepted in multi-reference mode")
	}
}

func TestTack2AICatalogUsesDeclaredSpeechReferenceLimits(t *testing.T) {
	svc := &Service{pluginRuntime: tack2aiTestRuntime(t)}
	var item tack2aiCatalogModel
	raw := `{"id":"reference-speech","supported_endpoint_types":["audio-speech"],"x_td":{"modalities":["audio"],"operations":["speech"],"inputs":{"audios":{"max":3},"images":{"max":1}},"result":{"resource":"audio"},"parameters":{"input":{"required":true,"max_length":2048},"metadata":{"properties":{"references":{"audio_image_mutually_exclusive":true,"items":{"properties":{"audio_url":{},"audio_data":{},"image_url":{},"image_data":{}}}}}}}}}`
	if err := json.Unmarshal([]byte(raw), &item); err != nil {
		t.Fatal(err)
	}
	draft := svc.parseTack2AICatalog("channel", []tack2aiCatalogModel{item}).drafts[item.ID]
	cfg, err := DecodeModelCapabilityConfig(draft.config)
	if err != nil || cfg == nil || cfg.Audio == nil {
		t.Fatalf("profile = %#v %v %s", cfg, err, draft.info.UnavailableReason)
	}
	if cfg.Audio.ReferenceEncoding != "metadata.references" || cfg.Audio.MaxAudios != 3 || cfg.Audio.MaxImages != 1 || cfg.Audio.MaxReferences != 3 || cfg.Audio.VoiceDefault != "" {
		t.Fatalf("bad speech profile: %#v", cfg.Audio)
	}
}

func TestTack2AICatalogSpeechProfileSurvivesPriceEdit(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	svc.pluginRuntime = tack2aiTestRuntime(t)
	admin := &model.User{ID: "catalog-admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "speech-channel", UserID: admin.ID, Scope: model.ChannelScopeSystem, BaseURL: "https://ai.tack2ai.cn", APIFormat: "openai"}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	modelRow := model.ChannelModel{ID: "speech-item", ChannelID: channel.ID, ModelKey: "Speech",
		ProviderModelKey: "models/Speech", Capability: "audio", Protocol: "tack2ai-audio",
		CapabilityConfigJSON: `{"version":1,"audio":{"voiceDefault":"voice-x","formatDefault":"wav"}}`}
	if err := db.Create(&modelRow).Error; err != nil {
		t.Fatal(err)
	}
	got, err := svc.SaveAdminChannelModel(admin, channel.ID, modelRow.ID, ChannelModelRequest{
		ExpectedUpdatedAt: modelRow.UpdatedAt, ExpectedPriceVersion: modelRow.PriceVersion,
		ModelKey: modelRow.ModelKey, ProviderModelKey: modelRow.ProviderModelKey,
		Capability: "audio", Protocol: "tack2ai-audio", BillingMode: "fixed_request",
		PriceConfigured: true, UnitPriceMicrocredits: 500,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.CapabilityConfigJSON != modelRow.CapabilityConfigJSON || got.ProviderModelKey != modelRow.ProviderModelKey || len(got.PriceTiers) != 1 ||
		got.PriceTiers[0].ProviderModelKey != modelRow.ProviderModelKey || got.Enabled {
		t.Fatalf("price edit modified capabilities, ID or activation: %#v", got)
	}
}

func TestTack2AICatalogImportsValidatedModelsWithoutOverwriting(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	svc.pluginRuntime = tack2aiTestRuntime(t)
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	body, status := tack2aiNewModels, http.StatusOK
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v1/catalog/models" || r.Header.Get("Authorization") != "Bearer test-only-key" {
			t.Errorf("unexpected metadata request: %s %s", r.Method, r.URL.Path)
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	defer upstream.Close()
	channel := model.ModelChannel{ID: "catalog-channel", Scope: model.ChannelScopeSystem, BaseURL: "https://ai.tack2ai.cn", APIKey: "test-only-key"}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	fetch := func() (*adminModelCatalog, error) {
		return svc.fetchTack2AICatalog(context.Background(), &channel, upstream.URL+"/v1/catalog/models")
	}
	catalog, err := fetch()
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.models) != 7 {
		t.Fatalf("expected all 7 entries in preview, got %v", catalog.models)
	}
	for id, protocol := range map[string]string{
		"models/Brand New Image": "tack2ai-image", "future-tier-image": "tack2ai-image", "future-movie": "tack2ai-video",
		"future-speech": "tack2ai-audio", "future-chat": "tack2ai-chat",
	} {
		draft := catalog.drafts[id]
		if draft.info.Protocol != protocol || draft.info.Fingerprint == "" || draft.info.UnavailableReason != "" {
			t.Errorf("draft %q = %#v", id, draft.info)
		}
	}
	for _, id := range []string{"not-speech", "needs-dynamic-parameters"} {
		if catalog.drafts[id].info.UnavailableReason == "" {
			t.Errorf("%s was not blocked", id)
		}
	}
	text, err := DecodeModelCapabilityConfig(catalog.drafts["future-chat"].config)
	if err != nil || text == nil || text.Text.MaxOutputTokens != 8192 {
		t.Fatalf("chat budget lost: %#v, %v", text, err)
	}
	var count int64
	if err := db.Model(&model.ChannelModel{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("read-only catalog preview wrote to database: %d, %v", count, err)
	}

	ids := []string{"models/Brand New Image", "future-movie", "future-speech"}
	fingerprints := map[string]string{}
	for _, id := range ids {
		fingerprints[id] = catalog.drafts[id].info.Fingerprint
	}
	if _, err := svc.importAdminChannelModelSelection(&channel, catalog, ids, nil); err == nil {
		t.Fatal("official catalog selection accepted without fingerprints")
	}
	body = strings.Replace(tack2aiNewModels, "image-r1", "image-r2", 1)
	changed, err := fetch()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.importAdminChannelModelSelection(&channel, changed, ids, fingerprints); err == nil {
		t.Fatal("stale preview was accepted")
	}
	result, err := svc.importAdminChannelModelSelection(&channel, catalog, ids, fingerprints)
	if err != nil || result.Added != 3 {
		t.Fatalf("import = %#v, %v", result, err)
	}
	var first model.ChannelModel
	if err := db.First(&first, "provider_model_key = ?", ids[0]).Error; err != nil {
		t.Fatal(err)
	}
	if first.Enabled || first.PriceConfigured || first.UnitPriceMicrocredits != 0 || first.Protocol != "tack2ai-image" ||
		first.ModelKey != "Brand New Image" || first.ProviderModelKey != ids[0] || first.CapabilityConfigJSON == "" {
		t.Fatalf("bad imported defaults: %#v", first)
	}
	if err := db.Model(&first).Updates(map[string]any{"enabled": true, "price_configured": true, "unit_price_microcredits": 73}).Error; err != nil {
		t.Fatal(err)
	}
	result, err = svc.importAdminChannelModelSelection(&channel, changed, ids[:1], fingerprints)
	if err != nil || result.Added != 0 {
		t.Fatalf("existing row should be skipped, result = %#v, %v", result, err)
	}
	var still model.ChannelModel
	if err := db.First(&still, "id = ?", first.ID).Error; err != nil || !still.Enabled || !still.PriceConfigured || still.UnitPriceMicrocredits != 73 || still.CapabilityConfigJSON != first.CapabilityConfigJSON {
		t.Fatalf("existing row was changed: %#v, %v", still, err)
	}
	status = http.StatusUnauthorized
	_, err = fetch()
	var failure *AuthError
	if err == nil || !errors.As(err, &failure) {
		t.Fatalf("failed authentication was not propagated: %v", err)
	}
}
