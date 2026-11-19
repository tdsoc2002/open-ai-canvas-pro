package database

import (
	"testing"

	"gorm.io/gorm"
)

// 这些夹具只登记基线迁移、不重跑它；补上基线已有的订单表，不预建后续迁移字段。
func seedHistoricalBillingOrders(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.Exec("CREATE TABLE billing_orders (id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36), amount_microcredits BIGINT)").Error; err != nil {
		t.Fatal(err)
	}
}
