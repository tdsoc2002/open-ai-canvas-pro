package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"yingce/backend/internal/outbound/outboundtest"
	"yingce/backend/internal/protocol"
)

type tencentVODCreateCapture struct {
	protocol.Adapter
	spec protocol.RequestSpec
}

var errTencentVODCreateCaptured = errors.New("腾讯请求已离线捕获")

func (a *tencentVODCreateCapture) BuildCreate(ctx context.Context, input protocol.RequestContext) (protocol.RequestSpec, error) {
	spec, err := a.Adapter.BuildCreate(ctx, input)
	if err != nil {
		return protocol.RequestSpec{}, err
	}
	a.spec = spec
	return protocol.RequestSpec{}, errTencentVODCreateCaptured
}

func TestTencentVODOGCreateMapsModelParameters(t *testing.T) {
	adapter, ok := loadOfficialFallbackRegistry().Resolve(tencentVODImageProtocol)
	if !ok {
		t.Fatal("未找到官方腾讯 OG 适配器")
	}
	for _, tc := range []struct {
		model, size, resolution, pixels, version string
	}{
		{"gpt-image-2", "1024x1024", "1k", "1024x1024", "image2_low"},
		{"gpt-image-2.5-flare", "1:1", "1k", "1024x1024", "image2.5_flare_low"},
		{"gpt-image-2.5-sunburst", "16:9", "2k", "2048x1152", "image2.5_sunburst_low"},
	} {
		t.Run(tc.model, func(t *testing.T) {
			capture := &tencentVODCreateCapture{Adapter: adapter}
			input := canvasGenerationInput{Mode: "image", Prompt: "纯色圆形",
				ImageCapability: &ImageCapabilityConfig{
					Size: ImageSizeConfig{Presets: []ImageSizePreset{{Ratio: "1:1", Size: "1024x1024", Tier: "1k"}, {Ratio: "16:9", Size: "2048x1152", Tier: "2k"}}},
				},
				Config: providerConfig{ChannelID: "channel", BaseURL: tencentVODBaseURL, tencentVODAppID: 123,
					InterfaceType: tencentVODImageProtocol, Model: tc.model, Size: tc.size, ImageResolution: tc.resolution, Quality: "low",
					Count: "1", TransparentBackground: "true",
					ImageParameters: map[string]any{"size": tc.size, "imageResolution": tc.resolution, "quality": "low", "count": 1, "transparentBackground": true},
				},
			}
			_, err := runProtocolAdapterTaskWithPolicy(context.Background(), input, capture, fastVideoPollPolicy())
			if !errors.Is(err, errTencentVODCreateCaptured) {
				t.Fatalf("未能构造腾讯请求：%v", err)
			}
			body, err := json.Marshal(capture.spec.Body)
			if err != nil {
				t.Fatal(err)
			}
			for _, field := range []string{
				`"SubAppId":123`, `"ModelVersion":"` + tc.version + `"`, `"OutputImageCount":1`,
				`"Resolution":"` + strings.ToUpper(tc.resolution) + `"`, tc.pixels, "transparent",
			} {
				if !strings.Contains(string(body), field) {
					t.Fatalf("缺少 %s：%s", field, body)
				}
			}
			input.Config.ImageParameters["unmapped"] = "not supported"
			if _, err := runProtocolAdapterTaskWithPolicy(context.Background(), input, capture, fastVideoPollPolicy()); err == nil ||
				errors.Is(err, errTencentVODCreateCaptured) {
				t.Fatalf("未映射参数不应达到腾讯请求：%v", err)
			}
		})
	}
}

func TestTencentVODOGDirectRequest(t *testing.T) {
	outboundtest.PublicDNS(t, "media.example.com")
	cfg := providerConfig{ChannelID: "channel", BaseURL: tencentVODBaseURL, tencentVODAppID: 123, TransparentBackground: "true"}
	req := protocol.GenerationRequest{Model: "gpt-image-2.5-flare", Quality: "xhigh", Resolution: "2k", AspectRatio: "2048x2048", Prompt: "修改图片", ImageCount: 1,
		Images: []protocol.MediaReference{{URL: "https://media.example.com/photo.png"}, {DataURL: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDioAAAAASUVORK5CYII=", Role: "mask"}}}
	if err := prepareTencentVODImageRequest(&cfg, &req, nil); err != nil {
		t.Fatal(err)
	}
	body, err := json.Marshal(req.Extra["tencentVod"])
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{`"SubAppId":123`, `"ModelName":"OG"`, `"ModelVersion":"image2.5_flare_xhigh"`, `"Resolution":"2K"`, `"ReferenceType":"mask"`, `AdditionalParameters`, `2048x2048`, `transparent`} {
		if !strings.Contains(string(body), field) {
			t.Fatalf("missing %s: %s", field, body)
		}
	}
	req.Resolution = "1k"
	if err := prepareTencentVODImageRequest(&cfg, &req, nil); err == nil {
		t.Fatal("underpriced tier could send larger dimensions")
	}
	req.Resolution, req.Quality, req.Model = "2k", "max", "gpt-image-2"
	if err := prepareTencentVODImageRequest(&cfg, &req, nil); err == nil {
		t.Fatal("unsupported quality accepted")
	}
	req.Quality, req.ImageCount = "high", 2
	if err := prepareTencentVODImageRequest(&cfg, &req, nil); err == nil {
		t.Fatal("multiple outputs admitted to single-image billing")
	}
}

func TestTencentVODOGSourceCatalogPresets(t *testing.T) {
	total := 0
	for priceTier, sizes := range tencentVODImagePriceSizes {
		for _, size := range sizes {
			w, h, _, err := tencentVODImageSize(size)
			if err != nil || tencentVODImagePriceTier(w, h) != priceTier {
				t.Fatalf("%s preset %s cannot be sent: %v", priceTier, size, err)
			}
			total++
		}
	}
	if total != 45 {
		t.Fatalf("expected source's 45 presets, got %d", total)
	}
}

func TestTencentVODOGRejectsEmptyMask(t *testing.T) {
	outboundtest.PublicDNS(t, "media.example.com")
	input := canvasGenerationInput{Mode: "image", Prompt: "edit", Mask: &providerMedia{},
		Config:          providerConfig{ChannelID: "channel", BaseURL: tencentVODBaseURL, tencentVODAppID: 123, InterfaceType: tencentVODImageProtocol, Model: "gpt-image-2"},
		ReferenceImages: []providerMedia{{URL: "https://media.example.com/photo.png"}}}
	request := protocolRequestFromInput(input)
	if err := prepareTencentVODImageRequest(&input.Config, &request, nil); err == nil {
		t.Fatal("an empty mask must not become an unmasked request")
	}
}
