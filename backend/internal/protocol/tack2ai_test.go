package protocol

import (
	"context"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTack2AIPackageOpenAIContract(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "tack2ai.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	if pkg.Manifest.Metadata.ID != "tack2ai" || pkg.Manifest.Metadata.Version != "1.0.0" || len(pkg.Manifest.Contributes.Providers) != 4 {
		t.Fatalf("unexpected plugin identity or provider count: %#v", pkg.Manifest.Metadata)
	}
	assertManifestContractMatchesPackage(t, "tack2ai.yingce-plugin", pkg.ManifestRaw, string(pkg.Files["docs/interface.md"]))
	for _, provider := range pkg.Manifest.Contributes.Providers {
		if provider.BaseURL != "https://ai.tack2ai.cn" || provider.Auth.Type != "bearer" || provider.Auth.Field != "apiKey" || provider.IdempotentCreate {
			t.Fatalf("unexpected connection contract for %s", provider.ID)
		}
		for _, operation := range []*ManifestOperation{&provider.Create, provider.Poll, provider.Result, provider.Agent} {
			if operation == nil {
				continue
			}
			for name := range operation.Headers {
				if strings.HasPrefix(strings.ToLower(name), "x-td-") {
					t.Fatalf("%s sends a TD protocol header", provider.ID)
				}
			}
		}
	}
}

func TestTack2AIImageTierDoesNotReplacePixelContract(t *testing.T) {
	adapter := officialPackageAdapter(t, "tack2ai.yingce-plugin", "tack2ai-image")
	for _, tc := range []struct {
		name, size, ratio string
		params            map[string]any
	}{
		{name: "pixels", size: "1536x1024", params: map[string]any{"size": "1536x1024"}},
		{name: "tier", size: "2K", ratio: "16:9", params: map[string]any{"imageResolution": "2K", "aspectRatio": "16:9"}},
	} {
		for _, edit := range []bool{false, true} {
			request := GenerationRequest{Capability: CapabilityImage, Model: "fresh-image/" + tc.name, Prompt: "海边", ImageParameters: tc.params}
			if edit {
				request.Images = []MediaReference{{URL: "https://example.com/ref.png", Kind: "image"}}
			}
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
			if err != nil {
				t.Fatalf("%s edit=%v: %v", tc.name, edit, err)
			}
			body := manifestTestBody(t, spec)
			ratio, hasRatio := body["aspect_ratio"]
			if body["model"] != request.Model || body["size"] != tc.size || hasRatio != (tc.ratio != "") || hasRatio && ratio != tc.ratio {
				t.Fatalf("%s edit=%v: %#v", tc.name, edit, body)
			}
		}
	}
}

func TestTack2AIImageRejectsInvalidOpenPixelDimensions(t *testing.T) {
	adapter := officialPackageAdapter(t, "tack2ai.yingce-plugin", "tack2ai-image")
	for _, size := range []string{"16:9", "2K", "0x512", "-1x512", "12.5x512", "256x512x768"} {
		request := GenerationRequest{Capability: CapabilityImage, Model: "open-pixel-model", Prompt: "海边", AspectRatio: size}
		if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
			t.Errorf("non-pixel input %q was accepted", size)
		}
	}
}

func TestTack2AIVideoOnlyEmitsModeAndRatioWhenProvidedByHost(t *testing.T) {
	adapter := officialPackageAdapter(t, "tack2ai.yingce-plugin", "tack2ai-video")
	request := GenerationRequest{Model: "new-video-model", Prompt: "海边", Duration: 5, AspectRatio: "adaptive"}
	for _, supported := range []bool{false, true} {
		if supported {
			request.Extra = map[string]any{"tack2aiVideoMode": "multi_ref", "tack2aiVideoRatio": "adaptive"}
		}
		spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
		if err != nil {
			t.Fatal(err)
		}
		body := manifestTestBody(t, spec)
		if body["size"] != nil || (supported && (body["mode"] != "multi_ref" || body["aspect_ratio"] != "adaptive")) || (!supported && (body["mode"] != nil || body["aspect_ratio"] != nil)) {
			t.Fatalf("supported=%v: %#v", supported, body)
		}
	}
}

func TestTack2AIAudioOnlyEmitsDeclaredReferenceEncoding(t *testing.T) {
	adapter := officialPackageAdapter(t, "tack2ai.yingce-plugin", "tack2ai-audio")
	for _, tc := range []struct {
		name, field, value string
		images, audios     []MediaReference
	}{
		{name: "plain"},
		{name: "audio-url", field: "audio_url", value: "https://example.com/ref.wav", audios: []MediaReference{{URL: "https://example.com/ref.wav", Kind: "audio"}}},
		{name: "image-data", field: "image_data", value: "QUJD", images: []MediaReference{{DataURL: "data:image/png;base64,QUJD", Kind: "image"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := GenerationRequest{Model: "new-gateway/voice-7", Prompt: "你好", Images: tc.images, Audios: tc.audios}
			if tc.field != "" {
				if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
					t.Fatal("undeclared reference transport was silently accepted")
				}
				request.Extra = map[string]any{"audioReferenceEncoding": "metadata.references"}
			}
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
			if err != nil {
				t.Fatal(err)
			}
			body := manifestTestBody(t, spec)
			if body["model"] != request.Model || body["input"] != request.Prompt || body["voice"] != nil {
				t.Fatalf("audio without explicit voice = %#v", body)
			}
			if tc.field == "" {
				if body["metadata"] != nil {
					t.Fatalf("audio without references = %#v", body)
				}
				return
			}
			metadata, ok := body["metadata"].(map[string]any)
			if !ok {
				t.Fatalf("missing reference metadata: %#v", body)
			}
			references, ok := metadata["references"].([]any)
			if !ok || len(references) != 1 || references[0].(map[string]any)[tc.field] != tc.value {
				t.Fatalf("unexpected reference metadata: %#v", metadata)
			}
		})
	}
}

func TestTack2AIChatRequestAndFailures(t *testing.T) {
	adapter := officialPackageAdapter(t, "tack2ai.yingce-plugin", "tack2ai-chat")
	ctx := context.Background()
	spec, err := adapter.BuildCreate(ctx, RequestContext{Request: GenerationRequest{
		Model: "my-chat-model", Prompt: "你好", Instructions: "中文回复",
		ProviderOptions: map[string]map[string]any{"tack2ai-chat": {"temperature": 0, "stream": false}},
		Extra:           map[string]any{"idempotencyKey": "submission-1", "max_tokens": 64},
	}})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if spec.Path != "/v1/chat/completions" || body["model"] != "my-chat-model" || body["temperature"] != float64(0) || body["stream"] != false || body["max_tokens"] != float64(64) {
		t.Fatalf("chat request = %#v, %#v", spec, body)
	}
	if spec.Headers["Idempotency-Key"] != "submission-1" || len(body["messages"].([]any)) != 2 {
		t.Fatalf("chat messages or idempotency headers missing: %#v", spec)
	}
	for _, tc := range []struct {
		body string
		want Status
	}{
		{`{"choices":[{"message":{"content":"你好"}}]}`, StatusSucceeded},
		{`{"error":{"message":"not allowed"}}`, StatusFailed},
		{`{"choices":[]}`, StatusFailed},
	} {
		result, err := adapter.ParseCreate(ctx, []byte(tc.body))
		if err != nil || result.Status != tc.want {
			t.Fatalf("chat response %s = %#v, %v", tc.body, result, err)
		}
	}
	agent := adapter.(AgentAdapter)
	result, err := agent.ParseAgent(ctx, []byte(`{"choices":[{"message":{"tool_calls":[{"id":"call-1","function":{"name":"lookup","arguments":"{\"q\":\"test\"}"}}]}}]}`))
	if err != nil || len(result.ToolCalls) != 1 || result.ToolCalls[0].Name != "lookup" {
		t.Fatalf("agent result = %#v, %v", result, err)
	}
}

func TestTack2AIImageGenerationEditingAndResponse(t *testing.T) {
	adapter := officialPackageAdapter(t, "tack2ai.yingce-plugin", "tack2ai-image")
	request := GenerationRequest{Model: "image-model", Prompt: "海边", ImageCount: 2, AspectRatio: "1536x1024", Quality: "auto"}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if spec.Path != "/v1/images/generations" || spec.ContentType != "application/json" || body["n"] != float64(2) || body["size"] != "1536x1024" || body["quality"] != nil {
		t.Fatalf("image request = %#v, body = %#v", spec, body)
	}
	for _, count := range []int{1, 2} {
		request.Images = []MediaReference{{URL: "https://example.com/one.png", Kind: "image"}}
		if count == 2 {
			request.Images = append(request.Images, MediaReference{URL: "https://example.com/two.png", Kind: "image"})
		}
		spec, err = adapter.BuildCreate(context.Background(), RequestContext{Request: request})
		if err != nil {
			t.Fatal(err)
		}
		name := "image"
		if count == 2 {
			name = "image[]"
		}
		if spec.Path != "/v1/images/edits" || spec.ContentType != "multipart/form-data" || len(spec.Files) != count || spec.Files[0].Name != name {
			t.Fatalf("edit request = %#v", spec)
		}
	}
	result, err := adapter.ParseCreate(context.Background(), []byte(`{"data":[{"url":"https://example.com/one.png"},{"b64_json":"QUJD","output_format":"jpeg"}]}`))
	if err != nil || result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Images) != 2 || !result.Result.Images[0].Ephemeral || !strings.HasPrefix(result.Result.Images[1].DataURL, "data:image/jpeg;") {
		t.Fatalf("image response = %#v, %v", result, err)
	}
	result, err = adapter.ParseCreate(context.Background(), []byte(`{"data":[]}`))
	if err != nil || result.Status != StatusFailed {
		t.Fatalf("empty image response = %#v, %v", result, err)
	}
}

func TestTack2AIVideoOpenAIEncoding(t *testing.T) {
	adapter := officialPackageAdapter(t, "tack2ai.yingce-plugin", "tack2ai-video")
	base := GenerationRequest{Model: "video-model", Prompt: "海边日落", Duration: 5, AspectRatio: "16:9", Resolution: "720P", Extra: map[string]any{"idempotencyKey": "video-1"}}
	for _, tc := range []struct {
		name       string
		media      []MediaReference
		wantSingle bool
	}{
		{"text", nil, false},
		{"default image", []MediaReference{{URL: "https://example.com/frame.png", Kind: "image"}}, true},
		{"first frame", []MediaReference{{URL: "https://example.com/frame.png", Kind: "image", Role: "first_frame"}}, true},
		{"explicit reference", []MediaReference{{URL: "https://example.com/ref.png", Kind: "image", Role: "reference_image"}}, false},
		{"mixed", []MediaReference{{URL: "https://example.com/img.png", Kind: "image", Role: "last_frame", Order: 3}, {URL: "https://example.com/audio.mp3", Kind: "audio", Order: 1}, {URL: "https://example.com/video.mp4", Kind: "video", Order: 2}}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := base
			request.Inputs = tc.media
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
			if err != nil {
				t.Fatal(err)
			}
			body := manifestTestBody(t, spec)
			if spec.Path != "/v1/videos" || body["seconds"] != "5" || body["size"] != "16:9" || body["resolution_name"] != "720P" || spec.Headers["X-TD-Contract"] != "" {
				t.Fatalf("video request = %#v, body = %#v", spec, body)
			}
			for _, key := range []string{"duration", "input", "parameters", "ratio", "resolution", "mode"} {
				if _, exists := body[key]; exists {
					t.Fatalf("video request includes TD field %s", key)
				}
			}
			if tc.wantSingle {
				if body["input_reference"].(map[string]any)["image_url"] != tc.media[0].URL || body["references"] != nil {
					t.Fatalf("single reference = %#v", body)
				}
			} else if len(tc.media) > 0 {
				refs := body["references"].([]any)
				if len(refs) != len(tc.media) || body["input_reference"] != nil {
					t.Fatalf("references = %#v", body)
				}
				if tc.name == "mixed" && (refs[0].(map[string]any)["role"] != "reference_audio" || refs[1].(map[string]any)["role"] != "reference_video" || refs[2].(map[string]any)["role"] != "last_frame") {
					t.Fatalf("global reference ordering was lost: %#v", refs)
				}
			} else if body["references"] != nil || body["input_reference"] != nil {
				t.Fatalf("text request contains empty references: %#v", body)
			}
		})
	}
	base.AspectRatio = "1280x720"
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: base})
	if err != nil || manifestTestBody(t, spec)["resolution_name"] != nil {
		t.Fatalf("pixel dimensions must not conflict with resolution_name: %#v, %v", spec, err)
	}
	for _, mutate := range []func(*GenerationRequest){
		func(r *GenerationRequest) { r.Duration = -1 },
		func(r *GenerationRequest) { r.Prompt = "" },
		func(r *GenerationRequest) { r.GenerateAudio = true },
		func(r *GenerationRequest) {
			r.Inputs = []MediaReference{{Kind: "image", Role: "mask", URL: "https://example.com/mask.png"}}
		},
		func(r *GenerationRequest) {
			r.ProviderOptions = map[string]map[string]any{"tack2ai-video": {"metadata": map[string]any{"draft": true}}}
		},
	} {
		request := base
		mutate(&request)
		if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
			t.Fatalf("invalid video request was accepted: %#v", request)
		}
	}
}

func TestTack2AIVideoStatesAndAuthenticatedResult(t *testing.T) {
	adapter := officialPackageAdapter(t, "tack2ai.yingce-plugin", "tack2ai-video")
	for _, tc := range []struct {
		status string
		want   Status
	}{
		{"queued", StatusPending}, {"in_progress", StatusProcessing}, {"completed", StatusSucceeded}, {"failed", StatusFailed}, {"cancelled", StatusCancelled}, {"unknown", StatusPending},
	} {
		result, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "task-1"}, []byte(`{"status":"`+tc.status+`","metadata":{"url":"https://example.com/not-public.mp4"}}`))
		if err != nil || result.Status != tc.want || result.TaskID != "task-1" || result.Result != nil {
			t.Fatalf("video state %s = %#v, %v", tc.status, result, err)
		}
	}
	spec, err := adapter.(ResultAdapter).BuildResult(context.Background(), PollContext{TaskID: "task-1"})
	if err != nil || spec.Path != "/v1/videos/task-1/content" || spec.Auth.Type != "bearer" {
		t.Fatalf("result request = %#v, %v", spec, err)
	}
	if _, err := adapter.BuildCancel(context.Background(), PollContext{TaskID: "task-1"}); err == nil {
		t.Fatal("plugin advertised an unsupported generic video cancellation")
	}
}

func TestTack2AIAudioBinaryContract(t *testing.T) {
	adapter := officialPackageAdapter(t, "tack2ai.yingce-plugin", "tack2ai-audio")
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "tts-model", Prompt: "你好", Extra: map[string]any{"audioVoice": "my-voice", "audioFormat": "mp3", "audioSpeed": "1.25"}}})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if spec.Path != "/v1/audio/speech" || body["input"] != "你好" || body["voice"] != "my-voice" || body["response_format"] != "mp3" || body["speed"] != float64(1.25) {
		t.Fatalf("audio request = %#v, body = %#v", spec, body)
	}
	payload := []byte("ID3audio-test-fixture")
	result, err := adapter.ParseCreate(context.Background(), payload)
	if err != nil || result.Result == nil || len(result.Result.Audios) != 1 || !strings.Contains(result.Result.Audios[0].DataURL, base64.StdEncoding.EncodeToString(payload)) {
		t.Fatalf("audio response = %#v, %v", result, err)
	}
	if _, err := adapter.ParseCreate(context.Background(), nil); err == nil {
		t.Fatal("empty audio was accepted")
	}
}
