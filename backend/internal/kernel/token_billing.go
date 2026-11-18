package kernel

import (
	"errors"
	"math/big"
)

var (
	ErrInvalidTokenBilling  = errors.New("按量计费参数无效")
	ErrTokenBillingOverflow = errors.New("按量计费金额超出上限")
)

type TokenBillingTerm struct {
	Tokens            int64
	PriceMicrocredits int64
}

// TokenBillingAmount 按每百万 Token 单价及万分比倍率汇总费用，只对最终微积分金额上取整。
func TokenBillingAmount(multiplierBPS int64, terms ...TokenBillingTerm) (int64, error) {
	return tokenBillingAmount(multiplierBPS, false, terms)
}

// TokenBillingAmountRounded 汇总用量、单价和倍率后直接四舍五入到 0.01 积分。
func TokenBillingAmountRounded(multiplierBPS int64, terms ...TokenBillingTerm) (int64, error) {
	return tokenBillingAmount(multiplierBPS, true, terms)
}

func tokenBillingAmount(multiplierBPS int64, roundToCent bool, terms []TokenBillingTerm) (int64, error) {
	if multiplierBPS <= 0 {
		return 0, ErrInvalidTokenBilling
	}
	var total, product big.Int
	for _, term := range terms {
		if term.Tokens < 0 || term.PriceMicrocredits < 0 {
			return 0, ErrInvalidTokenBilling
		}
		product.Mul(big.NewInt(term.Tokens), big.NewInt(term.PriceMicrocredits))
		total.Add(&total, &product)
	}
	total.Mul(&total, big.NewInt(multiplierBPS))
	if roundToCent {
		return billingAmountRounded(&total, 10_000_000_000)
	}
	var remainder big.Int
	total.QuoRem(&total, big.NewInt(10_000_000_000), &remainder)
	if remainder.Sign() != 0 {
		total.Add(&total, big.NewInt(1))
	}
	if !total.IsInt64() {
		return 0, ErrTokenBillingOverflow
	}
	return total.Int64(), nil
}

func UnitBillingAmountRounded(unitPrice, quantity, multiplierBPS int64) (int64, error) {
	if unitPrice < 0 || quantity <= 0 || multiplierBPS <= 0 {
		return 0, ErrInvalidTokenBilling
	}
	total := new(big.Int).Mul(big.NewInt(unitPrice), big.NewInt(quantity))
	total.Mul(total, big.NewInt(multiplierBPS))
	return billingAmountRounded(total, 10_000)
}

func billingAmountRounded(numerator *big.Int, divisor int64) (int64, error) {
	const microcreditsPerCent = 10_000
	denominator := divisor * microcreditsPerCent
	// 不先取整到微积分，否则略低于半分的费用会被错误进位。
	numerator.Add(numerator, big.NewInt(denominator/2))
	numerator.Quo(numerator, big.NewInt(denominator))
	numerator.Mul(numerator, big.NewInt(microcreditsPerCent))
	if !numerator.IsInt64() {
		return 0, ErrTokenBillingOverflow
	}
	return numerator.Int64(), nil
}
