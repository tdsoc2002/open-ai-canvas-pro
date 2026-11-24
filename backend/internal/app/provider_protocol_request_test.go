package app

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestEvoLinkSeedUploadOnlyUsesOfficialChannelCredentials(t *testing.T) {
	config := providerConfig{
		BaseURL:   "https://api.evolink.ai/v1",
		APIKey:    "test-api-key",
		SecretKey: "unused-secret",
		Headers:   []OutboundHeader{{Name: "X-Channel-Key", Value: "channel-only"}},
	}
	upload, err := evoLinkSeedUploadConfig(config)
	if err != nil {
		t.Fatal(err)
	}
	if upload.BaseURL != "https://files-api.evolink.ai" || upload.APIKey != config.APIKey || upload.SecretKey != "" || len(upload.Headers) != 0 {
		t.Fatal("upload must use the official file service with only the API key")
	}
	for _, baseURL := range []string{"https://gateway.example/v1", "http://api.evolink.ai", "https://api.evolink.ai:444"} {
		config.BaseURL = baseURL
		if _, err := evoLinkSeedUploadConfig(config); err == nil {
			t.Errorf("unexpectedly allowed reference upload for %s", baseURL)
		}
	}
}

func TestProtocolRequestFromInputUsesConfiguredBase64ForOpenAIImage(t *testing.T) {
	request := protocolRequestFromInput(canvasGenerationInput{
		Mode: "image",
		Config: providerConfig{
			InterfaceType: string(model.ChannelInterfaceOpenAIImage),
			ImageParameters: map[string]any{
				"size": "1024x1024",
			},
		},
		ImageCapability: &ImageCapabilityConfig{
			ResponseFormat: ParameterSupport{Supported: true, Default: "b64_json"},
		},
	})

	if got := request.ProviderOptions[string(model.ChannelInterfaceOpenAIImage)]["response_format"]; got != "b64_json" {
		t.Fatalf("response_format = %#v, want b64_json", got)
	}
}

func TestProtocolRequestFromInputOmitsAutomaticOpenAIImageFormat(t *testing.T) {
	request := protocolRequestFromInput(canvasGenerationInput{
		Mode: "image",
		Config: providerConfig{
			InterfaceType:   string(model.ChannelInterfaceOpenAIImage),
			ImageParameters: map[string]any{"size": "1024x1024"},
		},
		ImageCapability: &ImageCapabilityConfig{
			ResponseFormat: ParameterSupport{Supported: true, Default: "auto"},
		},
	})

	if _, ok := request.ProviderOptions[string(model.ChannelInterfaceOpenAIImage)]["response_format"]; ok {
		t.Fatal("response_format should be omitted when the model default is auto")
	}
}

func TestProtocolRequestFromInputKeepsURLForUnsupportedOpenAIImageFormat(t *testing.T) {
	request := protocolRequestFromInput(canvasGenerationInput{
		Mode:   "image",
		Config: providerConfig{InterfaceType: string(model.ChannelInterfaceOpenAIImage)},
		ImageCapability: &ImageCapabilityConfig{
			ResponseFormat: ParameterSupport{Supported: false},
		},
	})

	if _, ok := request.ProviderOptions[string(model.ChannelInterfaceOpenAIImage)]["response_format"]; ok {
		t.Fatal("response_format should be omitted when the capability is unsupported")
	}
}
