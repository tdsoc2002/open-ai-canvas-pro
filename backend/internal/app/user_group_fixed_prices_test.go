package app

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestUserGroupFixedPriceCatalogQuoteAndSettlement(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	policy := defaultCreditPolicy()
	policy.DefaultMultiplierBPS = 20_000
	if _, err := s.UpdateCreditPolicy(admin, policy); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ModelChannel{ID: "other-channel", Scope: model.ChannelScopeSystem, Enabled: true, Name: "其他渠道"}).Error; err != nil {
		t.Fatal(err)
	}
	original, err := s.repo.ChannelModel("cm")
	if err != nil {
		t.Fatal(err)
	}
	other := *original
	other.ID, other.ChannelID = "other-model", "other-channel"
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	otherTier := original.PriceTiers[0]
	otherTier.ID, otherTier.ChannelModelID = "other-tier", other.ID
	if err := db.Create(&otherTier).Error; err != nil {
		t.Fatal(err)
	}
	amount := int64(3_500_000)
	fixed := model.UserGroupModelOverride{FixedPrice: &model.UserGroupFixedPrice{ChannelModelID: "cm", PriceTierID: "tier", BillingMode: "fixed_request", Unit: &amount}}
	ratio := model.UserGroupModelOverride{ModelKey: "text-test", RatioBasisPoints: 5_000}
	req := UserGroupRequest{Code: "vip", Name: "VIP", RatioBasisPoints: 8_000, AllChannels: true, ModelOverrides: []model.UserGroupModelOverride{ratio, fixed}}
	group, err := s.CreateUserGroup(admin, req)
	if err != nil {
		t.Fatal(err)
	}
	if len(group.ModelOverrides) != 2 || group.ModelOverrides[1].FixedPrice == nil || *group.ModelOverrides[1].FixedPrice.Unit != amount {
		t.Fatalf("stored prices = %#v", group.ModelOverrides)
	}
	if _, err := s.UpdateUser(admin, "user", UpdateUserRequest{UserGroup: &group.Code}); err != nil {
		t.Fatal(err)
	}
	assertQuote := func(userID, channelID string, want int64) {
		t.Helper()
		quote, err := s.QuoteChannelModel(userID, ChannelModelQuoteRequest{ChannelID: channelID, ModelKey: "text-test", Intent: ModelRequestIntent{Capability: "text"}})
		if err != nil || quote.AmountMicrocredits != want {
			t.Fatalf("quote %s/%s = %#v, %v; want %d", userID, channelID, quote, err, want)
		}
	}
	assertQuote("user", "channel", amount)
	assertQuote("user", "other-channel", 80_000)
	assertQuote(testGroupUserID(s), "channel", 200_000)
	user, err := s.repo.User("user")
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := s.ModelCatalogForUser(user, nil)
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, channel := range catalog.Channels {
		if channel.ID == "channel" {
			found = len(channel.Models) == 1 && len(channel.Models[0].PriceTiers) == 1 && channel.Models[0].PriceTiers[0].UnitPriceMicrocredits == amount
		}
	}
	if !found {
		t.Fatalf("catalog did not publish fixed price: %#v", catalog.Channels)
	}
	order, err := s.newBillingOrder("user", "", "fixed-price-snapshot", "channel", "text-test", "text", "test", 1, tokenBillingEstimate{})
	if err != nil || order.UnitPriceMicrocredits != amount || order.MultiplierBasisPoints != 10_000 || order.UserGroup != "vip" {
		t.Fatalf("reserve price = %#v, %v", order, err)
	}
	if err := s.repo.ReserveBillingOrder(order); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range [][]model.UserGroupModelOverride{
		{fixed, fixed},
		{{FixedPrice: &model.UserGroupFixedPrice{ChannelModelID: "other-model", PriceTierID: "tier", BillingMode: "fixed_request", Unit: &amount}}},
		{{FixedPrice: &model.UserGroupFixedPrice{ChannelModelID: "cm", PriceTierID: "tier", BillingMode: "fixed_request"}}},
	} {
		req.ModelOverrides = invalid
		if _, err := s.UpdateUserGroup(admin, group.ID, req); err == nil {
			t.Fatalf("invalid prices accepted: %#v", invalid)
		}
	}
	req.ModelOverrides = []model.UserGroupModelOverride{ratio}
	if _, err := s.UpdateUserGroup(admin, group.ID, req); err != nil {
		t.Fatal(err)
	}
	assertQuote("user", "channel", 80_000)
	if err := s.repo.SettleBillingOrder(order.ID, "fixed-provider-request"); err != nil {
		t.Fatal(err)
	}
	account, err := s.repo.CreditAccount("user")
	if err != nil || account.AvailableMicrocredits != 10_000_000-amount || account.ReservedMicrocredits != 0 {
		t.Fatalf("account after settling saved price = %#v, %v", account, err)
	}
}

func TestUserGroupFixedPriceUnifiedVideoTokenQuoteAndOrder(t *testing.T) {
	s, db, _, cm, profile := newVideoTokenQuoteFixture(t)
	spec, err := CapabilitySpecFromModelCapabilityConfig(profile, "video")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(spec)
	if err != nil {
		t.Fatal(err)
	}
	item := model.LogicalModel{ID: "fixed-logical", Code: "fixed-video", Capability: "video", Enabled: true, ActiveRevisionID: "fixed-revision", PricePolicy: "unified", BillingMode: "token", OutputPriceMicrocredits: 16_000_000}
	revision := model.LogicalModelRevision{ID: item.ActiveRevisionID, LogicalModelID: item.ID, Version: 1, CapabilitySpecJSON: string(raw), DefaultOptionsJSON: `{"vquality":"720p","size":"16:9","videoSeconds":5,"videoGenerateAudio":true}`}
	route := model.LogicalModelRoute{ID: "fixed-route", LogicalModelRevisionID: revision.ID, ChannelModelID: cm.ID, Enabled: true, Weight: 1}
	if err := db.AutoMigrate(&model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{&item, &revision, &route} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	const userID = "quote-user"
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	price := int64(12_000_000)
	group, err := s.CreateUserGroup(admin, UserGroupRequest{Code: "vip", Name: "VIP", RatioBasisPoints: 5_000, AllChannels: true, ModelOverrides: []model.UserGroupModelOverride{
		{FixedPrice: &model.UserGroupFixedPrice{LogicalModelID: item.ID, BillingMode: "token", Output: &price}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.User{}).Where("id = ?", userID).Update("user_group", group.Code).Error; err != nil {
		t.Fatal(err)
	}
	quote, err := s.QuoteLogicalModel(userID, item.ID, ModelRequestIntent{Capability: "video"})
	if err != nil {
		t.Fatal(err)
	}
	_, input, err := s.resolveTaskModelSelection(userID, map[string]any{"mode": "video", "config": map[string]any{}}, item.ID, "canvas_video", "", true)
	if err != nil {
		t.Fatal(err)
	}
	order, err := s.taskBillingOrder(userID, &model.Task{ID: "fixed-task", Type: "canvas_video", LogicalModelID: item.ID, LogicalModelRevisionID: revision.ID, RouteID: route.ID, ChannelModelID: cm.ID}, input)
	if err != nil || order.OutputTokenPriceMicrocredits != price || order.MultiplierBasisPoints != 10_000 || order.AmountMicrocredits != quote.AmountMicrocredits {
		t.Fatalf("quote = %#v, order = %#v, err = %v", quote, order, err)
	}
	access, err := s.userGroupAccess(userID)
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := s.PublicLogicalModels(access, nil)
	if err != nil || len(catalog) != 1 || catalog[0].OutputPriceMicrocredits != price {
		t.Fatalf("catalog = %#v, err = %v", catalog, err)
	}
	item.Capability = "text"
	if _, _, err := access.logicalGroupPrice(item); err == nil {
		t.Fatal("video token prices were interpreted as text token prices after a capability change")
	}
}

func TestUserGroupChannelFixedPriceKeepsPricedVideoSpecAvailable(t *testing.T) {
	s, db, channel, cm, profile := newVideoTokenQuoteFixture(t)
	if err := db.AutoMigrate(&model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", cm.ID).Update("price_currency", model.PriceCurrencyUSD).Error; err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	price := int64(1_000_000)
	group, err := s.CreateUserGroup(admin, UserGroupRequest{Code: "vip", Name: "VIP", RatioBasisPoints: 5_000, AllChannels: true, ModelOverrides: []model.UserGroupModelOverride{
		{FixedPrice: &model.UserGroupFixedPrice{ChannelModelID: cm.ID, PriceTierID: "video-audio", BillingMode: "token", Output: &price}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.User{}).Where("id = ?", "quote-user").Update("user_group", group.Code).Error; err != nil {
		t.Fatal(err)
	}
	spec, err := CapabilitySpecFromModelCapabilityConfig(profile, "video")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(spec)
	if err != nil {
		t.Fatal(err)
	}
	item := model.LogicalModel{ID: "channel-priced-video", Code: "priced-video", Capability: "video", Enabled: true, ActiveRevisionID: "channel-price-revision", PricePolicy: "channel"}
	revision := model.LogicalModelRevision{ID: item.ActiveRevisionID, LogicalModelID: item.ID, Version: 1, CapabilitySpecJSON: string(raw), DefaultOptionsJSON: `{"vquality":"720p","size":"16:9","videoSeconds":5,"videoGenerateAudio":true}`}
	other := cm
	other.ID, other.ModelKey, other.PriceCurrency = "other-pricing-model", "other-pricing-video", model.PriceCurrencyUSD
	for _, row := range []any{
		&item, &revision, &other,
		&model.ChannelModelPriceTier{ID: "other-video-audio", ChannelModelID: other.ID, SelectorJSON: `{"videoGenerateAudio":"true"}`, SelectorKey: `{"videoGenerateAudio":"true"}`, BillingMode: "token", OutputTokenPriceMicrocredits: 16_000_000, PriceConfigured: true, Enabled: true},
		&model.LogicalModelRoute{ID: "priced-route", LogicalModelRevisionID: revision.ID, ChannelModelID: cm.ID, Enabled: true, Weight: 1},
		&model.LogicalModelRoute{ID: "unpriced-route", LogicalModelRevisionID: revision.ID, ChannelModelID: other.ID, Enabled: true, Weight: 1, Priority: 10},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	intent := ModelRequestIntent{Capability: "video", Options: map[string]any{"vquality": "720p", "size": "16:9", "videoSeconds": 5, "videoGenerateAudio": true}}
	channelQuote, err := s.QuoteChannelModel("quote-user", ChannelModelQuoteRequest{ChannelID: channel.ID, ModelKey: cm.ModelKey, Intent: intent})
	if err != nil {
		t.Fatal(err)
	}
	logicalQuote, err := s.QuoteLogicalModel("quote-user", item.ID, intent)
	if err != nil || logicalQuote.AmountMicrocredits != channelQuote.AmountMicrocredits {
		t.Fatalf("logical quote = %#v, err = %v; channel quote = %#v", logicalQuote, err, channelQuote)
	}
	user, err := s.repo.User("quote-user")
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := s.ModelCatalogForUser(user, &intent)
	if err != nil || len(catalog.Channels) != 1 || len(catalog.Channels[0].Models) != 1 || len(catalog.Channels[0].Models[0].PriceTiers) != 1 || catalog.Channels[0].Models[0].PriceTiers[0].OutputTokenPriceMicrocredits != price {
		t.Fatalf("catalog available = %#v, err = %v", catalog, err)
	}
	intent.Options["videoGenerateAudio"] = false
	catalog, err = s.ModelCatalogForUser(user, &intent)
	if err != nil || len(catalog.Channels) != 0 {
		t.Fatalf("unpriced spec was advertised: %#v, %v", catalog, err)
	}

	// 两条同优先级的线路都可结算时，报价和首次预留仍采用专属价。
	if err := db.Model(&model.LogicalModelRoute{}).Where("id = ?", "unpriced-route").Update("priority", 0).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModel{}).Where("id IN ?", []string{cm.ID, other.ID}).Update("price_currency", model.PriceCurrencyCredits).Error; err != nil {
		t.Fatal(err)
	}
	blockedModel := other
	blockedModel.ID, blockedModel.ModelKey, blockedModel.PriceCurrency = "blocked-model", "blocked-video", model.PriceCurrencyCredits
	for _, row := range []any{
		&blockedModel,
		&model.ChannelModelPriceTier{ID: "blocked-video-tier", ChannelModelID: blockedModel.ID, SelectorJSON: `{"videoGenerateAudio":"true"}`, SelectorKey: `{"videoGenerateAudio":"true"}`, BillingMode: "token", OutputTokenPriceMicrocredits: 16_000_000, PriceConfigured: true, Enabled: true},
		&model.LogicalModelRoute{ID: "blocked-route", LogicalModelRevisionID: revision.ID, ChannelModelID: blockedModel.ID, Enabled: true, Weight: 1, Priority: 10},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	s.routeHealthBlocked = map[string]time.Time{"route:blocked-route": time.Now().Add(time.Minute)}
	s.invalidateRouteCatalog()
	intent.Options["videoGenerateAudio"] = true
	for range 8 {
		quote, err := s.QuoteLogicalModel(user.ID, item.ID, intent)
		if err != nil {
			t.Fatal(err)
		}
		routed, input, err := s.resolveTaskModelSelection(user.ID, quoteInput(intent, item.Code), item.ID, "canvas_video", "", true)
		if err != nil {
			t.Fatal(err)
		}
		task := &model.Task{ID: "group-price-task", UserID: user.ID, Type: "canvas_video", LogicalModelID: item.ID, LogicalModelRevisionID: revision.ID, RouteID: routed.Route.ID, ChannelModelID: routed.ChannelModel.ID}
		order, err := s.taskBillingOrder(user.ID, task, input)
		if err != nil || routed.Route.ID != "priced-route" || quote.AmountMicrocredits != channelQuote.AmountMicrocredits || order.AmountMicrocredits != quote.AmountMicrocredits {
			t.Fatalf("quote = %#v, order = %#v, route = %s, err = %v", quote, order, routed.Route.ID, err)
		}
	}
	delete(s.routeHealthBlocked, "route:blocked-route")
	quote, err := s.QuoteLogicalModel(user.ID, item.ID, intent)
	if err != nil || quote.AmountMicrocredits != channelQuote.AmountMicrocredits {
		t.Fatalf("normal route recovery changed the quote: %#v, %v", quote, err)
	}
	s.routeHealthBlocked["route:priced-route"] = time.Now().Add(time.Minute)
	if _, err := s.QuoteLogicalModel(user.ID, item.ID, intent); err == nil {
		t.Fatal("quote fell back to the ordinary price while the dedicated route was blocked")
	}
	if _, _, err := s.resolveTaskModelSelection(user.ID, quoteInput(intent, item.Code), item.ID, "canvas_video", "", true); err == nil {
		t.Fatal("task fell back to the ordinary price while the dedicated route was blocked")
	}
}

func TestUserGroupFixedPriceRetainsStaleRuleAndAuditsChanges(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	initial, updated, rejected := int64(1_000_000), int64(2_000_000), int64(3_000_000)
	price := &model.UserGroupFixedPrice{ChannelModelID: "cm", PriceTierID: "tier", BillingMode: "fixed_request", Unit: &initial}
	req := UserGroupRequest{Code: "vip", Name: "VIP", RatioBasisPoints: 10_000, AllChannels: true, ModelOverrides: []model.UserGroupModelOverride{{FixedPrice: price}}}
	group, err := s.CreateUserGroup(admin, req)
	if err != nil {
		t.Fatal(err)
	}
	price.Unit = &updated
	if _, err := s.UpdateUserGroup(admin, group.ID, req); err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&model.ChannelModelPriceTier{}, "id = ?", "tier").Error; err != nil {
		t.Fatal(err)
	}
	req.Name = "专属用户"
	renamed, err := s.UpdateUserGroup(admin, group.ID, req)
	if err != nil || len(renamed.ModelOverrides) != 1 || *renamed.ModelOverrides[0].FixedPrice.Unit != updated {
		t.Fatalf("rename with stale rule = %#v, %v", renamed, err)
	}
	price.Unit = &rejected
	if _, err := s.UpdateUserGroup(admin, group.ID, req); err == nil {
		t.Fatal("modified stale rule was accepted")
	}
	req.ModelOverrides = nil
	if _, err := s.UpdateUserGroup(admin, group.ID, req); err != nil {
		t.Fatal(err)
	}
	events, total, err := s.repo.AdminAuditEvents("user_group", group.ID, 10, 0)
	if err != nil || total != 4 || len(events) != 4 {
		t.Fatalf("audit events = %#v, total = %d, err = %v", events, total, err)
	}
	want := [][2]int64{{updated, 0}, {}, {initial, updated}, {0, initial}}
	for index, event := range events {
		var metadata struct {
			FixedPriceChanges []groupFixedPriceChange `json:"fixedPriceChanges"`
		}
		if err := json.Unmarshal([]byte(event.MetadataJSON), &metadata); err != nil {
			t.Fatal(err)
		}
		var got [2]int64
		for _, change := range metadata.FixedPriceChanges {
			for side, entry := range []*model.UserGroupModelOverride{change.Before, change.After} {
				if entry != nil {
					if entry.FixedPrice.ChannelModelID != "cm" || entry.FixedPrice.PriceTierID != "tier" {
						t.Fatalf("wrong audit target: %#v", entry)
					}
					got[side] = *entry.FixedPrice.Unit
				}
			}
		}
		if got != want[index] {
			t.Fatalf("event %d changes = %v, want %v", index, got, want[index])
		}
	}
	persisted, err := s.repo.UserGroup(group.ID)
	if err != nil {
		t.Fatal(err)
	}
	persisted.Name = "审计失败"
	if err := s.repo.SaveUserGroupWithChannels(persisted, nil, false, &events[0]); err == nil || errors.Is(err, repository.ErrUserGroupChanged) {
		t.Fatalf("expected audit insert to fail, got %v", err)
	}
	persisted, err = s.repo.UserGroup(group.ID)
	if err != nil || persisted.Name != req.Name {
		t.Fatalf("audit failure did not roll back group: %#v, %v", persisted, err)
	}
}

func TestUserGroupFixedPriceImageUsageKeepsInputAndOutputBands(t *testing.T) {
	s, db := imageBillingService(t)
	if err := db.AutoMigrate(&model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	prices := &model.ImagePricing{InputPriceMicrocredits: 100_000, OutputTiers: []model.ImagePriceTier{
		{MaxPixels: 2_610_000, UnitPriceMicrocredits: 200_000},
		{MaxPixels: 4_630_000, UnitPriceMicrocredits: 400_000},
	}}
	group, err := s.CreateUserGroup(admin, UserGroupRequest{Code: "vip", Name: "VIP", RatioBasisPoints: 5_000, AllChannels: true, ModelOverrides: []model.UserGroupModelOverride{
		{FixedPrice: &model.UserGroupFixedPrice{ChannelModelID: "image-model", PriceTierID: "image-tier", BillingMode: "image_usage", ImagePricing: prices}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.User{}).Where("id = ?", "image-user").Update("user_group", group.Code).Error; err != nil {
		t.Fatal(err)
	}
	intent := ModelRequestIntent{Capability: "image", Inputs: map[string]int{"image": 3}, Options: map[string]any{"count": 1}}
	order, err := s.newBillingOrderWithPriceTier("image-user", "", "fixed-image", "image-channel", seedream55Model, "image", "test", 1, tokenBillingEstimate{}, "image-tier", intent)
	if err != nil || !reflect.DeepEqual(order.ImagePricing, prices) || order.AmountMicrocredits != 700_000 {
		t.Fatalf("image order = %#v, err = %v", order, err)
	}
}
