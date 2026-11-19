package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"
	"unicode"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

const tack2aiCatalogURL = "https://ai.tack2ai.cn/v1/catalog/models"

type adminModelCatalog struct {
	models []string
	drafts map[string]tack2aiCatalogDraft
}

func (catalog *adminModelCatalog) items() []AdminChannelCatalogItem {
	var items []AdminChannelCatalogItem
	for _, id := range catalog.models {
		if draft, ok := catalog.drafts[id]; ok {
			items = append(items, draft.info)
		}
	}
	return items
}

type AdminChannelCatalogItem struct {
	ID                string `json:"id"`
	Capability        string `json:"capability,omitempty"`
	Protocol          string `json:"protocol,omitempty"`
	Fingerprint       string `json:"fingerprint,omitempty"`
	UnavailableReason string `json:"unavailableReason,omitempty"`
}

type tack2aiCatalogDraft struct {
	info   AdminChannelCatalogItem
	config string
}

type tack2aiCatalogModel struct {
	ID        string           `json:"id"`
	Endpoints []string         `json:"supported_endpoint_types"`
	Contract  *tack2aiContract `json:"x_td"`
	Invalid   bool             `json:"-"`
}

type tack2aiContract struct {
	Modalities []string `json:"modalities"`
	Operations []string `json:"operations"`
	Revision   string   `json:"capability_revision"`
	Inputs     struct {
		Images tack2aiMediaInput `json:"images"`
		Videos tack2aiMediaInput `json:"videos"`
		Audios tack2aiMediaInput `json:"audios"`
	} `json:"inputs"`
	References struct {
		Total *int `json:"maxTotalItems"`
	} `json:"reference_media"`
	Result struct {
		Resource string `json:"resource"`
		Content  string `json:"content_endpoint"`
	} `json:"result"`
	Parameters map[string]tack2aiParameter `json:"parameters"`
	Conditions []struct {
		When       map[string]json.RawMessage `json:"when"`
		Parameters map[string]json.RawMessage `json:"parameters"`
	} `json:"parameter_conditions"`
}

type tack2aiMediaInput struct {
	Max int `json:"max"`
}

type tack2aiParameter struct {
	Semantic          string                            `json:"semantic_id"`
	Values            []any                             `json:"values"`
	Default           any                               `json:"default"`
	Min               *float64                          `json:"min"`
	Max               *float64                          `json:"max"`
	Step              *float64                          `json:"step"`
	MaxLength         int                               `json:"max_length"`
	MaxItems          int                               `json:"max_items"`
	MutuallyExclusive bool                              `json:"audio_image_mutually_exclusive"`
	RequiresSelection bool                              `json:"requires_selection"`
	Required          json.RawMessage                   `json:"required"`
	Properties        map[string]tack2aiParameter       `json:"properties"`
	Items             *tack2aiParameter                 `json:"items"`
	Media             map[string]Tack2AIVideoMediaLimit `json:"media_constraints"`
}

func (p tack2aiParameter) required() bool {
	return string(p.Required) == "true"
}

func tack2aiCatalogTarget(baseURL string, apiFormat string) string {
	if format := strings.ToLower(strings.TrimSpace(apiFormat)); format != "" && format != "openai" {
		return ""
	}
	u, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || u.Scheme != "https" || !strings.EqualFold(u.Hostname(), "ai.tack2ai.cn") ||
		u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || (u.Port() != "" && u.Port() != "443") {
		return ""
	}
	switch strings.TrimRight(u.EscapedPath(), "/") {
	case "", "/v1":
		return tack2aiCatalogURL
	default:
		return ""
	}
}

func (s *Service) fetchTack2AICatalog(ctx context.Context, channel *model.ModelChannel, target string) (*adminModelCatalog, error) {
	if strings.TrimSpace(channel.APIKey) == "" {
		return nil, BadAuthRequest("请先配置源点动力渠道的 API Key")
	}
	if _, err := ValidateCustomRelayURL(target); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, BadAuthRequest("源点动力模型目录地址无效")
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(channel.APIKey))
	req.Header.Set("Accept", "application/json")
	ApplyDefaultOutboundHeaders(req)
	resp, err := CustomRelayHTTPClient(20 * time.Second).Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, NewAppError(http.StatusBadGateway, "连接源点动力模型目录失败，请检查网络")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			return nil, NewAppError(http.StatusBadGateway, "源点动力模型目录鉴权失败，请检查 API Key")
		}
		return nil, NewAppError(http.StatusBadGateway, fmt.Sprintf("源点动力模型目录请求失败（HTTP %d）", resp.StatusCode))
	}
	const maxCatalogBytes = 8 << 20
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxCatalogBytes+1))
	var payload struct {
		Object string            `json:"object"`
		Data   []json.RawMessage `json:"data"`
	}
	if err != nil || len(body) > maxCatalogBytes || json.Unmarshal(body, &payload) != nil || payload.Object != "list" || payload.Data == nil {
		return nil, NewAppError(http.StatusBadGateway, "源点动力模型目录响应无效或超出大小限制")
	}
	items := make([]tack2aiCatalogModel, 0, len(payload.Data))
	for _, raw := range payload.Data {
		var item tack2aiCatalogModel
		if err := json.Unmarshal(raw, &item); err != nil {
			item.Invalid = true
		}
		items = append(items, item)
	}
	return s.parseTack2AICatalog(channel.ID, items), nil
}

func (s *Service) parseTack2AICatalog(channelID string, items []tack2aiCatalogModel) *adminModelCatalog {
	catalog := &adminModelCatalog{models: make([]string, 0, len(items)), drafts: make(map[string]tack2aiCatalogDraft, len(items))}
	counts := make(map[string]int, len(items))
	for _, item := range items {
		counts[channelModelCatalogKey(item.ID)]++
	}
	registry := s.protocolRegistry()
	for _, item := range items {
		id := item.ID
		if id == "" {
			continue
		}
		if _, duplicate := catalog.drafts[id]; !duplicate {
			catalog.models = append(catalog.models, id)
		}
		draft := tack2aiCatalogDraft{info: AdminChannelCatalogItem{ID: id}}
		if counts[channelModelCatalogKey(id)] > 1 {
			draft.info.UnavailableReason = "目录中的模型标识冲突"
		} else if item.Invalid {
			draft.info.UnavailableReason = "该模型的能力目录格式不受支持"
		} else if key := strings.TrimPrefix(id, "models/"); key == "" || key != strings.TrimSpace(key) || id != strings.TrimSpace(id) || len([]rune(id)) > 120 || strings.IndexFunc(id, unicode.IsControl) >= 0 {
			draft.info.UnavailableReason = "模型标识不符合乐见画布配置约束"
		} else if capability, protocolID, contract, err := tack2aiModelContract(item); err != nil {
			draft.info.UnavailableReason = err.Error()
		} else {
			draft.info.Capability, draft.info.Protocol = capability, protocolID
			if err := validateGenerationInterfaceWithRegistry(registry, capability, protocolID); err != nil {
				draft.info.UnavailableReason = "源点动力插件协议尚未安装或启用"
			} else if normalized, err := NormalizeModelCapabilityConfigForModel(capability, protocolID, id, contract, registry); err != nil {
				draft.info.UnavailableReason = "网关能力无法预填：" + err.Error()
			} else if config, err := json.Marshal(normalized); err != nil {
				draft.info.UnavailableReason = "网关能力无法编码"
			} else {
				draft.config = string(config)
				fingerprint, _ := json.Marshal([]any{channelID, item, capability, protocolID, draft.config})
				sum := sha256.Sum256(fingerprint)
				draft.info.Fingerprint = hex.EncodeToString(sum[:])
			}
		}
		catalog.drafts[id] = draft
	}
	sort.Strings(catalog.models)
	return catalog
}

func tack2aiModelContract(item tack2aiCatalogModel) (string, string, *ModelCapabilityConfig, error) {
	c := item.Contract
	if c == nil || len(c.Modalities) != 1 {
		return "", "", nil, errors.New("模型目录未声明唯一生成能力")
	}
	capability := c.Modalities[0]
	if capability == "chat" {
		capability = "text"
	}
	has := func(endpoint string) bool { return slices.Contains(item.Endpoints, endpoint) }
	link := c.Result.Content
	p := c.Parameters
	cfg := &ModelCapabilityConfig{Version: 1}
	var id string
	var err error
	switch {
	case capability == "text" && has("openai") && (c.Result.Resource == "" || slices.Contains([]string{"chat", "text", "json"}, c.Result.Resource)) &&
		(len(c.Operations) == 0 || slices.Contains(c.Operations, "chat") || slices.Contains(c.Operations, "chat_completion")):
		id = "tack2ai-chat"
		if !tack2aiRequiredParamsSupported(p, "model", "prompt", "messages") {
			return "", "", nil, errors.New("文字模型含无法预填的必填参数")
		}
		cfg.Text = &TextCapabilityConfig{References: TextReferenceConfig{PromptMaxChars: tack2aiPromptLimit(p["prompt"]), MaxImages: c.Inputs.Images.Max}}
		if budget := p["max_tokens"].Max; budget != nil {
			if *budget < 256 || *budget != float64(int(*budget)) {
				return "", "", nil, errors.New("网关文字输出上限不能用乐见画布的文本能力表示")
			}
			cfg.Text.MaxOutputTokens = min(127999, int(*budget))
		}
		if _, ok := p["stream"]; !ok {
			value := false
			cfg.Text.Streaming = &value
		}
	case capability == "image" && has("image-generation") && (c.Result.Resource == "" || c.Result.Resource == "image"):
		id = "tack2ai-image"
		cfg.Image, err = tack2aiImageConfig(c)
	case capability == "video" && has("openai-video") && (link == "" || link == "/v1/videos/{id}/content") && (c.Result.Resource == "" || c.Result.Resource == "video"):
		id = "tack2ai-video"
		cfg.Video, err = tack2aiVideoConfig(c)
	case capability == "audio" && (has("audio-speech") || has("openai")) && slices.Contains(c.Operations, "speech") && c.Result.Resource == "audio":
		id = "tack2ai-audio"
		cfg.Audio, err = tack2aiAudioConfig(c)
	default:
		return "", "", nil, errors.New("未声明乐见画布支持的源点动力生成协议")
	}
	return capability, id, cfg, err
}

var tack2aiPixels = regexp.MustCompile(`^[1-9][0-9]{0,4}x[1-9][0-9]{0,4}$`)
var tack2aiRatio = regexp.MustCompile(`^[1-9][0-9]{0,4}:[1-9][0-9]{0,4}$`)

func tack2aiImageConfig(c *tack2aiContract) (*ImageCapabilityConfig, error) {
	p := c.Parameters
	size, ratio, quality := p["size"], p["aspect_ratio"], p["quality"]
	tiers := strings.Contains(size.Semantic, "tier")
	sizeField, ratioField, tierField := "size", "aspectRatio", "imageResolution"
	_, maskSupported := p["mask"]
	image := &ImageCapabilityConfig{References: ImageReferenceConfig{
		PromptMaxChars: tack2aiPromptLimit(p["prompt"]), MaxImages: c.Inputs.Images.Max,
		MaskSupported: maskSupported,
	}, MaxOutputs: 1}
	if !tack2aiRequiredParamsSupported(p, "model", "prompt", "size", "aspect_ratio", "quality", "n", "mask") {
		return nil, errors.New("图片模型含无法预填的必填参数")
	}
	for _, value := range tack2aiStrings(size.Values) {
		if value == "auto" && !tiers {
			continue
		}
		if !tiers && !tack2aiPixels.MatchString(value) {
			return nil, errors.New("图片目录未声明可识别的像素尺寸或档位")
		}
	}
	if !tiers {
		// "auto" omits the wire field; import only concrete pixel choices so
		// administrators can attach an unambiguous price tier.
		size.Values = slices.DeleteFunc(slices.Clone(size.Values), func(value any) bool { return tack2aiDeclaredString(value) == "auto" })
	}
	openPixels := size.Semantic == "image.size.dimensions" && len(p["size"].Values) == 0
	if tiers && (len(size.Values) == 0 || (ratio.required() && len(ratio.Values) == 0)) ||
		size.required() && len(size.Values) == 0 && !openPixels || !tiers && ratio.required() {
		return nil, errors.New("图片尺寸缺少有效的可选值")
	}
	for _, value := range tack2aiStrings(ratio.Values) {
		if !tack2aiRatio.MatchString(value) && value != "auto" {
			return nil, errors.New("图片宽高比不是可识别的规格")
		}
	}
	if quality.required() && len(quality.Values) == 0 {
		return nil, errors.New("图片画质缺少有效的可选值")
	}
	for _, condition := range c.Conditions {
		var when string
		var valid []string
		var limit struct {
			Values []string `json:"values"`
		}
		if len(condition.When) != 2 || json.Unmarshal(condition.When["parameter"], &when) != nil || when != "size" ||
			json.Unmarshal(condition.When["in"], &valid) != nil || len(valid) == 0 || len(condition.Parameters) != 1 ||
			json.Unmarshal(condition.Parameters["quality"], &limit) != nil || len(limit.Values) == 0 {
			return nil, errors.New("图片目录含乐见画布无法约束的规格条件")
		}
		// Use only qualities valid for every exposed size; do not advertise
		// invalid size/quality combinations in the generic image picker.
		quality.Values = slices.DeleteFunc(slices.Clone(quality.Values), func(value any) bool {
			return !slices.Contains(limit.Values, tack2aiDeclaredString(value))
		})
		if len(quality.Values) == 0 {
			return nil, errors.New("图片目录未声明适用于全部尺寸的画质")
		}
	}
	enabled, disabled, one := true, false, float64(1)
	count := p["n"]
	if count.Min != nil && *count.Min > 1 || count.Max != nil && *count.Max < 1 || count.required() && count.Max == nil {
		return nil, errors.New("图片数量无法安全预填")
	}
	if count.Max == nil {
		count.Max = &one
	}
	image.Parameters = []protocol.ImageParameter{
		{Name: "count", Enabled: &enabled, Min: &one, Max: count.Max, Default: one},
		{Name: "quality", Enabled: tack2aiBool(len(quality.Values) > 0), Values: quality.Values, Default: tack2aiChoice(quality)},
		{Name: sizeField, Enabled: &disabled}, {Name: tierField, Enabled: &disabled}, {Name: ratioField, Enabled: &disabled},
	}
	set := func(index int, param tack2aiParameter) {
		if len(param.Values) > 0 {
			image.Parameters[index].Enabled = &enabled
			image.Parameters[index].Values = param.Values
			image.Parameters[index].Default = tack2aiChoice(param)
		}
	}
	if tiers {
		set(3, size)
		set(4, ratio)
	} else {
		set(2, size)
		if openPixels {
			image.Parameters[2].Enabled = &enabled
			if value := tack2aiDeclaredString(size.Default); tack2aiPixels.MatchString(value) {
				image.Parameters[2].Default = value
			}
		}
	}
	return image, nil
}

func tack2aiVideoConfig(c *tack2aiContract) (*VideoCapabilityConfig, error) {
	p := c.Parameters
	if !tack2aiRequiredParamsSupported(p, "model", "prompt", "duration", "ratio", "resolution", "mode", "input") ||
		!tack2aiRequiredParamsSupported(p["parameters"].Properties) {
		return nil, errors.New("视频模型需要通用出口无法预填的必填参数")
	}
	d := p["duration"]
	duration := VideoDurationConfig{Selection: "range", Default: tack2aiInteger(d.Default), Step: 1}
	if d.Step != nil {
		duration.Step = tack2aiInteger(*d.Step)
		if duration.Step < 1 {
			return nil, errors.New("视频时长步长不是正整数")
		}
	}
	if len(d.Values) > 0 {
		duration.Selection = "enum"
		for _, raw := range d.Values {
			if value := tack2aiInteger(raw); value > 0 {
				duration.Values = append(duration.Values, value)
			}
		}
		if len(duration.Values) == 0 {
			return nil, errors.New("视频目录未声明可用固定时长")
		}
		if !slices.Contains(duration.Values, duration.Default) {
			duration.Default = duration.Values[0]
		}
	} else if d.Min != nil && d.Max != nil {
		duration.Min, duration.Max = tack2aiInteger(*d.Min), tack2aiInteger(*d.Max)
		if duration.Min < 1 || duration.Max < duration.Min {
			return nil, errors.New("视频固定时长范围无效")
		}
		if duration.Default < duration.Min || duration.Default > duration.Max {
			duration.Default = duration.Min
		}
	} else {
		return nil, errors.New("视频目录未声明可用固定时长")
	}
	modes := tack2aiStrings(p["mode"].Values)
	var operations []string
	for _, op := range []string{"text_to_video", "image_to_video", "reference_to_video", "audio_to_video"} {
		switch op {
		case "image_to_video":
			if slices.Contains(modes, op) || slices.Contains(modes, "first_last_frame") {
				operations = append(operations, op)
			}
		case "reference_to_video", "audio_to_video":
			if slices.Contains(modes, "multi_ref") && (op != "audio_to_video" || c.Inputs.Audios.Max > 0) {
				operations = append(operations, op)
			}
		default:
			if slices.Contains(modes, op) {
				operations = append(operations, op)
			}
		}
	}
	if len(operations) == 0 || p["resolution"].required() && len(p["resolution"].Values) == 0 || p["ratio"].required() && len(p["ratio"].Values) == 0 {
		return nil, errors.New("视频目录缺少可用的生成模式或输出规格")
	}
	contract, err := tack2aiVideoCapability(c, modes)
	if err != nil {
		return nil, err
	}
	return &VideoCapabilityConfig{
		References: VideoReferenceConfig{PromptMaxChars: tack2aiPromptLimit(p["prompt"]), MaxImages: c.Inputs.Images.Max, MaxVideos: c.Inputs.Videos.Max, MaxAudios: c.Inputs.Audios.Max, MaxTotalItems: c.References.Total},
		Duration:   duration, Operations: operations, DefaultOperation: operations[0],
		Ratios: tack2aiStrings(p["ratio"].Values), DefaultRatio: tack2aiStringChoice(p["ratio"]),
		Resolutions: tack2aiStrings(p["resolution"].Values), DefaultResolution: tack2aiStringChoice(p["resolution"]),
		Tack2AI: contract,
	}, nil
}

func tack2aiAudioConfig(c *tack2aiContract) (*AudioCapabilityConfig, error) {
	p := c.Parameters
	voice, format := p["voice"], p["response_format"]
	if !tack2aiRequiredParamsSupported(p, "model", "input", "voice", "response_format", "speed", "instructions") {
		return nil, errors.New("语音模型含无法预填的必填参数")
	}
	cfg := &AudioCapabilityConfig{
		VoiceDefault: tack2aiDeclaredString(voice.Default), Voices: tack2aiStrings(voice.Values),
		VoiceRequired: voice.required() || voice.RequiresSelection, Formats: tack2aiStrings(format.Values), FormatDefault: tack2aiDeclaredString(format.Default),
		MaxInputChars: p["input"].MaxLength, SpeedMin: p["speed"].Min, SpeedMax: p["speed"].Max,
	}
	_, cfg.InstructionsSupported = p["instructions"]
	_, cfg.SpeedSupported = p["speed"]
	refs, supportsRefs := p["metadata"].Properties["references"]
	if supportsRefs && refs.Items != nil {
		_, audioURL := refs.Items.Properties["audio_url"]
		_, audioData := refs.Items.Properties["audio_data"]
		_, imageURL := refs.Items.Properties["image_url"]
		_, imageData := refs.Items.Properties["image_data"]
		if audioURL && audioData {
			cfg.MaxAudios = c.Inputs.Audios.Max
		}
		if imageURL && imageData {
			cfg.MaxImages = c.Inputs.Images.Max
		}
		if cfg.MaxImages+cfg.MaxAudios > 0 {
			cfg.ReferenceEncoding = "metadata.references"
			if c.References.Total != nil {
				cfg.MaxReferences = *c.References.Total
			} else {
				cfg.MaxReferences = refs.MaxItems
				if cfg.MaxReferences == 0 && (refs.MutuallyExclusive || cfg.MaxImages == 0 || cfg.MaxAudios == 0) {
					cfg.MaxReferences = max(cfg.MaxImages, cfg.MaxAudios)
				}
			}
			if cfg.MaxReferences < 1 {
				return nil, errors.New("语音目录未声明参考素材总数")
			}
		}
	}
	return cfg, nil
}

func tack2aiRequiredParamsSupported(parameters map[string]tack2aiParameter, supported ...string) bool {
	for key, declaration := range parameters {
		if declaration.required() && !slices.Contains(supported, key) {
			return false
		}
	}
	return true
}

func tack2aiPromptLimit(prompt tack2aiParameter) int {
	if prompt.MaxLength > 0 {
		return prompt.MaxLength
	}
	return DefaultVideoPromptMaxChars // 宿主安全阈值，不是对上游未声明能力的推断。
}

func tack2aiDeclaredString(value any) string {
	text, _ := value.(string)
	return strings.TrimSpace(text)
}

func tack2aiStrings(values []any) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if s := tack2aiDeclaredString(value); s != "" && !slices.Contains(result, s) {
			result = append(result, s)
		}
	}
	return result
}

func tack2aiStringChoice(p tack2aiParameter) string { return tack2aiDeclaredString(tack2aiChoice(p)) }
func tack2aiChoice(p tack2aiParameter) any {
	values := tack2aiStrings(p.Values)
	initial := tack2aiDeclaredString(p.Default)
	if slices.Contains(values, initial) {
		return initial
	}
	if len(values) > 0 {
		return values[0]
	}
	return nil
}

func tack2aiInteger(value any) int {
	v, ok := value.(float64)
	if !ok || v <= 0 || v > 3600 || v != float64(int(v)) {
		return 0
	}
	return int(v)
}

func tack2aiBool(value bool) *bool { return &value }
