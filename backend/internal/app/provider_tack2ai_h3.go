package app

import (
	"cmp"
	"errors"
	"maps"
	"slices"

	"yingce/backend/internal/protocol"
)

func applyTack2AIH3VideoContract(spec *protocol.RequestSpec, request protocol.GenerationRequest, irEnabled bool) error {
	original := protocolBodyObject(spec.Body)
	if original == nil || spec.Path != "/v1/videos" {
		return errors.New("源点动力 H3 的视频提交入口不匹配")
	}
	mode := stringValue(request.Extra["tack2aiVideoMode"])
	if mode == "" {
		if len(request.Inputs) != 0 {
			return errors.New("源点动力 H3 缺少参考素材的生成模式，请同步模型能力")
		}
		mode = "text_to_video"
	}
	parameters := map[string]any{"context_ir_enabled": irEnabled}
	if watermark, ok := protocolBodyObject(original["metadata"])["aigc_watermark"].(bool); ok {
		parameters["aigc_watermark"] = watermark
	}
	body := map[string]any{
		"model": request.Model, "mode": mode, "prompt": original["prompt"],
		"duration": request.Duration, "resolution": request.Resolution, "parameters": parameters,
	}
	if ratio := firstNonEmpty(stringValue(request.Extra["tack2aiVideoRatio"]), request.AspectRatio); ratio != "" {
		body["ratio"] = ratio
	}
	if len(request.Inputs) > 0 {
		inputs := slices.Clone(request.Inputs)
		slices.SortStableFunc(inputs, func(a, b protocol.MediaReference) int { return cmp.Compare(a.Order, b.Order) })
		media := make([]map[string]string, 0, len(inputs))
		for _, item := range inputs {
			if item.URL == "" {
				return errors.New("源点动力 H3 的参考素材需要可访问的 URL")
			}
			media = append(media, map[string]string{"type": item.Role, "url": item.URL})
		}
		body["input"] = map[string]any{"media": media}
	}
	headers := make(map[string]string, len(spec.Headers)+1)
	maps.Copy(headers, spec.Headers)
	headers["X-TD-Contract"] = "td.video.v1"
	spec.Headers, spec.Body = headers, body
	return nil
}
