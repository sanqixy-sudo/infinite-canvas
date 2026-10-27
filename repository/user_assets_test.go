package repository

import (
	"sync"
	"testing"

	"github.com/tigerowo/infinite-canvas/model"
)

func TestSavingUserSnapshotPreservesLaterAssetChanges(t *testing.T) {
	database := commerceTestDB(t)
	var stale model.User
	if err := database.First(&stale, "id = ?", "buyer").Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Model(&model.User{}).Where("id = ?", stale.ID).Updates(map[string]any{"credits": 23.45, "storage_extra_bytes": 1234, "aff_count": 7}).Error; err != nil {
		t.Fatal(err)
	}
	stale.DisplayName, stale.LastLoginAt, stale.UpdatedAt = "新资料", "2026-01-02", "2026-01-02"
	saved, err := saveUser(database, stale)
	if err != nil || saved.DisplayName != "新资料" || saved.LastLoginAt != stale.LastLoginAt || saved.Credits != 23.45 || saved.StorageExtraBytes != 1234 || saved.AffCount != 7 {
		t.Fatalf("stale profile/login overwrote current assets: %+v %v", saved, err)
	}
	created, err := saveUser(database, model.User{ID: "seed", Username: "seed", AffCode: "seed", Credits: 100})
	if err != nil || created.Credits != 100 {
		t.Fatalf("legal initial credits lost: %+v %v", created, err)
	}
}

func TestUserSnapshotSaveDoesNotUndoConcurrentOrderGrants(t *testing.T) {
	database := commerceTestDB(t)
	var stale model.User
	if err := database.First(&stale, "id = ?", "buyer").Error; err != nil {
		t.Fatal(err)
	}
	creditOrder := testPurchaseOrder("snapshot-credit", model.CommerceKindCredits)
	storageOrder := testPurchaseOrder("snapshot-storage", model.CommerceKindStorage)
	for _, order := range []model.PurchaseOrder{creditOrder, storageOrder} {
		if _, err := createPurchaseOrder(database, order); err != nil {
			t.Fatal(err)
		}
	}
	var reviews sync.WaitGroup
	for _, order := range []model.PurchaseOrder{creditOrder, storageOrder} {
		reviews.Add(1)
		go func(order model.PurchaseOrder) {
			defer reviews.Done()
			if _, err := changePurchaseOrder(database, order.ID, "", model.PurchaseOrderCompleted, "admin", "已核实收款", "2026-01-02", "snapshot-credit-log"); err != nil {
				t.Errorf("review order: %v", err)
			}
		}(order)
	}
	reviews.Wait()
	// 模拟在审核前读取、审核到账后才写回的登录和管理员资料快照。
	for _, lastLogin := range []string{"2026-01-03", "2026-01-04"} {
		stale.LastLoginAt = lastLogin
		stale.DisplayName = "更新资料"
		if _, err := saveUser(database, stale); err != nil {
			t.Fatal(err)
		}
	}
	var current model.User
	if err := database.First(&current, "id = ?", stale.ID).Error; err != nil || current.Credits != 17.34 || current.StorageExtraBytes != 2<<30 {
		t.Fatalf("reviewed entitlements lost after stale writes: %+v %v", current, err)
	}
	var logs int64
	if err := database.Model(&model.CreditLog{}).Where("related_id = ?", creditOrder.ID).Count(&logs).Error; err != nil || logs != 1 {
		t.Fatalf("credit grant audit was changed: %d %v", logs, err)
	}
}
