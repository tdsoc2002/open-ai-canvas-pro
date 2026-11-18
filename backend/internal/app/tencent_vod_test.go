package app

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound/outboundtest"
	"yingce/backend/internal/protocol"
)

func TestTencentVODPrepareDirectRequest(t *testing.T) {
	outboundtest.PublicDNS(t, "media.example.com")
	cfg := providerConfig{ChannelID: "configured-channel", BaseURL: tencentVODBaseURL, tencentVODAppID: 123456789, Headers: []OutboundHeader{{Name: "X-TC-Action", Value: "invalid"}}}
	req := protocol.GenerationRequest{Model: "tencent-seedance-2-5-260628", Prompt: "测试", Operation: "image_to_video", Images: []protocol.MediaReference{{URL: "https://media.example.com/ref.png", Role: "first_frame"}}, Resolution: "720p", Duration: 5}
	if err := prepareTencentVODRequest(&cfg, &req); err != nil {
		t.Fatal(err)
	}
	got, ok := req.Extra["tencentVod"].(tencentVODRequest)
	if !ok || got.SubAppID != 123456789 || got.ModelVersion != "2.5" || got.Output.Resolution != "720P" || got.Output.AspectRatio != "adaptive" || len(got.Files) != 1 || got.Files[0].Usage != "FirstFrame" || len(cfg.Headers) != 0 {
		t.Fatalf("unexpected payload: %#v", got)
	}
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "tencent-vod-vs.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := protocol.ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	adapters, err := protocol.LoadInstalledProviders(pkg.ManifestRaw, nil)
	if err != nil || len(adapters) != 1 {
		t.Fatalf("wrong provider: %v", err)
	}
	spec, err := adapters[0].BuildCreate(context.Background(), protocol.RequestContext{Request: req})
	if err != nil {
		t.Fatal(err)
	}
	wire, err := json.Marshal(spec.Body)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(wire), `"SubAppId":123456789`) || !strings.Contains(string(wire), `"FileInfos":[{"Category":"Image","Usage":"FirstFrame","Type":"Url","Url":"https://media.example.com/ref.png"}]`) {
		t.Fatalf("wrong wire request: %s", wire)
	}
	if strings.Contains(string(wire), "AudioGeneration") || strings.Contains(string(wire), "LogoAdd") {
		t.Fatalf("omitted options sent: %s", wire)
	}
	target, err := protocolRequestURL(cfg.BaseURL, spec)
	if err != nil || target != tencentVODBaseURL+"/" {
		t.Fatalf("create URL = %s, %v", target, err)
	}
	reqHTTP, err := http.NewRequest(spec.Method, target, strings.NewReader(string(wire)))
	if err != nil {
		t.Fatal(err)
	}
	for name, value := range spec.Headers {
		reqHTTP.Header.Set(name, value)
	}
	cfg.APIKey, cfg.SecretKey = "fake-id", "fake-key"
	if err := applyProtocolAuth(reqHTTP, cfg, spec.Auth); err != nil {
		t.Fatal(err)
	}
	if auth := reqHTTP.Header.Get("Authorization"); !strings.HasPrefix(auth, "TC3-HMAC-SHA256 Credential=fake-id/") || !strings.Contains(auth, "/vod/tc3_request") || reqHTTP.Header.Get("X-TC-Timestamp") == "" {
		t.Fatal("Tencent request was not signed")
	}
}

func TestTencentVODReferenceModesAndLimits(t *testing.T) {
	outboundtest.PublicDNS(t, "media.example.com")
	asset := func(role string, duration int64) protocol.MediaReference {
		return protocol.MediaReference{Role: role, URL: "https://media.example.com/fixture", Metadata: map[string]any{"durationMs": duration}}
	}
	for _, tc := range []struct {
		name           string
		model          string
		ratio          string
		operation      string
		resolution     string
		seconds        int
		images, videos []protocol.MediaReference
		valid          bool
	}{
		{name: "canvas first-last frames", model: "2.5", operation: "image_to_video", images: []protocol.MediaReference{asset("first_frame", 0), asset("last_frame", 0)}, valid: true},
		{name: "frame ratio", model: "2.5", ratio: "16:9", operation: "image_to_video", images: []protocol.MediaReference{asset("first_frame", 0)}},
		{name: "last without first", model: "2.0", operation: "image_to_video", images: []protocol.MediaReference{asset("last_frame", 0)}},
		{name: "reference duration", model: "2.0", operation: "reference_to_video", videos: []protocol.MediaReference{asset("", 8000), asset("", 8000)}},
		{name: "reference allowed in 2.5", model: "2.5", operation: "reference_to_video", videos: []protocol.MediaReference{asset("", 8000), asset("", 8000)}, valid: true},
		{name: "2.0 fast rejects 4K", model: "2.0-fast", resolution: "4K"},
		{name: "2.0 allows 4K", model: "2.0", resolution: "4K", valid: true},
		{name: "too long for mini", model: "2.0-mini", seconds: 16},
		{name: "mixed with first frame rejected", model: "2.0", images: []protocol.MediaReference{asset("first_frame", 0)}, videos: []protocol.MediaReference{asset("", 2000)}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := providerConfig{ChannelID: "vod-channel", BaseURL: tencentVODBaseURL, tencentVODAppID: 123}
			req := protocol.GenerationRequest{Model: tc.model, Prompt: "test", Duration: tc.seconds, AspectRatio: tc.ratio, Resolution: tc.resolution, Operation: tc.operation, Images: tc.images, Videos: tc.videos}
			if err := prepareTencentVODRequest(&cfg, &req); (err == nil) != tc.valid {
				t.Fatalf("valid=%v, got %v", tc.valid, err)
			}
		})
	}
}

func TestTencentVODRejectsNonSystemChannelAndArbitraryHosts(t *testing.T) {
	req := protocol.GenerationRequest{Model: "2.0", Prompt: "test"}
	for _, c := range []providerConfig{
		{BaseURL: tencentVODBaseURL, tencentVODAppID: 123},
		{ChannelID: "system", BaseURL: "https://example.com", tencentVODAppID: 123},
		{ChannelID: "system", BaseURL: tencentVODBaseURL, Headers: []OutboundHeader{{Name: tencentVODAppIDHeader, Value: "-1"}}},
	} {
		if err := prepareTencentVODRequest(&c, &req); err == nil {
			t.Fatal("unsafe channel accepted")
		}
	}
}

func TestTencentVODAdminChannelSetting(t *testing.T) {
	appID := int64(123456789)
	sortOrder := 1
	if (ChannelRequest{SortOrder: &sortOrder, TencentVODAppID: &appID}).presentationOnly() {
		t.Fatal("combined app ID and sort update treated as sort-only")
	}
	channel, err := channelFromRequest(ChannelRequest{Name: "test channel", BaseURL: tencentVODBaseURL, TencentVODAppID: &appID}, model.ModelChannel{Scope: model.ChannelScopeSystem, BaseURL: tencentVODBaseURL})
	if err != nil {
		t.Fatal(err)
	}
	adminView, userView := publicChannel(channel, true, nil), publicChannel(channel, false, nil)
	if adminView.TencentVODAppID != appID || userView.TencentVODAppID != 0 || len(adminView.Headers) != 0 {
		t.Fatal("app ID leaked or not restored")
	}
	if _, err := channelFromRequest(mergeChannelRequest(ChannelRequest{}, channel), channel); err != nil {
		t.Fatal(err)
	}
	if _, err := channelFromRequest(ChannelRequest{Name: "test channel", BaseURL: tencentVODBaseURL}, model.ModelChannel{BaseURL: tencentVODBaseURL}); err == nil {
		t.Fatal("missing app ID accepted")
	}
}

func TestTencentVODAdminSavesModelAndResolvesTrustedScope(t *testing.T) {
	outboundtest.PublicDNS(t, "vod.tencentcloudapi.com")
	svc, _ := newChannelModelTestService(t)
	svc.dataDir = t.TempDir()
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	user := &model.User{ID: "user", Role: model.UserRoleUser}
	appID := int64(123456789)
	config := ChannelRequest{Name: "VOD test", BaseURL: tencentVODBaseURL, TencentVODAppID: &appID, APIKey: "not-a-real-id", SecretKey: "not-a-real-key"}
	if _, err := svc.CreateSystemChannel(user, config); err == nil {
		t.Fatal("regular user created a system channel")
	}
	channel, err := svc.CreateSystemChannel(admin, config)
	if err != nil {
		t.Fatal(err)
	}
	channelModel, err := svc.SaveAdminChannelModel(admin, channel.ID, "", ChannelModelRequest{
		ModelKey: "vod-test", ProviderModelKey: "vs-2.5", Capability: "video", Protocol: string(model.ChannelInterfaceTencentVODVS),
		CapabilityConfig: DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceTencentVODVS), "vs-2.5"),
		PriceTiers:       []ChannelModelPriceTierRequest{{BillingMode: "fixed_request", PriceConfigured: true}},
	})
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := svc.resolveProviderConfig(providerConfig{ChannelID: channel.ID, Model: channelModel.ModelKey, BaseURL: "https://untrusted.example", tencentVODAppID: 99})
	if err != nil {
		t.Fatal(err)
	}
	if resolved.BaseURL != tencentVODBaseURL || resolved.tencentVODAppID != appID || resolved.Model != "vs-2.5" || len(resolved.Headers) != 0 {
		t.Fatal("stored system settings did not override task-supplied settings")
	}
	if paths := svc.SystemProxyDeclaredPostPaths(model.ChannelInterfaceTencentVODVS); len(paths) != 0 {
		t.Fatalf("browser proxy paths unexpectedly allowed: %v", paths)
	}
}
