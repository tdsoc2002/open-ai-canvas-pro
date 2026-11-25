package app

import (
	"encoding/json"
	"fmt"
	"testing"

	"yingce/backend/internal/model"
)

func TestTack2AIMinimaxH3MixedRates(t *testing.T) {
	for _, tc := range []struct {
		resolution string
		unitPrice  int64
	}{
		{"480P", 50_000},
		{"768P", 80_000},
		{"1080P", 110_000},
		{"2K", 130_000},
	} {
		t.Run(tc.resolution, func(t *testing.T) {
			rates, ok := minimaxH3Rate("minimax h3", tc.resolution)
			if !ok {
				t.Fatalf("missing %s rate", tc.resolution)
			}
			for _, images := range []int64{5, 6} {
				amount, err := rates.amount(4, 2_000, images, tc.unitPrice, 10_000, true)
				want := 6*tc.unitPrice + (images-5)*50_000
				if err != nil || amount != want {
					t.Fatalf("amount for %d images = %d, want %d; error: %v", images, amount, want, err)
				}
			}
			if err := validateMinimaxH3PriceTier("tack2ai-video", model.BillingModeMinimaxH3, "minimax h3", tc.resolution); err != nil {
				t.Fatal(err)
			}
		})
	}
	if err := validateMinimaxH3PriceTier("minimax-video", model.BillingModeMinimaxH3, "minimax h3", "768P"); err == nil {
		t.Fatal("source-specific rates accepted on another protocol")
	}
}

func TestTack2AIMinimaxH3IRSurcharge(t *testing.T) {
	price := int64(150_000)
	for _, mode := range []string{"fixed_request", "per_second"} {
		for _, ir := range []*int64{nil, new(int64), &price} {
			name := "off"
			if ir != nil {
				name = fmt.Sprint(*ir)
			}
			t.Run(mode+"/"+name, func(t *testing.T) {
				const protocol = "tack2ai-video"
				const providerModel = "minimax h3"
				const unitPrice = 500_000
				svc, db, channel, channelModel, _ := newVideoTokenQuoteFixture(t)
				profile := DefaultModelCapabilityConfigForModel(protocol, providerModel)
				profile.Video.Duration = VideoDurationConfig{Selection: "range", Min: 4, Max: 15, Step: 1, Default: 5}
				profileJSON, err := json.Marshal(profile)
				if err != nil {
					t.Fatal(err)
				}
				if err := db.Model(&model.ChannelModel{}).Where("id = ?", channelModel.ID).Updates(map[string]any{
					"protocol": protocol, "provider_model_key": providerModel, "capability_config_json": string(profileJSON),
				}).Error; err != nil {
					t.Fatal(err)
				}
				if err := db.Delete(&model.ChannelModelPriceTier{}, "channel_model_id = ?", channelModel.ID).Error; err != nil {
					t.Fatal(err)
				}
				tiers, err := svc.normalizeChannelModelPriceTiers(ChannelModelRequest{
					PriceTiers: []ChannelModelPriceTierRequest{{
						BillingMode: mode, UnitPriceMicrocredits: unitPrice, PriceConfigured: true, MinimaxH3IRPriceMicrocredits: ir,
					}},
				}, "video", protocol, providerModel)
				if err != nil {
					t.Fatal(err)
				}
				tier := tiers[0]
				tier.ChannelModelID = channelModel.ID
				if err := db.Create(&tier).Error; err != nil {
					t.Fatal(err)
				}
				intent := ModelRequestIntent{
					Capability: "video", Operation: "text_to_video", Inputs: map[string]int{"text": 1},
					Options: map[string]any{"videoSeconds": 5},
				}
				quote, err := svc.QuoteChannelModel("quote-user", ChannelModelQuoteRequest{ChannelID: channel.ID, ModelKey: channelModel.ModelKey, Intent: intent})
				want := int64(unitPrice)
				if mode == "per_second" {
					want *= 5
				}
				if ir != nil {
					want += *ir
				}
				if err != nil || quote.AmountMicrocredits != want || (quote.MinimaxH3IRChargeMicrocredits == nil) != (ir == nil) ||
					ir != nil && *quote.MinimaxH3IRChargeMicrocredits != *ir {
					t.Fatalf("quote = %#v, error = %v, want %d including IR %s", quote, err, want, name)
				}
				order, err := svc.newBillingOrderWithPriceTier("quote-user", "tack2ai-h3-task", "tack2ai-h3-test", channel.ID,
					channelModel.ModelKey, "video", "test", 5, tokenBillingEstimate{}, tier.ID, intent)
				if err != nil || order.AmountMicrocredits != want {
					t.Fatalf("reservation = %#v, error = %v", order, err)
				}
				svc.pluginRuntime = tack2aiTestRuntime(t)
				input := quoteInput(intent, channelModel.ModelKey)
				input["config"].(map[string]any)["channelId"] = channel.ID
				input, err = svc.resolveSystemChannelModelSelection(testGroupAccess(svc), input, "canvas_video", intent.Operation)
				if err != nil {
					t.Fatal(err)
				}
				raw, err := svc.captureTaskProtocolBinding(input, nil)
				if err != nil {
					t.Fatal(err)
				}
				binding, err := decodeTaskProtocolBinding(raw)
				if err != nil || binding.UpstreamModel != providerModel || binding.MinimaxH3IR != (ir != nil) {
					t.Fatalf("protocol binding = %#v, error = %v", binding, err)
				}
				if err := validateMinimaxH3IRBillingBinding(raw, order); err != nil {
					t.Fatal(err)
				}
				if err := svc.repo.ReserveBillingOrder(order); err != nil {
					t.Fatal(err)
				}
				if err := svc.SettleBilling(order.ID, "tack2ai-h3-video"); err != nil {
					t.Fatal(err)
				}
				settled, err := svc.repo.BillingOrder(order.ID)
				if err != nil || settled.ActualAmountMicrocredits != want {
					t.Fatalf("settlement = %#v, error = %v", settled, err)
				}
			})
		}
	}
}

func TestMinimaxH3QuoteAndSettlement(t *testing.T) {
	pricedIR := int64(150_000)
	for _, tc := range []struct {
		name  string
		free  int
		base  int64
		extra int64
		ir    *int64
	}{
		{"MiniMax-H3", 5, 3_500_000, 200_000, nil},
		{"MiniMax-H3-Max", 2, 4_440_000, 500_000, nil},
		{"MiniMax-H3", 5, 3_500_000, 200_000, new(int64)},
		{"MiniMax-H3", 5, 3_500_000, 200_000, &pricedIR},
	} {
		name := tc.name
		var irCharge int64
		if tc.ir != nil {
			irCharge = *tc.ir
			name += "/IR"
		}
		t.Run(name, func(t *testing.T) {
			svc, db, channel, channelModel, _ := newVideoTokenQuoteFixture(t)
			profile := DefaultModelCapabilityConfigForModel("minimax-video", tc.name)
			profileJSON, err := json.Marshal(profile)
			if err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.ChannelModel{}).Where("id = ?", channelModel.ID).Updates(map[string]any{
				"protocol": "minimax-video", "provider_model_key": tc.name, "capability_config_json": string(profileJSON),
			}).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Delete(&model.ChannelModelPriceTier{}, "channel_model_id = ?", channelModel.ID).Error; err != nil {
				t.Fatal(err)
			}
			tier := model.ChannelModelPriceTier{
				ID: "h3-768p", ChannelModelID: channelModel.ID, ProviderModelKey: tc.name, Resolution: "768p",
				SelectorKey: `{"vquality":"768p"}`, SelectorJSON: `{"vquality":"768p"}`,
				BillingMode: model.BillingModeMinimaxH3, UnitPriceMicrocredits: 500_000, PriceConfigured: true, Enabled: true,
				CostPricing:                  model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: 250_000},
				MinimaxH3IRPriceMicrocredits: tc.ir,
			}
			if err := db.Create(&tier).Error; err != nil {
				t.Fatal(err)
			}
			intent := ModelRequestIntent{
				Capability: "video", Operation: "reference_to_video", Inputs: map[string]int{"image": tc.free, "video": 1, "audio": 1},
				Options: map[string]any{"vquality": "768p", "size": "16:9", "videoSeconds": 5}, ReferenceVideoDurationsMs: []int64{2000},
			}
			request := ChannelModelQuoteRequest{ChannelID: channel.ID, ModelKey: channelModel.ModelKey, Intent: intent}
			freeQuote, err := svc.QuoteChannelModel("quote-user", request)
			if err != nil || freeQuote.AmountMicrocredits != tc.base+irCharge || freeQuote.VideoInputImages.Billable != 0 {
				t.Fatalf("free inputs quote = %#v, error = %v", freeQuote, err)
			}
			intent.Inputs["image"]++
			quote, err := svc.QuoteChannelModel("quote-user", request)
			if err != nil || quote.AmountMicrocredits != tc.base+tc.extra+irCharge || quote.VideoInputImages.Billable != 1 || quote.ReferenceVideo.ReferenceSeconds != 2 {
				t.Fatalf("paid inputs quote = %#v, error = %v", quote, err)
			}
			if tc.ir == nil && quote.MinimaxH3IRChargeMicrocredits != nil || tc.ir != nil && (quote.MinimaxH3IRChargeMicrocredits == nil || *quote.MinimaxH3IRChargeMicrocredits != irCharge) {
				t.Fatalf("wrong IR component: %#v", quote)
			}
			if irCharge > 0 {
				svc.pluginRuntime, err = newPluginRuntime(svc.dataDir)
				if err != nil {
					t.Fatal(err)
				}
				input := quoteInput(intent, channelModel.ModelKey)
				input["config"].(map[string]any)["channelId"] = channel.ID
				input, err = svc.resolveSystemChannelModelSelection(testGroupAccess(svc), input, "canvas_video", intent.Operation)
				if err != nil {
					t.Fatal(err)
				}
				raw, err := svc.captureTaskProtocolBinding(input, nil)
				if err != nil {
					t.Fatal(err)
				}
				binding, err := decodeTaskProtocolBinding(raw)
				if err != nil || !binding.MinimaxH3IR {
					t.Fatalf("IR enabled price must pin the protocol step: %#v, %v", binding, err)
				}
			}
			order, err := svc.newBillingOrderWithPriceTier("quote-user", "h3-task", "h3-test", channel.ID, channelModel.ModelKey, "video", "test", 5, tokenBillingEstimate{
				ReferenceVideos: referenceVideoUsage{Count: 1, RecordedMillis: 1000, RecordedKnown: true, Measure: func() (int64, error) { return 2000, nil }},
			}, tier.ID, intent)
			if err != nil || order.AmountMicrocredits != quote.AmountMicrocredits || order.ReferenceVideoMillis != 2000 || order.VideoBillableImages != 1 {
				t.Fatalf("reservation = %#v, error = %v", order, err)
			}
			if err := svc.repo.ReserveBillingOrder(order); err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&tier).Updates(map[string]any{"unit_price_microcredits": 100_000, "minimax_h3_ir_price_microcredits": nil}).Error; err != nil {
				t.Fatal(err)
			}
			for range 2 {
				if err := svc.SettleBilling(order.ID, "completed-h3-video"); err != nil {
					t.Fatal(err)
				}
			}
			settled, err := svc.repo.BillingOrder(order.ID)
			if err != nil || settled.Status != model.BillingStatusSettled || settled.ActualAmountMicrocredits != quote.AmountMicrocredits || (settled.MinimaxH3IRChargeMicrocredits != nil) != (tc.ir != nil) {
				t.Fatalf("settled order = %#v, error = %v", settled, err)
			}
			cost, err := billingCreditCost(*settled)
			if err != nil || tc.ir != nil && cost != nil || tc.ir == nil && (cost == nil || *cost != (tc.base+tc.extra)/2) {
				t.Fatalf("cost = %v, error = %v", cost, err)
			}
		})
	}
}
