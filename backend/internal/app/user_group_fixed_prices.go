package app

import (
	"reflect"
	"slices"

	"yingce/backend/internal/imagebilling"
	"yingce/backend/internal/model"
)

type groupFixedPriceTarget struct {
	logicalModelID string
	channelModelID string
	priceTierID    string
}

func fixedPriceTarget(price *model.UserGroupFixedPrice) groupFixedPriceTarget {
	return groupFixedPriceTarget{price.LogicalModelID, price.ChannelModelID, price.PriceTierID}
}

func fixedOverridesByTarget(overrides []model.UserGroupModelOverride) map[groupFixedPriceTarget]model.UserGroupModelOverride {
	byTarget := make(map[groupFixedPriceTarget]model.UserGroupModelOverride)
	for _, item := range overrides {
		if item.FixedPrice != nil {
			byTarget[fixedPriceTarget(item.FixedPrice)] = item
		}
	}
	return byTarget
}

func (s *Service) validateFixedPriceTargets(overrides, previous []model.UserGroupModelOverride) error {
	var logicalPrices, channelPrices []*model.UserGroupModelOverride
	var channelModelIDs []string
	existing := fixedOverridesByTarget(previous)
	for index := range overrides {
		item := &overrides[index]
		if item.FixedPrice == nil {
			continue
		}
		target := fixedPriceTarget(item.FixedPrice)
		if saved, ok := existing[target]; ok && reflect.DeepEqual(saved.FixedPrice, item.FixedPrice) {
			// 价格档可能已删除或调整计费方式，原样保留不影响其他分组字段保存。
			item.ModelKey = saved.ModelKey
			continue
		}
		switch {
		case target.logicalModelID != "" && target.channelModelID == "" && target.priceTierID == "":
			logicalPrices = append(logicalPrices, item)
		case target.logicalModelID == "" && target.channelModelID != "" && target.priceTierID != "":
			channelPrices = append(channelPrices, item)
			channelModelIDs = append(channelModelIDs, target.channelModelID)
		default:
			return BadAuthRequest("专属单价必须指定一个前台统一价模型或一个系统渠道价格档")
		}
	}
	if len(logicalPrices) > 0 {
		models, err := s.repo.LogicalModels(true)
		if err != nil {
			return err
		}
		byID := make(map[string]model.LogicalModel, len(models))
		for _, item := range models {
			byID[item.ID] = item
		}
		for _, override := range logicalPrices {
			item := byID[override.FixedPrice.LogicalModelID]
			if item.PricePolicy != "unified" {
				return BadAuthRequest("专属单价关联的前台统一价模型不存在")
			}
			if err := validateFixedPrice(override.FixedPrice, item.Capability, item.BillingMode, item.ImagePricing, false); err != nil {
				return err
			}
			override.ModelKey = item.Code
		}
	}
	if len(channelPrices) == 0 {
		return nil
	}
	models, err := s.repo.ChannelModelsByIDs(uniqueNonEmpty(channelModelIDs))
	if err != nil {
		return err
	}
	byID := make(map[string]model.ChannelModel, len(models))
	channelIDs := make([]string, 0, len(models))
	for _, item := range models {
		byID[item.ID] = item
		channelIDs = append(channelIDs, item.ChannelID)
	}
	channels, err := s.repo.SystemChannelsByIDs(channelIDs, true)
	if err != nil {
		return err
	}
	systemChannels := make(map[string]bool, len(channels))
	for _, channel := range channels {
		systemChannels[channel.ID] = true
	}
	for _, override := range channelPrices {
		price := override.FixedPrice
		item := byID[price.ChannelModelID]
		index := slices.IndexFunc(item.PriceTiers, func(tier model.ChannelModelPriceTier) bool { return tier.ID == price.PriceTierID })
		if !systemChannels[item.ChannelID] || index < 0 {
			return BadAuthRequest("专属单价关联的系统渠道价格档不存在")
		}
		tier := &item.PriceTiers[index]
		if !tier.PriceConfigured {
			return BadAuthRequest("请先配置该规格的基础价格和计费方式")
		}
		if err := validateFixedPrice(price, item.Capability, tier.BillingMode, tier.ImagePricing, fixedReferencePriceApplies(&item, tier.BillingMode)); err != nil {
			return err
		}
		override.ModelKey = item.ModelKey
	}
	return nil
}

type groupFixedPriceChange struct {
	Before *model.UserGroupModelOverride `json:"before,omitempty"`
	After  *model.UserGroupModelOverride `json:"after,omitempty"`
}

func fixedPriceChanges(before, after []model.UserGroupModelOverride) []groupFixedPriceChange {
	old := fixedOverridesByTarget(before)
	var changes []groupFixedPriceChange
	for _, item := range after {
		if item.FixedPrice == nil {
			continue
		}
		target := fixedPriceTarget(item.FixedPrice)
		previous, exists := old[target]
		delete(old, target)
		switch {
		case !exists:
			changes = append(changes, groupFixedPriceChange{After: &item})
		case !reflect.DeepEqual(previous.FixedPrice, item.FixedPrice):
			changes = append(changes, groupFixedPriceChange{Before: &previous, After: &item})
		}
	}
	for _, item := range before {
		if item.FixedPrice != nil {
			if _, removed := old[fixedPriceTarget(item.FixedPrice)]; removed {
				changes = append(changes, groupFixedPriceChange{Before: &item})
			}
		}
	}
	return changes
}

func validateFixedPrice(price *model.UserGroupFixedPrice, capability, mode string, image *model.ImagePricing, reference bool) error {
	if !fixedPriceMatches(price, capability, mode, image, reference) {
		return BadAuthRequest("请按模型计费方式和用量档位填写全部专属单价")
	}
	for _, value := range []*int64{price.Unit, price.Input, price.Output, price.Cached, price.CacheWrite, price.Reference} {
		if value != nil && (*value < 0 || *value > maxChannelModelTokenPriceMicrocredits) {
			return BadAuthRequest("专属单价必须在 0 至 100 万积分之间")
		}
	}
	if mode == imagebilling.Mode {
		if err := imagebilling.Validate(price.ImagePricing); err != nil {
			return BadAuthRequest(err.Error())
		}
	}
	return nil
}

func fixedPriceMatches(price *model.UserGroupFixedPrice, capability, mode string, image *model.ImagePricing, reference bool) bool {
	if price.BillingMode != mode || (price.Reference != nil) != reference {
		return false
	}
	hasTextPrices := price.Input != nil || price.Cached != nil || price.CacheWrite != nil
	switch mode {
	case "fixed_request", "per_second", model.BillingModeMinimaxH3:
		return price.Unit != nil && price.Output == nil && !hasTextPrices && price.ImagePricing == nil
	case "token":
		tokenFieldsComplete := capability == "video" && !hasTextPrices ||
			capability != "video" && price.Input != nil && price.Cached != nil && price.CacheWrite != nil
		return price.Unit == nil && price.Output != nil && tokenFieldsComplete && price.ImagePricing == nil
	case imagebilling.Mode:
		if price.Unit != nil || price.Output != nil || hasTextPrices || image == nil || price.ImagePricing == nil || image.FreeInputImages != price.ImagePricing.FreeInputImages {
			return false
		}
		return slices.EqualFunc(image.OutputTiers, price.ImagePricing.OutputTiers, func(a, b model.ImagePriceTier) bool { return a.MaxPixels == b.MaxPixels })
	default:
		return false
	}
}

func fixedReferencePriceApplies(item *model.ChannelModel, mode string) bool {
	return item.Capability == "video" && item.ReferenceVideoBilling && (mode == "per_second" || mode == "token")
}

func fixedAmount(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}

func (a *userGroupAccess) fixedGroupPricing() groupPricing {
	return groupPricing{GroupCode: a.groupCode(), Currency: model.PriceCurrencyCredits, RateMicrocredits: CreditScale, MultiplierBPS: 10000}
}

func (a *userGroupAccess) canPriceChannelTier(item *model.ChannelModel, tier *model.ChannelModelPriceTier) bool {
	if fixed, err := a.fixedChannelTierPricing(item, tier); err != nil || fixed != nil {
		return err == nil
	}
	_, err := a.pricing(item.PriceCurrency, item.ModelKey)
	return err == nil
}

func (a *userGroupAccess) fixedChannelPrice(modelID, tierID string) *model.UserGroupFixedPrice {
	return a.group.fixedPrices[groupFixedPriceTarget{channelModelID: modelID, priceTierID: tierID}]
}

// fixedChannelTierPricing 提供积分单价的副本，保留渠道原价档作为成本和规格快照。
func (a *userGroupAccess) fixedChannelTierPricing(item *model.ChannelModel, tier *model.ChannelModelPriceTier) (*model.ChannelModelPriceTier, error) {
	price := a.fixedChannelPrice(item.ID, tier.ID)
	if price == nil {
		return nil, nil
	}
	if !fixedPriceMatches(price, item.Capability, tier.BillingMode, tier.ImagePricing, fixedReferencePriceApplies(item, tier.BillingMode)) {
		return nil, ModelPriceNotConfigured("模型计费规则已变更，请联系管理员更新分组专属单价")
	}
	result := *tier
	result.UnitPriceMicrocredits = fixedAmount(price.Unit)
	result.InputTokenPriceMicrocredits = fixedAmount(price.Input)
	result.OutputTokenPriceMicrocredits = fixedAmount(price.Output)
	result.CachedTokenPriceMicrocredits = fixedAmount(price.Cached)
	result.CacheWriteTokenPriceMicrocredits = fixedAmount(price.CacheWrite)
	result.ReferenceVideoUnitPriceMicrocredits = 0
	result.ReferenceVideoOutputTokenPriceMicrocredits = 0
	if tier.BillingMode == "per_second" {
		result.ReferenceVideoUnitPriceMicrocredits = fixedAmount(price.Reference)
	} else if tier.BillingMode == "token" {
		result.ReferenceVideoOutputTokenPriceMicrocredits = fixedAmount(price.Reference)
	}
	result.ImagePricing = price.ImagePricing
	result.TokenPriceRulesEnabled = false
	result.TokenPriceRules = nil
	return &result, nil
}

func (a *userGroupAccess) logicalGroupPrice(item model.LogicalModel) (model.LogicalModel, groupPricing, error) {
	price := a.group.fixedPrices[groupFixedPriceTarget{logicalModelID: item.ID}]
	if price == nil {
		pricing, err := a.pricing(model.PriceCurrencyCredits, item.Code)
		return item, pricing, err
	}
	if !fixedPriceMatches(price, item.Capability, item.BillingMode, item.ImagePricing, false) {
		return item, groupPricing{}, ModelPriceNotConfigured("模型计费规则已变更，请联系管理员更新分组专属单价")
	}
	item.UnitPriceMicrocredits = fixedAmount(price.Unit)
	item.InputPriceMicrocredits = fixedAmount(price.Input)
	item.OutputPriceMicrocredits = fixedAmount(price.Output)
	item.CachedPriceMicrocredits = fixedAmount(price.Cached)
	item.CacheWritePriceMicrocredits = fixedAmount(price.CacheWrite)
	item.ImagePricing = price.ImagePricing
	return item, a.fixedGroupPricing(), nil
}
