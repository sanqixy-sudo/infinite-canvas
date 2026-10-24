package service

import (
	"context"
	"math"
	"testing"

	"github.com/tigerowo/infinite-canvas/model"
)

func TestCommercePlanValidationRejectsUnsafeBenefitsAndPrices(t *testing.T) {
	valid := model.CommercePlan{ID: "credits", Name: "算力套餐", Kind: model.CommerceKindCredits, PriceCents: 100, Credits: 1.29, Enabled: true}
	if _, err := validateCommerceSettings(model.CommerceSetting{DefaultStorageBytes: 1 << 30, Plans: []model.CommercePlan{valid}}); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []model.CommercePlan{
		{ID: "free", Name: "零价", Kind: model.CommerceKindCredits, Credits: 1},
		{ID: "negative", Name: "负价", Kind: model.CommerceKindCredits, PriceCents: -1, Credits: 1},
		{ID: "decimal", Name: "超精度", Kind: model.CommerceKindCredits, PriceCents: 1, Credits: 0.001},
		{ID: "nan", Name: "非数", Kind: model.CommerceKindCredits, PriceCents: 1, Credits: math.NaN()},
		{ID: "infinite", Name: "无穷", Kind: model.CommerceKindCredits, PriceCents: 1, Credits: math.Inf(1)},
		{ID: "mixed", Name: "混合权益", Kind: model.CommerceKindCredits, PriceCents: 1, Credits: 1, StorageBytes: 1},
		{ID: "empty-storage", Name: "空容量", Kind: model.CommerceKindStorage, PriceCents: 1},
		{ID: "overflow", Name: "超容量", Kind: model.CommerceKindStorage, PriceCents: 1, StorageBytes: 1<<50 + 1},
		{ID: "unknown", Name: "未知", Kind: "subscription", PriceCents: 1, Credits: 1},
	} {
		if _, err := validateCommerceSettings(model.CommerceSetting{Plans: []model.CommercePlan{invalid}}); err == nil {
			t.Fatalf("accepted invalid plan: %#v", invalid)
		}
	}
	if _, err := validateCommerceSettings(model.CommerceSetting{Plans: []model.CommercePlan{valid, valid}}); err == nil {
		t.Fatal("accepted duplicate plan IDs")
	}
}

func TestCommerceServiceRequiresLoginAndAdminReviewWithRemark(t *testing.T) {
	if _, err := CreateCurrentUserPurchaseOrder(context.Background(), "plan", "request", ""); err == nil {
		t.Fatal("anonymous order creation accepted")
	}
	if _, err := CancelCurrentUserPurchaseOrder(context.Background(), "order"); err == nil {
		t.Fatal("anonymous cancellation accepted")
	}
	user := WithUser(context.Background(), model.AuthUser{ID: "user", Role: model.UserRoleUser})
	if _, err := ReviewPurchaseOrder(user, "order", "complete", "已收款"); err == nil {
		t.Fatal("ordinary user reviewed order")
	}
	admin := WithUser(context.Background(), model.AuthUser{ID: "admin", Role: model.UserRoleAdmin})
	if _, err := ReviewPurchaseOrder(admin, "order", "complete", " "); err == nil {
		t.Fatal("grant without audit remark accepted")
	}
	if _, err := ReviewPurchaseOrder(admin, "order", "unknown", "已收款"); err == nil {
		t.Fatal("unknown review action accepted")
	}
}

func TestCommercePlanConfirmationTracksDisplayedTerms(t *testing.T) {
	plan := model.CommercePlan{ID: "storage", Name: "扩容", Kind: model.CommerceKindStorage, PriceCents: 199, StorageBytes: 10 << 30, Description: "一次性长期扩容", Enabled: true}
	original := commercePlanConfirmation(plan)
	for name, change := range map[string]func(*model.CommercePlan){
		"price":       func(p *model.CommercePlan) { p.PriceCents++ },
		"storage":     func(p *model.CommercePlan) { p.StorageBytes++ },
		"credits":     func(p *model.CommercePlan) { p.Kind, p.StorageBytes, p.Credits = model.CommerceKindCredits, 0, 10 },
		"name":        func(p *model.CommercePlan) { p.Name += "新" },
		"description": func(p *model.CommercePlan) { p.Description += "新" },
		"disabled":    func(p *model.CommercePlan) { p.Enabled = false },
	} {
		changed := plan
		change(&changed)
		if commercePlanConfirmation(changed) == original {
			t.Fatalf("%s did not invalidate confirmation", name)
		}
	}
	plan.Confirmation = "client-supplied-value"
	if commercePlanConfirmation(plan) != original {
		t.Fatal("confirmation recursively included itself")
	}
	validated, err := validateCommerceSettings(model.CommerceSetting{Plans: []model.CommercePlan{plan}})
	if err != nil || validated.Plans[0].Confirmation != "" {
		t.Fatalf("client confirmation persisted in configuration: %+v %v", validated, err)
	}
}
