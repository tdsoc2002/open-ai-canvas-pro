package app

import (
	"math/big"
	"strings"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

func isTack2AIH3(protocol, providerModel string) bool {
	return protocol == "tack2ai-video" && providerModel == "minimax h3"
}

func supportsMinimaxH3IRModel(protocol model.ChannelInterfaceType, providerModel string) bool {
	return (protocol == model.ChannelInterfaceMiniMaxVideo && strings.EqualFold(providerModel, "MiniMax-H3")) ||
		isTack2AIH3(string(protocol), providerModel)
}

func validateMinimaxH3PriceTier(protocol model.ChannelInterfaceType, billingMode, providerModel, resolution string) error {
	if billingMode != model.BillingModeMinimaxH3 {
		return nil
	}
	if strings.EqualFold(providerModel, "minimax h3") && !isTack2AIH3(string(protocol), providerModel) {
		return BadAuthRequest("源点动力专属计费需要 tack2ai-video 协议及上游型号 minimax h3")
	}
	if _, ok := minimaxH3Rate(providerModel, resolution); !ok {
		return BadAuthRequest("MiniMax H3 计费需要选择该型号支持的具体分辨率")
	}
	return nil
}

// 规格基准费率用分表示。实际计价以规格配置的输出单价为基准。
type minimaxH3Rates struct {
	output, inputVideo, inputImage, freeImages int64
}

func minimaxH3Rate(providerModel, resolution string) (minimaxH3Rates, bool) {
	var rates minimaxH3Rates
	switch strings.ToLower(strings.TrimSpace(providerModel)) + ":" + normalizeChannelModelTierResolution(resolution) {
	case "minimax-h3:768p":
		rates = minimaxH3Rates{50, 50, 20, 5}
	case "minimax-h3:1440p":
		rates = minimaxH3Rates{80, 80, 20, 5}
	case "minimax-h3-highspeed:768p":
		rates = minimaxH3Rates{40, 40, 20, 5}
	case "minimax-h3-highspeed:480p":
		rates = minimaxH3Rates{26, 26, 20, 5}
	case "minimax-h3-lite:768p":
		rates = minimaxH3Rates{26, 26, 13, 5}
	case "minimax-h3-lite:480p":
		rates = minimaxH3Rates{16, 16, 13, 5}
	case "minimax-h3-max:768p":
		rates = minimaxH3Rates{50, 97, 50, 2}
	case "minimax-h3-max:480p":
		rates = minimaxH3Rates{33, 37, 50, 2}
	case "minimax h3:480p":
		rates = minimaxH3Rates{5, 5, 5, 5}
	case "minimax h3:768p":
		rates = minimaxH3Rates{8, 8, 5, 5}
	case "minimax h3:1080p":
		rates = minimaxH3Rates{11, 11, 5, 5}
	case "minimax h3:1440p":
		rates = minimaxH3Rates{13, 13, 5, 5}
	}
	return rates, rates.output > 0
}

func (r minimaxH3Rates) amount(seconds, referenceMillis, images, outputUnit, bps int64, roundToCent bool) (int64, error) {
	if seconds <= 0 || referenceMillis < 0 || images < 0 || outputUnit < 0 || bps <= 0 || r.output <= 0 {
		return 0, kernel.ErrInvalidTokenBilling
	}
	var weighted, term big.Int
	weighted.Mul(big.NewInt(seconds), big.NewInt(r.output*1000))
	weighted.Add(&weighted, term.Mul(big.NewInt(referenceMillis), big.NewInt(r.inputVideo)))
	weighted.Add(&weighted, term.Mul(big.NewInt(max(0, images-r.freeImages)), big.NewInt(r.inputImage*1000)))
	weighted.Mul(&weighted, big.NewInt(outputUnit))
	weighted.Mul(&weighted, big.NewInt(bps))
	denominator := r.output * 1000 * 10_000
	if roundToCent {
		denominator *= 10_000
		weighted.Add(&weighted, big.NewInt(denominator/2))
	} else {
		weighted.Add(&weighted, big.NewInt(denominator-1))
	}
	weighted.Quo(&weighted, big.NewInt(denominator))
	if roundToCent {
		weighted.Mul(&weighted, big.NewInt(10_000))
	}
	if !weighted.IsInt64() {
		return 0, kernel.ErrTokenBillingOverflow
	}
	return weighted.Int64(), nil
}

func validateMinimaxH3IRDuration(seconds int64) error {
	if seconds < 4 || seconds > 15 {
		return BadAuthRequest("MiniMax H3 开启 Context-IR 时，视频时长须在 4–15 秒之间")
	}
	return nil
}

func snapshotMinimaxH3Cost(order *model.BillingOrder, tier *model.ChannelModelPriceTier, seconds int64, intent ModelRequestIntent, references referenceVideoUsage) error {
	if tier == nil || tier.BillingMode != model.BillingModeMinimaxH3 || !tier.CostPricing.Configured {
		return nil
	}
	rates, ok := minimaxH3Rate(tier.ProviderModelKey, tier.Resolution)
	if !ok {
		return BadAuthRequest("当前规格没有 MiniMax H3 计费规则")
	}
	millis := order.ReferenceVideoMillis
	if order.BillingMode != model.BillingModeMinimaxH3 {
		var err error
		millis, _, err = references.perSecondMillis()
		if err != nil {
			return err
		}
	}
	amount, err := rates.amount(seconds, millis, int64(intent.Inputs["image"]), tier.CostPricing.UnitPriceMicrocredits, 10_000, false)
	if err == nil {
		order.CostMinimaxH3Microcredits = amount
	}
	return err
}
