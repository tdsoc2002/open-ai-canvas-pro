package app

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"yingce/backend/internal/protocol"
)

const tencentVODImageProtocol = "tencent-vod-og"

func tencentVODImageFamily(model string) string {
	switch strings.ToLower(strings.TrimSpace(model)) {
	case "gpt-image-2", "tencent-image-2":
		return "image2"
	case "gpt-image-2.5-flare", "tencent-image-flare":
		return "image2.5_flare"
	case "gpt-image-2.5-sunburst", "tencent-image-sunburst":
		return "image2.5_sunburst"
	default:
		return ""
	}
}

func tencentVODImageVersion(model, quality string) (string, error) {
	family := tencentVODImageFamily(model)
	if family == "" {
		return "", InvalidModelSelection("腾讯 VOD OG 仅支持 GPT Image 2、2.5 Flare 和 2.5 Sunburst")
	}
	quality = strings.ToLower(strings.TrimSpace(quality))
	if quality == "" || quality == "auto" || quality == "standard" {
		quality = "medium"
	}
	allowed := []string{"low", "medium", "high"}
	if family != "image2" {
		allowed = append(allowed, "xhigh", "max")
	}
	if !slices.Contains(allowed, quality) {
		return "", InvalidModelSelection("当前腾讯 VOD 图片模型不支持该质量档")
	}
	return family + "_" + quality, nil
}

func tencentVODImageSize(raw string) (int, int, string, error) {
	w, h, ok := strings.Cut(strings.NewReplacer("×", "x", ",", "x").Replace(strings.ToLower(strings.TrimSpace(raw))), "x")
	width, wErr := strconv.Atoi(w)
	height, hErr := strconv.Atoi(h)
	if !ok || wErr != nil || hErr != nil || width < 1 || height < 1 || width > 3840 || height > 3840 ||
		width%16 != 0 || height%16 != 0 || width > 3*height || height > 3*width || width*height < 655_360 || width*height > 8_294_400 {
		return 0, 0, "", InvalidModelSelection("腾讯 VOD OG 尺寸须符合 16 像素对齐、3:1 和像素数限制")
	}
	switch pixels := width * height; {
	case pixels > 4_194_304:
		return width, height, "4K", nil
	case pixels > 1_048_576:
		return width, height, "2K", nil
	default:
		return width, height, "1K", nil
	}
}

func prepareTencentVODImageRequest(config *providerConfig, request *protocol.GenerationRequest) error {
	if err := setTencentVODRequestScope(config, request); err != nil {
		return err
	}
	version, err := tencentVODImageVersion(request.Model, request.Quality)
	if err != nil {
		return err
	}
	if request.ImageCount > 1 || len(request.Images) > 8 {
		return InvalidModelSelection("腾讯 VOD OG 当前每个任务仅生成一张图片，参考图含蒙版最多 8 张")
	}
	// The host's fixed-request image billing reserves one image per task.
	output := map[string]any{"StorageMode": "Temporary", "OutputImageCount": 1}
	additional := map[string]string{}
	size := strings.TrimSpace(request.AspectRatio)
	if size == "" || strings.EqualFold(size, "auto") {
		switch strings.ToUpper(strings.TrimSpace(request.Resolution)) {
		case "", "AUTO", "1K":
			size = "1024x1024"
		case "2K":
			size = "2048x2048"
		case "4K":
			size = "2880x2880"
		}
	}
	w, h, tier, err := tencentVODImageSize(size)
	if err != nil {
		return err
	}
	pricedTier := tencentVODImagePriceTier(w, h)
	if expected := strings.ToUpper(strings.TrimSpace(request.Resolution)); pricedTier == "" || (expected != "" && expected != "AUTO" && expected != pricedTier) {
		return InvalidModelSelection("腾讯 VOD OG 实际尺寸与计价分辨率不一致")
	}
	additional["size"] = fmt.Sprintf("%dx%d", w, h)
	output["Resolution"] = tier
	for _, ratio := range [][2]int{{1, 1}, {3, 2}, {2, 3}, {4, 3}, {3, 4}, {16, 9}, {9, 16}} {
		if w*ratio[1] == h*ratio[0] {
			output["AspectRatio"] = fmt.Sprintf("%d:%d", ratio[0], ratio[1])
			break
		}
	}
	if config.TransparentBackground == "true" {
		additional["background"] = "transparent"
	}
	output["OutputFormat"] = "png"
	files := make([]map[string]string, 0, len(request.Images))
	masks := 0
	for _, item := range request.Images {
		file, err := tencentVODImageFile(item)
		if err != nil {
			return err
		}
		if item.Role == "mask" {
			masks++
			file["ReferenceType"] = "mask"
		}
		files = append(files, file)
	}
	if masks > 1 || (masks == 1 && len(files) == 1) {
		return InvalidModelSelection("腾讯 VOD OG 蒙版编辑必须提供源图片和一张蒙版")
	}
	prompt := strings.TrimSpace(request.Prompt)
	if prompt == "" && len(files) == 0 {
		return BadAuthRequest("请填写图片提示词或添加参考图片")
	}
	params, _ := json.Marshal(additional)
	ext, _ := json.Marshal(map[string]string{"AdditionalParameters": string(params)})
	body := map[string]any{
		"SubAppId": config.tencentVODAppID, "ModelName": "OG", "ModelVersion": version,
		"Prompt": prompt, "OutputConfig": output, "ExtInfo": string(ext),
	}
	if len(files) > 0 {
		body["FileInfos"] = files
	}
	request.Extra["tencentVod"] = body
	return nil
}

// The source catalog's integer pixel presets define the sale tier. The VOD
// Resolution field above instead uses Tencent's native area boundaries.
var tencentVODImagePriceSizes = map[string][]string{
	"1K": {"1024x1024", "1536x864", "864x1536", "1536x1024", "1024x1536", "1024x768", "768x1024", "1280x1024", "1024x1280", "1568x672", "672x1568", "1536x768", "768x1536", "1536x512", "512x1536"},
	"2K": {"2048x2048", "2048x1152", "1152x2048", "2304x1536", "1536x2304", "2048x1536", "1536x2048", "2240x1792", "1792x2240", "3136x1344", "1344x3136", "2560x1280", "1280x2560", "3072x1024", "1024x3072"},
	"4K": {"2880x2880", "3840x2160", "2160x3840", "3456x2304", "2304x3456", "3264x2448", "2448x3264", "3200x2560", "2560x3200", "3808x1632", "1632x3808", "3840x1920", "1920x3840", "3840x1280", "1280x3840"},
}

func tencentVODImagePriceTier(width, height int) string {
	size := fmt.Sprintf("%dx%d", width, height)
	for tier, sizes := range tencentVODImagePriceSizes {
		if slices.Contains(sizes, size) {
			return tier
		}
	}
	return ""
}

func tencentVODImageFile(item protocol.MediaReference) (map[string]string, error) {
	if address := strings.TrimSpace(item.URL); address != "" {
		parsed, err := ValidateOutboundURL(address)
		if err == nil && parsed.Fragment == "" {
			return map[string]string{"Type": "Url", "Url": parsed.String()}, nil
		}
		return nil, InvalidModelSelection("腾讯 VOD OG 参考素材须为可公网访问的图片链接")
	}
	prefix, data, ok := strings.Cut(item.DataURL, ",")
	maxBytes := 7 * 1024 * 1024
	if ok && slices.Contains([]string{"data:image/png;base64", "data:image/jpeg;base64", "data:image/webp;base64"}, strings.ToLower(prefix)) &&
		data != "" && len(data) <= base64.StdEncoding.EncodedLen(maxBytes) {
		decoded, err := base64.StdEncoding.DecodeString(data)
		if err == nil && len(decoded) <= maxBytes {
			return map[string]string{"Type": "Base64", "Base64": data}, nil
		}
	}
	return nil, InvalidModelSelection("腾讯 VOD OG 内嵌图片须为不超过 7 MiB 的 PNG、JPEG 或 WebP")
}
