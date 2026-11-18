package app

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/outbound/outboundtest"
	"yingce/backend/internal/protocol"
)

func TestTencentVODOGDirectRequest(t *testing.T) {
	outboundtest.PublicDNS(t, "media.example.com")
	cfg := providerConfig{ChannelID: "channel", BaseURL: tencentVODBaseURL, tencentVODAppID: 123, TransparentBackground: "true"}
	req := protocol.GenerationRequest{Model: "gpt-image-2.5-flare", Quality: "xhigh", Resolution: "2k", AspectRatio: "2048x2048", Prompt: "修改图片", ImageCount: 1,
		Images: []protocol.MediaReference{{URL: "https://media.example.com/photo.png"}, {DataURL: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDioAAAAASUVORK5CYII=", Role: "mask"}}}
	if err := prepareTencentVODImageRequest(&cfg, &req); err != nil {
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
	if err := prepareTencentVODImageRequest(&cfg, &req); err == nil {
		t.Fatal("underpriced tier could send larger dimensions")
	}
	req.Resolution, req.Quality, req.Model = "2k", "max", "gpt-image-2"
	if err := prepareTencentVODImageRequest(&cfg, &req); err == nil {
		t.Fatal("unsupported quality accepted")
	}
	req.Quality, req.ImageCount = "high", 2
	if err := prepareTencentVODImageRequest(&cfg, &req); err == nil {
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
	if err := prepareTencentVODImageRequest(&input.Config, &request); err == nil {
		t.Fatal("an empty mask must not become an unmasked request")
	}
}
