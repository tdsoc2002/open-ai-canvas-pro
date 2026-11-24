package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func (s *Service) TeamWorkspaceTask(actorID, teamID string, req CreateTaskRequest, quoteOnly bool) (any, error) {
	if err := s.RequireFeature(FeatureTeams); err != nil {
		return nil, err
	}
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return nil, err
	}
	member, err := s.requireTeamMember(actorID, teamID, false)
	if err != nil {
		return nil, err
	}
	mode := stringValue(req.Input["mode"])
	if !teamGenerationOperation(mode, req.Type, req.Operation) || req.Input["agentRequests"] != nil || taskInputUsesWorkflowProvider(req.Input) {
		return nil, BadAuthRequest("当前空间仅开放系统模型的文本、图片和视频生成")
	}
	storageKey := model.TeamContentKey(teamID)
	canvasID := req.ProjectID
	if canvasID != "" {
		if _, err := s.repo.CanvasProjectMetadataForUser(storageKey, canvasID); err != nil {
			return nil, teamNotFound(err)
		}
	}
	var id, digest string
	if !quoteOnly {
		if strings.TrimSpace(req.IdempotencyKey) == "" || len(req.IdempotencyKey) > 160 || req.MaxChargeMicrocredits == nil || *req.MaxChargeMicrocredits < 0 {
			return nil, BadAuthRequest("请确认积分上限并提供提交标识")
		}
		identity := sha256.Sum256([]byte(member.ID + "\x00" + req.IdempotencyKey))
		id = hex.EncodeToString(identity[:16])
		raw, err := json.Marshal(req)
		if err != nil {
			return nil, err
		}
		hash := sha256.Sum256(raw)
		digest = hex.EncodeToString(hash[:])
		if saved, err := s.repo.TaskForUser(storageKey, id); err == nil {
			if saved.SubmissionHash != digest {
				return nil, BadAuthRequest("同一提交标识不能修改生成参数")
			}
			return taskForOutput(*saved), nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}
	req.Input, err = s.teamGenerationInput(storageKey, mode, req)
	if err != nil {
		return nil, err
	}
	req.ProjectID = ""
	req.contentOwnerID = storageKey
	prepared := &creationTaskPreparation{}
	req.creationPrepare = prepared
	task, err := s.CreateTask(actorID, req)
	if err != nil {
		return nil, err
	}
	order := prepared.Order
	if order == nil || order.Capability != mode || !repository.SupportsTeamGenerationBilling(order.Capability, order.BillingMode) {
		return nil, BadAuthRequest("模型不支持团队积分封顶")
	}
	if mode != "text" {
		if err := s.validateTeamGenerationMediaTransport(task); err != nil {
			return nil, err
		}
	}
	if quoteOnly {
		return map[string]int64{"maxChargeMicrocredits": order.AmountMicrocredits}, nil
	}
	if order.AmountMicrocredits > *req.MaxChargeMicrocredits {
		reason := ErrorReason("team_generation_quote_changed")
		if mode == "text" {
			reason = "team_text_quote_changed"
		}
		return nil, teamError(409, reason, "当前报价超过已确认上限，请重新报价")
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return nil, err
	}
	if err := s.protectTaskSecrets(input); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	task.InputJSON = string(encoded)
	task.ID, task.SubmissionHash, task.ProjectID, task.BillingOrderID = id, digest, canvasID, order.ID
	task.AuthorizedChargeMicrocredits = order.AmountMicrocredits
	order.TaskID, order.IdempotencyKey, order.TeamID, order.MembershipID = id, "task:"+id, teamID, member.ID
	order.Scene, order.BillingAccountID, order.ChargeLimitSet, order.ChargeLimitMicrocredits = "team_"+mode, model.TeamMemberCreditAccountID(member.ID), true, order.AmountMicrocredits
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	if err := s.createTaskWithinStorageQuota(task, order, policy); err != nil {
		if saved, lookupErr := s.repo.TaskForUser(storageKey, id); lookupErr == nil && saved.SubmissionHash == digest {
			return taskForOutput(*saved), nil
		}
		if errors.Is(err, repository.ErrInsufficientCredits) {
			return nil, teamError(409, "team_credits_insufficient", "当前团队可用额度不足")
		}
		return nil, teamWalletError(err)
	}
	return taskForOutput(*task), nil
}

func (s *Service) validateTeamGenerationMediaTransport(task *model.Task) error {
	var input canvasGenerationInput
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return err
	}
	if len(input.ReferenceImages)+len(input.ReferenceVideos)+len(input.ReferenceAudios) == 0 && input.Mask == nil {
		return nil
	}
	config, err := s.resolveProviderConfig(input.Config)
	if err != nil {
		return err
	}
	input.Config = config
	ctx := withProtocolRegistry(context.Background(), s.protocolRegistry())
	if err := validateReferenceTransportProtocol(ctx, input); err != nil {
		return BadAuthRequest(err.Error())
	}
	policy := providerMediaHydrationPolicyFor(ctx, input)
	for _, group := range []struct {
		count     int
		transport string
		mask      bool
	}{
		{len(input.ReferenceImages), config.mediaTransport.Image, input.Mask != nil},
		{len(input.ReferenceVideos), config.mediaTransport.Video, false},
		{len(input.ReferenceAudios), config.mediaTransport.Audio, false},
	} {
		if group.count == 0 {
			continue
		}
		mediaPolicy, err := referenceMediaPolicy(policy, group.transport, group.mask)
		if err != nil {
			return BadAuthRequest(err.Error())
		}
		if mediaPolicy.requireURL {
			return BadAuthRequest("当前模型要求公网参考地址，请选择支持团队私有素材的模型")
		}
	}
	return nil
}

func teamGenerationOperation(mode, taskType, operation string) bool {
	if taskType != "canvas_"+mode {
		return false
	}
	switch mode {
	case "text", "image":
		return operation == mode
	case "video":
		switch operation {
		case "text_to_video", "image_to_video", "reference_to_video", "audio_to_video":
			return true
		}
	}
	return false
}

func (s *Service) teamGenerationInput(owner, mode string, req CreateTaskRequest) (map[string]any, error) {
	config, _ := req.Input["config"].(map[string]any)
	channelID := strings.TrimSpace(stringValue(config["channelId"]))
	if req.LogicalModelID == "" && channelID == "" {
		return nil, BadAuthRequest("请选择系统模型")
	}
	selected := map[string]any{"channelId": channelID, "model": stringValue(config["model"]), "priceTierId": stringValue(config["priceTierId"])}
	metadata, _ := req.Input["metadata"].(map[string]any)
	context := make(map[string]any)
	for _, key := range []string{"conversationId", "messageId", "nodeId", "sourceNodeId", "clientOperationId", "attemptGroupId", "assetTitle"} {
		if value, ok := metadata[key].(string); ok {
			context[key] = value
		}
	}
	if metadata["source"] == "create-page" {
		context["source"] = "create-page"
	}
	input := map[string]any{"mode": mode, "prompt": req.Prompt, "config": selected, "metadata": context}
	for _, field := range []struct{ key, kind string }{{"referenceImages", "image"}, {"referenceVideos", "video"}, {"referenceAudios", "audio"}} {
		raw := req.Input[field.key]
		if raw == nil {
			continue
		}
		list, ok := raw.([]any)
		if !ok || (len(list) > 0 && (mode == "text" || (mode == "image" && field.kind != "image"))) {
			return nil, BadAuthRequest("当前生成模式不支持这类参考素材")
		}
		refs := make([]map[string]any, 0, len(list))
		for _, item := range list {
			ref, err := s.teamGenerationReference(owner, field.kind, item)
			if err != nil {
				return nil, err
			}
			refs = append(refs, ref)
		}
		input[field.key] = refs
	}
	if mode == "text" {
		const outputBudget = 1024
		options, _ := req.Input["textOptions"].(map[string]any)
		input["maxOutputTokens"], input["textHistory"] = outputBudget, req.Input["textHistory"]
		input["textOptions"] = map[string]any{"maxOutputTokens": outputBudget, "stream": options["stream"], "thinkingLevel": options["thinkingLevel"]}
		return input, nil
	}
	for _, key := range []string{"size", "quality", "imageResolution", "imageParameters", "transparentBackground", "count", "videoSeconds", "vquality", "videoGenerateAudio", "videoWatermark"} {
		if value, ok := config[key]; ok {
			selected[key] = value
		}
	}
	for _, key := range []string{"batchIndex", "batchCount"} {
		if value, ok := metadata[key].(float64); ok {
			context[key] = value
		}
	}
	if options, ok := req.Input["capabilityOptions"].(map[string]any); ok {
		input["capabilityOptions"] = options
	}
	if mode == "video" {
		context["videoEditOperation"] = req.Operation
		selected["videoArkPrivateAssetUpload"] = "false"
	} else if raw := req.Input["mask"]; raw != nil {
		mask, err := s.teamGenerationReference(owner, "image", raw)
		if err != nil {
			return nil, err
		}
		input["mask"] = mask
	}
	return input, nil
}

func (s *Service) teamGenerationReference(owner, kind string, raw any) (map[string]any, error) {
	ref, _ := raw.(map[string]any)
	key := stringValue(ref["storageKey"])
	id, ok := strings.CutPrefix(key, "resource:")
	if !ok || validCanvasResourceID(id) != id || id == "" {
		return nil, BadAuthRequest("参考素材需要先上传到当前团队")
	}
	resource, err := s.repo.ResourceForUser(owner, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("当前团队中找不到该参考素材")
	}
	if err != nil {
		return nil, err
	}
	if resource.Status != model.ResourceStatusReady || !strings.HasPrefix(strings.ToLower(resource.MimeType), kind+"/") {
		return nil, BadAuthRequest("参考素材类型不匹配或尚未就绪")
	}
	return map[string]any{
		"storageKey": key, "id": id, "name": stringValue(ref["name"]), "type": resource.MimeType, "mimeType": resource.MimeType,
		"bytes": resource.Size, "width": resource.Width, "height": resource.Height, "durationMs": resource.DurationMs,
		"role": stringValue(ref["role"]), "slotKey": stringValue(ref["slotKey"]),
	}, nil
}

func (s *Service) taskModelActor(task *model.Task) (string, error) {
	teamID, team := model.TeamIDFromContentKey(task.UserID)
	if !team {
		return task.UserID, nil
	}
	order, err := s.repo.BillingOrder(task.BillingOrderID)
	if err != nil {
		return "", err
	}
	if order.TaskID != task.ID || order.TeamID != teamID || order.UserID == "" {
		return "", repository.ErrTeamWalletForbidden
	}
	return order.UserID, nil
}

func (s *Service) authorizeQueuedTeamTask(task *model.Task, teamID string) error {
	if err := s.RequireFeature(FeatureTeams); err != nil {
		return err
	}
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return err
	}
	order, err := s.repo.BillingOrder(task.BillingOrderID)
	if err != nil {
		return err
	}
	member, err := s.requireTeamMember(order.UserID, teamID, false)
	if err != nil {
		return err
	}
	if order.TeamID != teamID || member.ID != order.MembershipID {
		return repository.ErrTeamWalletForbidden
	}
	return nil
}
