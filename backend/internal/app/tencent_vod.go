package app

import (
	"fmt"
	"net/url"
	"slices"
	"strconv"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound"
	"yingce/backend/internal/protocol"
)

const tencentVODBaseURL = "https://vod.tencentcloudapi.com"

// Stored in administrator-only channel metadata. Never forwarded as an HTTP header.
const tencentVODAppIDHeader = "X-Lj-Tencent-Vod-App-Id"

func isTencentVODBaseURL(value string) bool {
	return strings.TrimSuffix(strings.TrimSpace(value), "/") == tencentVODBaseURL
}

func splitTencentVODChannelHeaders(headers []OutboundHeader) ([]OutboundHeader, int64, error) {
	original := make([]OutboundHeader, 0, len(headers))
	var appID int64
	for _, header := range headers {
		if !strings.EqualFold(strings.TrimSpace(header.Name), tencentVODAppIDHeader) {
			original = append(original, header)
			continue
		}
		n, err := strconv.ParseUint(strings.TrimSpace(header.Value), 10, 32)
		if err != nil || n == 0 || appID != 0 {
			return nil, 0, BadAuthRequest("请填写有效的腾讯云点播应用 ID")
		}
		appID = int64(n)
	}
	return original, appID, nil
}

func tencentVODModelVersion(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	for _, prefix := range []string{"vs-", "doubao-seedance-", "tencent-seedance-"} {
		value = strings.TrimPrefix(value, prefix)
	}
	for _, suffix := range []string{"-260128", "-260615", "-260628"} {
		value = strings.TrimSuffix(value, suffix)
	}
	value = strings.NewReplacer("2-0", "2.0", "2-5", "2.5").Replace(value)
	if !slices.Contains([]string{"2.0", "2.0-fast", "2.0-mini", "2.5"}, value) {
		return "", InvalidModelSelection("腾讯 VOD VS 仅支持 2.0、2.0-fast、2.0-mini 和 2.5")
	}
	return value, nil
}

func tencentVODLimits(version string) (seconds, images, videos, audios int, resolutions []string) {
	seconds, images, videos, audios = 15, 9, 3, 3
	resolutions = []string{"480P", "720P"}
	switch version {
	case "2.0":
		resolutions = append(resolutions, "1080P", "4K")
	case "2.5":
		seconds, images, videos, audios = 30, 30, 10, 10
		resolutions = append(resolutions, "1080P")
	}
	return
}

type tencentVODRequest struct {
	SubAppID     int64            `json:"SubAppId"`
	ModelName    string           `json:"ModelName"`
	ModelVersion string           `json:"ModelVersion"`
	Prompt       string           `json:"Prompt,omitempty"`
	Output       tencentVODOutput `json:"OutputConfig"`
	Files        []tencentVODFile `json:"FileInfos,omitempty"`
}

type tencentVODOutput struct {
	StorageMode     string `json:"StorageMode"`
	Duration        int    `json:"Duration"`
	Resolution      string `json:"Resolution"`
	AspectRatio     string `json:"AspectRatio"`
	AudioGeneration string `json:"AudioGeneration,omitempty"`
	LogoAdd         string `json:"LogoAdd,omitempty"`
}

type tencentVODFile struct {
	Category string `json:"Category"`
	Usage    string `json:"Usage"`
	Type     string `json:"Type"`
	URL      string `json:"Url"`
}

func setTencentVODRequestScope(config *providerConfig, request *protocol.GenerationRequest) error {
	if config.ChannelID == "" || config.tencentVODAppID <= 0 || !isTencentVODBaseURL(config.BaseURL) {
		return BadAuthRequest("腾讯 VOD 仅支持管理员设置应用 ID 的腾讯云官方系统渠道")
	}
	// User metadata and custom HTTP headers cannot choose the app or override Tencent's Action/Version.
	config.BaseURL, config.Headers = tencentVODBaseURL, nil
	if request.Extra == nil {
		request.Extra = map[string]any{}
	}
	request.Extra["tencentVodAppId"] = config.tencentVODAppID
	return nil
}

func prepareTencentVODRequest(config *providerConfig, request *protocol.GenerationRequest) error {
	if err := setTencentVODRequestScope(config, request); err != nil {
		return err
	}
	version, err := tencentVODModelVersion(request.Model)
	if err != nil {
		return err
	}
	maxSeconds, maxImages, maxVideos, maxAudios, resolutions := tencentVODLimits(version)
	duration := request.Duration
	if duration == 0 {
		raw := stringValue(request.Extra["videoSeconds"])
		if raw == "" || raw == "auto" || raw == "-1" {
			duration = -1
		} else {
			return InvalidModelSelection("腾讯 VOD VS 需要固定秒数或自动时长")
		}
	}
	if duration != -1 && (duration < 4 || duration > maxSeconds) {
		return InvalidModelSelection(fmt.Sprintf("该腾讯 VOD VS 模型仅支持 4–%d 秒或自动时长", maxSeconds))
	}
	resolution := strings.ToUpper(firstNonEmpty(request.Resolution, "720P"))
	if resolution == "AUTO" {
		resolution = "720P"
	}
	if !slices.Contains(resolutions, resolution) {
		return InvalidModelSelection("该腾讯 VOD VS 模型不支持所选分辨率")
	}
	ratio := strings.ToLower(firstNonEmpty(request.AspectRatio, "adaptive"))
	if ratio == "auto" {
		ratio = "adaptive"
	}
	if !slices.Contains([]string{"21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"}, ratio) {
		return InvalidModelSelection("腾讯 VOD VS 不支持所选画幅")
	}
	if len(request.Images) > maxImages || len(request.Videos) > maxVideos || len(request.Audios) > maxAudios {
		return InvalidModelSelection("参考素材数量超过该腾讯 VOD VS 模型的限制")
	}
	files, hasFrame, err := tencentVODFiles(request, maxSeconds)
	if err != nil {
		return err
	}
	if version == "2.5" && hasFrame && ratio != "adaptive" {
		return InvalidModelSelection("腾讯 VOD VS 2.5 使用首帧或首尾帧时须选择自适应画幅")
	}
	toggle := func(value bool, setting string) string {
		if value {
			return "Enabled"
		}
		if strings.TrimSpace(setting) != "" {
			return "Disabled"
		}
		return ""
	}
	prompt := strings.TrimSpace(request.Prompt)
	if prompt == "" && len(files) == 0 {
		return BadAuthRequest("请填写腾讯 VOD VS 视频提示词或添加参考素材")
	}
	request.Extra["tencentVod"] = tencentVODRequest{SubAppID: config.tencentVODAppID, ModelName: "VS", ModelVersion: version, Prompt: prompt,
		Output: tencentVODOutput{StorageMode: "Temporary", Duration: duration, Resolution: resolution, AspectRatio: ratio,
			AudioGeneration: toggle(request.GenerateAudio, config.VideoGenerateAudio), LogoAdd: toggle(request.Watermark, config.VideoWatermark)}, Files: files}
	return nil
}

func tencentVODFiles(request *protocol.GenerationRequest, maxSeconds int) ([]tencentVODFile, bool, error) {
	var files []tencentVODFile
	var first, last, references int
	for _, group := range []struct {
		category string
		items    []protocol.MediaReference
	}{{"Image", request.Images}, {"Video", request.Videos}, {"Audio", request.Audios}} {
		var total int64
		for i, item := range group.items {
			usage := "Reference"
			if group.category == "Image" {
				role := item.Role
				if role == "" {
					switch request.Operation {
					case "image_to_video":
						if len(request.Images) == 1 {
							role = "first_frame"
						}
					case "":
						if len(request.Images) == 1 && len(request.Videos) == 0 && len(request.Audios) == 0 {
							role = "first_frame"
						}
					case "first_last_frame":
						if len(request.Images) == 2 {
							role = []string{"first_frame", "last_frame"}[i]
						}
					}
				}
				switch role {
				case "first_frame":
					usage = "FirstFrame"
					first++
				case "last_frame":
					usage = "LastFrame"
					last++
				case "", "reference_image":
				default:
					return nil, false, InvalidModelSelection("不支持的腾讯 VOD 图片参考角色")
				}
			} else {
				duration, _ := strconv.ParseInt(fmt.Sprint(item.Metadata["durationMs"]), 10, 64)
				if duration < 2000 || duration > int64(maxSeconds)*1000 {
					return nil, false, InvalidModelSelection("腾讯 VOD 参考视频或音频时长未知或超出范围")
				}
				total += duration
			}
			if usage == "Reference" {
				references++
			}
			address, err := url.Parse(strings.TrimSpace(item.URL))
			if err != nil || address.Fragment != "" || outbound.ValidateTencentCOSBucketURL(address) != nil {
				return nil, false, InvalidModelSelection("腾讯 VOD 参考素材须提供可公网访问的 HTTP(S) 链接")
			}
			files = append(files, tencentVODFile{Category: group.category, Usage: usage, Type: "Url", URL: item.URL})
		}
		if total > int64(maxSeconds)*1000 {
			return nil, false, InvalidModelSelection("腾讯 VOD 同类参考素材的总时长超限")
		}
	}
	frames := first+last > 0
	bad := first > 1 || last > first || (frames && references > 0)
	switch request.Operation {
	case "":
	case "text_to_video":
		bad = bad || len(files) != 0
	case "image_to_video":
		// 乐见的画布共用图生视频操作；以显式尾帧角色区分首尾帧。
		bad = bad || first != 1
	case "first_last_frame":
		bad = bad || first != 1 || last != 1
	case "reference_to_video", "multi_ref", "audio_to_video":
		bad = bad || frames || references == 0
	default:
		return nil, false, InvalidModelSelection("该视频操作不在腾讯 VOD VS 直连支持范围内")
	}
	if bad {
		return nil, false, InvalidModelSelection("腾讯 VOD VS 的首尾帧与混合参考不能混用，尾帧必须有首帧")
	}
	return files, frames, nil
}

func isTencentVODProtocol(id string) bool {
	return id == string(model.ChannelInterfaceTencentVODVS) || id == tencentVODImageProtocol
}
