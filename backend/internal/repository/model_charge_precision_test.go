package repository

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestModelChargePrecisionSettlesBalanceAndLedger(t *testing.T) {
	for _, tc := range []struct {
		name, mode string
		round      bool
		cap, want  int64
	}{
		{"new text", "token", true, 0, 50_000},
		{"legacy text", "token", false, 0, 45_000},
		{"new text authorized zero", "token", true, 1, 0},
		{"new timed audio", "per_second", true, 0, 50_000},
		{"legacy timed audio", "per_second", false, 0, 45_000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo, db := newRefundedBillingRecoveryRepository(t)
			const balance = int64(1_000_000)
			const hold = int64(60_000)
			order := model.BillingOrder{
				ID: "order", UserID: "user", IdempotencyKey: "order", Capability: "text", BillingMode: tc.mode,
				AmountMicrocredits: hold, MultiplierBasisPoints: 10_000, Status: model.BillingStatusRunning,
				RoundChargeToCent: tc.round, OutputTokenPriceMicrocredits: 45_000_000, UnitPriceMicrocredits: 15_000,
			}
			if tc.mode == "per_second" {
				order.Capability = "audio"
			}
			if tc.cap > 0 {
				order.AmountMicrocredits = 0
				order.ChargeLimitSet = true
			}
			if err := db.Create(&model.CreditAccount{UserID: "user", AvailableMicrocredits: balance}).Error; err != nil {
				t.Fatal(err)
			}
			if err := repo.ReserveBillingOrder(&order); err != nil {
				t.Fatal(err)
			}
			if tc.mode == "token" {
				log := model.ApiCallLog{ID: "usage", BillingOrderID: order.ID, Status: model.ApiCallStatusSucceeded, OutputTokens: 1_000, UsageAvailable: true}
				if err := db.Create(&log).Error; err != nil {
					t.Fatal(err)
				}
				if err := repo.SettleBillingOrder(order.ID, "provider"); err != nil {
					t.Fatal(err)
				}
			} else if err := repo.SettleBillingOrderWithAudioDuration(order.ID, "provider", 2_001); err != nil {
				t.Fatal(err)
			}
			settled, err := repo.BillingOrder(order.ID)
			if err != nil || settled.Status != model.BillingStatusSettled || settled.ActualAmountMicrocredits != tc.want || settled.RefundedAmountMicrocredits != order.AmountMicrocredits-tc.want {
				t.Fatalf("settled order = %+v, %v", settled, err)
			}
			var account model.CreditAccount
			if err := db.First(&account, "user_id = ?", order.UserID).Error; err != nil {
				t.Fatal(err)
			}
			if account.AvailableMicrocredits != balance-tc.want || account.ReservedMicrocredits != 0 {
				t.Fatalf("settled balance = %+v", account)
			}
			var entry model.CreditLedgerEntry
			if err := db.First(&entry, "billing_order_id = ? AND type = ?", order.ID, model.CreditLedgerConsume).Error; err != nil {
				t.Fatal(err)
			}
			if entry.AmountMicrocredits != -tc.want {
				t.Fatalf("consume entry = %+v", entry)
			}
		})
	}
}

func TestModelChargePrecisionAllowsZeroPriceReplacement(t *testing.T) {
	repo, db := newRefundedBillingRecoveryRepository(t)
	if err := db.AutoMigrate(&model.Task{}); err != nil {
		t.Fatal(err)
	}
	task := model.Task{ID: "task", UserID: "user", Status: model.TaskStatusRunning, RouteID: "original", BillingOrderID: "order"}
	order := model.BillingOrder{ID: "order", TaskID: task.ID, UserID: task.UserID, Status: model.BillingStatusRunning, BillingMode: "fixed_request", AmountMicrocredits: 10_000, RoundChargeToCent: true, ChargeLimitSet: true, ChargeLimitMicrocredits: 10_000}
	for _, row := range []any{&task, &model.CreditAccount{UserID: "user", AvailableMicrocredits: 100_000}} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := repo.ReserveBillingOrder(&order); err != nil {
		t.Fatal(err)
	}
	replacement := order
	replacement.AmountMicrocredits = 0
	replacement.UnitPriceMicrocredits = 4_999
	if err := repo.SwitchTaskLogicalRoute(task.ID, "original", "alternate", "{}", order.ID, "channel", "model", &replacement, model.BillingCostSnapshot{}, ""); err != nil {
		t.Fatal(err)
	}
	if err := repo.SettleBillingOrder(order.ID, "provider"); err != nil {
		t.Fatal(err)
	}
	settled, err := repo.BillingOrder(order.ID)
	if err != nil || settled.ActualAmountMicrocredits != 0 || !settled.RoundChargeToCent || settled.ChargeLimitMicrocredits != 10_000 {
		t.Fatalf("settled order = %+v, %v", settled, err)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "user").Error; err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != 100_000 || account.ReservedMicrocredits != 0 {
		t.Fatalf("settled balance = %+v", account)
	}
}
