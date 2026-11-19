package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
)

type Tack2AIVideoCapability struct {
	Modes      []string                          `json:"modes"`
	Media      map[string]Tack2AIVideoMediaLimit `json:"media,omitempty"`
	Conditions []Tack2AIVideoCondition           `json:"conditions,omitempty"`
}

type Tack2AIVideoMediaLimit struct {
	Min       *int     `json:"min_items,omitempty"`
	Max       *int     `json:"max_items,omitempty"`
	Allowed   []string `json:"allowed_types,omitempty"`
	Required  []string `json:"required_types,omitempty"`
	Forbidden []string `json:"forbidden_types,omitempty"`
}

type Tack2AIVideoCondition struct {
	Parameter string                                `json:"parameter"`
	Values    []string                              `json:"values"`
	Limits    map[string]Tack2AIVideoParameterLimit `json:"limits"`
}

type Tack2AIVideoParameterLimit struct {
	Min    *int     `json:"min,omitempty"`
	Max    *int     `json:"max,omitempty"`
	Values []string `json:"values,omitempty"`
}

func tack2aiVideoCapability(c *tack2aiContract, modes []string) (*Tack2AIVideoCapability, error) {
	v := &Tack2AIVideoCapability{Modes: modes, Media: c.Parameters["mode"].Media}
	for _, condition := range c.Conditions {
		var param, equal string
		var oneOf []string
		if json.Unmarshal(condition.When["parameter"], &param) != nil || param == "" ||
			(len(condition.When) != 2) {
			return nil, errors.New("视频目录含无法识别的规格条件")
		}
		if raw := condition.When["equals"]; raw != nil {
			if json.Unmarshal(raw, &equal) != nil || equal == "" {
				return nil, errors.New("视频目录含无法识别的规格条件")
			}
			oneOf = []string{equal}
		} else if json.Unmarshal(condition.When["in"], &oneOf) != nil || len(oneOf) == 0 {
			return nil, errors.New("视频目录含无法识别的规格条件")
		}
		if param != "mode" && param != "omni_reference_task_type" {
			return nil, errors.New("视频目录含乐见画布无法约束的规格条件")
		}
		projected := Tack2AIVideoCondition{Parameter: param, Values: oneOf, Limits: map[string]Tack2AIVideoParameterLimit{}}
		for name, raw := range condition.Parameters {
			var fields map[string]json.RawMessage
			if json.Unmarshal(raw, &fields) != nil {
				return nil, errors.New("视频目录含无法识别的规格限制")
			}
			var limit Tack2AIVideoParameterLimit
			switch name {
			case "duration":
				if len(fields) == 0 || len(fields) != lenKnownFields(fields, "min", "max") || json.Unmarshal(raw, &limit) != nil ||
					limit.Min != nil && *limit.Min < 1 || limit.Max != nil && *limit.Max < 1 {
					return nil, errors.New("视频目录含乐见画布无法表达的时长限制")
				}
			case "ratio", "resolution":
				if len(fields) != 1 || json.Unmarshal(fields["values"], &limit.Values) != nil || len(limit.Values) == 0 {
					return nil, errors.New("视频目录含乐见画布无法表达的画幅或分辨率限制")
				}
			default:
				return nil, errors.New("视频目录含乐见画布无法约束的条件参数")
			}
			projected.Limits[name] = limit
		}
		v.Conditions = append(v.Conditions, projected)
	}
	return v, nil
}

func lenKnownFields(fields map[string]json.RawMessage, names ...string) int {
	count := 0
	for _, name := range names {
		if fields[name] != nil {
			count++
		}
	}
	return count
}

// Resolve the public wire mode from the exact image roles used by the adapter.
// The chosen mode travels with the request so the gateway does not infer a
// different mode from an ambiguous reference list.
func tack2aiVideoMode(profile *Tack2AIVideoCapability, input canvasGenerationInput) (string, []string) {
	var kinds []string
	fallback := ""
	if metadataString(input.Metadata, "videoStartFrameNodeId") != "" || metadataString(input.Metadata, "videoEndFrameNodeId") != "" {
		fallback = "reference_image"
	}
	for _, image := range input.ReferenceImages {
		kinds = append(kinds, firstNonEmpty(videoImageRoleOrDefault(input, image, fallback), "reference_image"))
	}
	for range input.ReferenceVideos {
		kinds = append(kinds, "reference_video")
	}
	for range input.ReferenceAudios {
		kinds = append(kinds, "reference_audio")
	}
	switch {
	case len(kinds) == 0:
		return "text_to_video", kinds
	case len(kinds) == 2 && slices.Contains(kinds, "first_frame") && slices.Contains(kinds, "last_frame"):
		return "first_last_frame", kinds
	case len(kinds) == 1 && (kinds[0] == "first_frame" || kinds[0] == "reference_image" &&
		metadataString(input.Metadata, "videoEditOperation") != "reference_to_video" && slices.Contains(profile.Modes, "image_to_video")):
		return "image_to_video", []string{tack2aiSingleImageRole(profile.Media["image_to_video"], kinds[0])}
	default:
		return "multi_ref", kinds
	}
}

func tack2aiSingleImageRole(limit Tack2AIVideoMediaLimit, preferred string) string {
	for _, role := range []string{preferred, "first_frame", "reference_image"} {
		if !slices.Contains(limit.Forbidden, role) && (limit.Allowed == nil || slices.Contains(limit.Allowed, role)) &&
			(len(limit.Required) == 0 || slices.Contains(limit.Required, role)) {
			return role
		}
	}
	return preferred // Admission will reject when no role satisfies the model.
}

func validateTack2AIVideoRequest(profile *VideoCapabilityConfig, input canvasGenerationInput, seconds int) error {
	contract := profile.Tack2AI
	if contract == nil {
		return nil
	}
	mode, kinds := tack2aiVideoMode(contract, input)
	if !slices.Contains(contract.Modes, mode) {
		return BadAuthRequest("源点动力模型不支持当前素材对应的生成模式")
	}
	switch metadataString(input.Metadata, "videoEditOperation") {
	case "text_to_video":
		if mode != "text_to_video" {
			return BadAuthRequest("文生视频模式不能提交参考素材")
		}
	case "image_to_video":
		if mode != "image_to_video" && mode != "first_last_frame" {
			return BadAuthRequest("图生视频模式需要有效的首帧或首尾帧")
		}
	case "reference_to_video", "audio_to_video":
		if mode != "multi_ref" {
			return BadAuthRequest("参考生成模式需要有效的参考素材")
		}
	}
	if media, ok := contract.Media[mode]; ok {
		count := len(kinds)
		if media.Min != nil && count < *media.Min || media.Max != nil && count > *media.Max {
			return BadAuthRequest("参考素材数量不符合当前源点动力视频模式")
		}
		for _, kind := range kinds {
			if slices.Contains(media.Forbidden, kind) || media.Allowed != nil && !slices.Contains(media.Allowed, kind) {
				return BadAuthRequest("参考素材类型不符合当前源点动力视频模式")
			}
		}
		for _, kind := range media.Required {
			if !slices.Contains(kinds, kind) {
				return BadAuthRequest("缺少当前源点动力视频模式要求的参考素材")
			}
		}
	}
	ratio := firstNonEmpty(input.Config.Size, profile.DefaultRatio)
	resolution := firstNonEmpty(videoResolutionNameRequest(profile, input.Config.VQuality), profile.DefaultResolution)
	options, _ := input.Metadata["providerOptions"].(map[string]any)
	wire, _ := options["tack2ai-video"].(map[string]any)
	metadata, _ := wire["metadata"].(map[string]any)
	actual := map[string]string{"mode": mode, "omni_reference_task_type": tack2aiDeclaredString(metadata["omni_reference_task_type"])}
	for _, condition := range contract.Conditions {
		if !slices.Contains(condition.Values, actual[condition.Parameter]) {
			continue
		}
		for _, name := range []string{"duration", "ratio", "resolution"} {
			limit := condition.Limits[name]
			allowed := true
			switch name {
			case "duration":
				allowed = (limit.Min == nil || seconds >= *limit.Min) && (limit.Max == nil || seconds <= *limit.Max)
			case "ratio":
				allowed = len(limit.Values) == 0 || slices.Contains(limit.Values, ratio)
			case "resolution":
				allowed = len(limit.Values) == 0 || slices.ContainsFunc(limit.Values, func(value string) bool { return strings.EqualFold(value, resolution) })
			}
			if !allowed {
				return BadAuthRequest(fmt.Sprintf("所选规格不符合源点动力当前视频模式（%s）的限制", name))
			}
		}
	}
	return nil
}
