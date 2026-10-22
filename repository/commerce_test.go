package repository

import (
	"errors"
	"fmt"
	"sync"
	"testing"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
)

func commerceTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(dialector("sqlite", ":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	connection, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.CreditLog{}, &model.PurchaseOrder{}); err != nil {
		t.Fatal(err)
	}
	for _, user := range []model.User{{ID: "buyer", Username: "buyer", AffCode: "buyer", Credits: 5}, {ID: "other", Username: "other", AffCode: "other", Credits: 90}} {
		if err := db.Create(&user).Error; err != nil {
			t.Fatal(err)
		}
	}
	return db
}

func testPurchaseOrder(id, kind string) model.PurchaseOrder {
	order := model.PurchaseOrder{ID: id, UserID: "buyer", RequestID: id + "-request", PlanID: "plan", PlanName: "已建单套餐", Kind: kind, PriceCents: 199, PaymentMethod: "manual", Status: model.PurchaseOrderPending, CreatedAt: "2026-01-01", UpdatedAt: "2026-01-01"}
	if kind == model.CommerceKindCredits {
		order.Credits = 12.34
	} else {
		order.StorageBytes = 2 << 30
	}
	return order
}

func TestPurchaseOrderCreationIsIdempotentAndKeepsSnapshot(t *testing.T) {
	db := commerceTestDB(t)
	original := testPurchaseOrder("first", model.CommerceKindCredits)
	if _, err := createPurchaseOrder(db, original); err != nil {
		t.Fatal(err)
	}
	retry := original
	retry.ID, retry.PlanName, retry.PriceCents, retry.Credits = "retry", "改价后的套餐", 999, 100
	returned, err := createPurchaseOrder(db, retry)
	if err != nil || returned.ID != original.ID || returned.PriceCents != 199 || returned.Credits != 12.34 || returned.PlanName != original.PlanName {
		t.Fatalf("snapshot changed: %#v, %v", returned, err)
	}
	var count int64
	if err := db.Model(&model.PurchaseOrder{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("duplicate orders: %d, %v", count, err)
	}
}

func TestPendingOrderLimitKeepsRetriesIdempotentAndCanceledSlotsReusable(t *testing.T) {
	db := commerceTestDB(t)
	for i := 0; i < 20; i++ {
		if _, err := createPurchaseOrder(db, testPurchaseOrder(fmt.Sprintf("pending-%d", i), model.CommerceKindCredits)); err != nil {
			t.Fatal(err)
		}
	}
	retry := testPurchaseOrder("pending-0", model.CommerceKindCredits)
	retry.ID = "new-id-same-request"
	if order, err := createPurchaseOrder(db, retry); err != nil || order.ID != "pending-0" {
		t.Fatalf("retry failed at limit: %#v, %v", order, err)
	}
	newOrder := testPurchaseOrder("pending-new", model.CommerceKindCredits)
	if _, err := createPurchaseOrder(db, newOrder); !errors.Is(err, ErrPendingPurchaseOrderLimit) {
		t.Fatalf("21st pending order accepted: %v", err)
	}
	if _, err := changePurchaseOrder(db, "pending-0", "buyer", model.PurchaseOrderCanceled, "", "", "2026-01-02", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := createPurchaseOrder(db, newOrder); err != nil {
		t.Fatalf("canceled order did not release pending slot: %v", err)
	}
}

func TestPurchaseOrderConcurrentReviewGrantsExactlyOnce(t *testing.T) {
	db := commerceTestDB(t)
	order := testPurchaseOrder("credit-order", model.CommerceKindCredits)
	if _, err := createPurchaseOrder(db, order); err != nil {
		t.Fatal(err)
	}
	var wait sync.WaitGroup
	failures := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wait.Add(1)
		go func(i int) {
			defer wait.Done()
			_, err := changePurchaseOrder(db, order.ID, "", model.PurchaseOrderCompleted, "admin", "已核实收款", "2026-01-02", fmt.Sprintf("credit-%d", i))
			failures <- err
		}(i)
	}
	wait.Wait()
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatal(err)
		}
	}
	var user model.User
	if err := db.First(&user, "id = ?", "buyer").Error; err != nil || user.Credits != 17.34 {
		t.Fatalf("balance = %v, %v", user.Credits, err)
	}
	var logs []model.CreditLog
	if err := db.Find(&logs).Error; err != nil || len(logs) != 1 || logs[0].RelatedID != order.ID || logs[0].Type != model.CreditLogTypeRecharge || logs[0].Amount != 12.34 {
		t.Fatalf("logs = %#v, %v", logs, err)
	}
	if _, err := changePurchaseOrder(db, order.ID, "", model.PurchaseOrderRejected, "admin", "迟到的拒绝", "2026-01-03", "unused"); !errors.Is(err, ErrPurchaseOrderState) {
		t.Fatalf("completed order changed to rejection: %v", err)
	}
}

func TestPurchaseOrderFailedCreditLogRollsBackGrantAndStatus(t *testing.T) {
	db := commerceTestDB(t)
	order := testPurchaseOrder("rollback-order", model.CommerceKindCredits)
	if _, err := createPurchaseOrder(db, order); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CreditLog{ID: "existing-log", UserID: "other"}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := changePurchaseOrder(db, order.ID, "", model.PurchaseOrderCompleted, "admin", "核实收款", "2026-01-02", "existing-log"); err == nil {
		t.Fatal("failed log unexpectedly committed")
	}
	var user model.User
	if err := db.First(&user, "id = ?", "buyer").Error; err != nil || user.Credits != 5 {
		t.Fatalf("balance changed: %v, %v", user.Credits, err)
	}
	var saved model.PurchaseOrder
	if err := db.First(&saved, "id = ?", order.ID).Error; err != nil || saved.Status != model.PurchaseOrderPending || saved.ReviewerID != "" {
		t.Fatalf("order was not rolled back: %#v, %v", saved, err)
	}
}

func TestStorageOrderGrantCancellationAndOwnerIsolation(t *testing.T) {
	db := commerceTestDB(t)
	order := testPurchaseOrder("storage-order", model.CommerceKindStorage)
	if _, err := createPurchaseOrder(db, order); err != nil {
		t.Fatal(err)
	}
	if _, err := changePurchaseOrder(db, order.ID, "other", model.PurchaseOrderCanceled, "", "", "2026-01-02", ""); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("other user canceled order: %v", err)
	}
	for i := 0; i < 2; i++ {
		if _, err := changePurchaseOrder(db, order.ID, "", model.PurchaseOrderCompleted, "admin", "确认收到款项", "2026-01-02", "unused"); err != nil {
			t.Fatal(err)
		}
	}
	var user model.User
	if err := db.First(&user, "id = ?", "buyer").Error; err != nil || user.StorageExtraBytes != 2<<30 || user.Credits != 5 {
		t.Fatalf("storage grant = %#v, %v", user, err)
	}
	canceled := testPurchaseOrder("canceled-order", model.CommerceKindStorage)
	if _, err := createPurchaseOrder(db, canceled); err != nil {
		t.Fatal(err)
	}
	if _, err := changePurchaseOrder(db, canceled.ID, "buyer", model.PurchaseOrderCanceled, "", "", "2026-01-02", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := changePurchaseOrder(db, canceled.ID, "", model.PurchaseOrderCompleted, "admin", "不能发放", "2026-01-03", "unused"); !errors.Is(err, ErrPurchaseOrderState) {
		t.Fatalf("canceled order was granted: %v", err)
	}
}
