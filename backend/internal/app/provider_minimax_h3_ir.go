package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

// enhanceMinimaxH3Prompt reuses the validated video payload so IR receives the same media roles and order.
func enhanceMinimaxH3Prompt(ctx context.Context, config providerConfig, adapter protocol.Adapter, request protocol.GenerationRequest, spec protocol.RequestSpec, policy videoPollPolicy) (string, error) {
	if adapter.Metadata().ID != string(model.ChannelInterfaceMiniMaxVideo) || !strings.EqualFold(request.Model, "MiniMax-H3") || spec.Path != "/v2/video_generation" {
		return "", errors.New("当前协议和上游型号不支持 MiniMax H3 Context-IR")
	}
	if err := validateMinimaxH3IRDuration(int64(request.Duration)); err != nil {
		return "", err
	}
	videoBody := protocolBodyObject(spec.Body)
	content, _ := videoBody["content"].([]any)
	if len(content) == 0 || protocolBodyObject(content[0])["type"] != "text" {
		return "", errors.New("MiniMax H3 创建请求缺少可增强的提示词")
	}
	var frames, references bool
	for _, block := range content[1:] {
		switch protocolBodyObject(block)["role"] {
		case "first_frame", "last_frame":
			frames = true
		case "reference_image", "reference_video", "reference_audio":
			references = true
		default:
			return "", BadAuthRequest("Context-IR 素材必须使用首尾帧或参考图、视频、音频角色")
		}
	}
	if frames && references {
		return "", BadAuthRequest("Context-IR 的首尾帧与多模态参考素材不能混用")
	}
	irSpec := protocol.RequestSpec{
		Method: spec.Method, Path: "/v2/h3_context_ir", OriginPath: spec.OriginPath,
		Auth: spec.Auth, Headers: spec.Headers, ContentType: "application/json",
		Body: map[string]any{"model": "MiniMax-H3", "content": content, "duration": videoBody["duration"], "ratio": videoBody["ratio"]},
	}
	body, err := executeProtocolRequest(withProviderRequestKind(ctx, "ir-create"), config, irSpec)
	if err != nil {
		return "", fmt.Errorf("提交 MiniMax H3 Context-IR 失败：%w", err)
	}
	id, err := extractProviderTaskID(body)
	if err != nil || strings.TrimSpace(id) == "" {
		return "", errors.New("MiniMax H3 Context-IR 提交未返回任务 ID，请核对上游状态")
	}
	pollSpec, err := adapter.BuildPoll(ctx, protocol.PollContext{BaseURL: config.BaseURL, Model: request.Model, Request: request, TaskID: id})
	if err != nil {
		return "", fmt.Errorf("构建 Context-IR 查询失败（%s）：%w", id, err)
	}
	// IR is a short preflight within the current attempt; its ID must never become the video recovery ID.
	policy.InitialDelay = 0
	policy.Interval = min(policy.Interval, 3*time.Second)
	policy.Notify = nil
	var prompt string
	_, err = runVideoPollLoop(ctx, id, policy, func(ctx context.Context) (videoPollOutcome, error) {
		body, err := executeProtocolRequest(withProviderRequestKind(ctx, "ir-poll"), config, pollSpec)
		if err != nil {
			return videoPollOutcome{}, err
		}
		var result struct {
			Task struct {
				ID       string `json:"id"`
				Status   string `json:"status"`
				TaskType string `json:"task_type"`
				Content  struct {
					Prompt string `json:"prompt"`
				} `json:"content"`
			} `json:"task"`
		}
		if err := json.Unmarshal(body, &result); err != nil {
			return videoPollOutcome{}, fmt.Errorf("解析 Context-IR 状态失败：%w", err)
		}
		if result.Task.ID != id || result.Task.TaskType != "h3_context_ir" {
			return videoPollOutcome{}, errors.New("MiniMax 返回了不匹配的 Context-IR 任务")
		}
		switch result.Task.Status {
		case "queued", "running":
			return videoPollOutcome{}, nil
		case "succeeded":
			prompt = strings.TrimSpace(result.Task.Content.Prompt)
			if prompt == "" {
				return videoPollOutcome{}, errors.New("MiniMax H3 Context-IR 未返回增强提示词")
			}
			return videoPollOutcome{Done: true}, nil
		case "failed", "cancelled":
			return videoPollOutcome{}, fmt.Errorf("MiniMax H3 Context-IR 已失败或取消（%s）", id)
		default:
			return videoPollOutcome{}, errors.New("MiniMax H3 Context-IR 返回了未识别的任务状态")
		}
	})
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return "", fmt.Errorf("已提交 MiniMax H3 Context-IR（%s）：%w", id, err)
		}
		return "", routeDispatchUncertainError{fmt.Sprintf("已提交 MiniMax H3 Context-IR（%s）：%s", id, err)}
	}
	protocolBodyObject(content[0])["text"] = prompt
	return prompt, nil
}
