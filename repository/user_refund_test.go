package repository

import (
	"testing"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
)

func TestRefundUserCreditsKeepsBalanceAndLogAtomic(t *testing.T) {
	db, err := gorm.Open(dialector("sqlite", ":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.CreditLog{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.User{ID: "user-1", Username: "refund-test", Credits: 10}).Error; err != nil {
		t.Fatal(err)
	}
	log := model.CreditLog{ID: "refund-1", UserID: "user-1", Type: model.CreditLogTypeAIRefund, Amount: 2.5}
	user, found, err := refundUserCreditsWithLog(db, "user-1", 2.5, "2026-01-01", log)
	if err != nil || !found || user.Credits != 12.5 {
		t.Fatalf("refund result = %#v, found = %v, err = %v", user, found, err)
	}
	var saved model.CreditLog
	if err := db.First(&saved, "id = ?", log.ID).Error; err != nil || saved.Balance != 12.5 {
		t.Fatalf("refund log = %#v, err = %v", saved, err)
	}
	if _, _, err := refundUserCreditsWithLog(db, "user-1", 2.5, "2026-01-02", log); err == nil {
		t.Fatal("duplicate log should fail and roll back the balance")
	}
	if err := db.First(&user, "id = ?", "user-1").Error; err != nil || user.Credits != 12.5 {
		t.Fatalf("balance changed after failed log: %#v, err = %v", user, err)
	}
}
