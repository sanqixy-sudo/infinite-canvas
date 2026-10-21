package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"github.com/tigerowo/infinite-canvas/service"
)

func TestPurchaseOrderBodyRejectsClientPricingAndTrailingJSON(t *testing.T) {
	for _, body := range []string{
		`{"planId":"plan","requestId":"request","priceCents":1}`,
		`{"planId":"plan","requestId":"request","credits":100000}`,
		`{"planId":"plan","requestId":"request","storageBytes":100000}`,
		`{"planId":"plan","requestId":"request","userId":"other"}`,
		`{"planId":"plan","requestId":"request"} {"extra":true}`,
	} {
		request := httptest.NewRequest(http.MethodPost, "/api/v1/purchase-orders", strings.NewReader(body))
		response := httptest.NewRecorder()
		CreateUserPurchaseOrder(response, request)
		result := response.Body.String()
		if !strings.Contains(result, `"code":1`) || (!strings.Contains(result, "订单或套餐参数无效") && !strings.Contains(result, "请求内容无效")) { t.Fatalf("unsafe order body reached business logic: %s", result) }
	}
}

func TestCommerceOrderAudit(t *testing.T) {
	const marker = "COMMERCE_ORDER_AUDIT_CHILD"
	if os.Getenv(marker) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestCommerceOrderAudit$", "-test.timeout=35s")
		command.Env = append(os.Environ(), marker+"=1")
		if output, err := command.CombinedOutput(); err != nil { t.Fatalf("isolated commerce audit: %v\n%s", err, output) }
		return
	}
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:"}
	db, err := repository.DB()
	if err != nil { t.Fatal(err) }
	connection, err := db.DB()
	if err != nil { t.Fatal(err) }
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })
	for _, user := range []model.User{{ID: "buyer", Username: "buyer", AffCode: "buyer", Credits: 5, Role: model.UserRoleUser}, {ID: "other", Username: "other", AffCode: "other", Role: model.UserRoleUser}, {ID: "admin", Username: "admin", AffCode: "admin", Role: model.UserRoleAdmin}} {
		if err := db.Create(&user).Error; err != nil { t.Fatal(err) }
	}
	buyer := service.WithUser(context.Background(), model.AuthUser{ID: "buyer", Role: model.UserRoleUser})
	other := service.WithUser(context.Background(), model.AuthUser{ID: "other", Role: model.UserRoleUser})
	admin := service.WithUser(context.Background(), model.AuthUser{ID: "admin", Role: model.UserRoleAdmin})
	defaults, err := service.AccountCommerceSettings()
	if err != nil || defaults.DefaultStorageBytes != 1<<30 || len(defaults.Plans) != 0 { t.Fatalf("defaults = %#v, %v", defaults, err) }
	settings := model.CommerceSetting{DefaultStorageBytes: 1 << 30, ContactText: "请联系管理员核实付款", Plans: []model.CommercePlan{
		{ID: "credits", Name: "原算力套餐", Kind: model.CommerceKindCredits, PriceCents: 199, Credits: 12.34, Enabled: true},
		{ID: "storage", Name: "永久存储额度", Kind: model.CommerceKindStorage, PriceCents: 299, StorageBytes: 2 << 30, Enabled: true},
		{ID: "disabled", Name: "隐藏套餐", Kind: model.CommerceKindCredits, PriceCents: 99, Credits: 1},
	}}
	if _, err := service.SaveCommerceSettings(admin, settings); err != nil { t.Fatal(err) }
	if _, err := repository.SaveSettings(model.Settings{}, "2026-01-01"); err != nil { t.Fatal(err) }
	wallet, err := service.CurrentUserWallet(buyer)
	if err != nil || wallet.Credits != 5 || len(wallet.Commerce.Plans) != 2 || wallet.Storage.LimitBytes != 1<<30 { t.Fatalf("wallet = %#v, %v", wallet, err) }
	credit, err := service.CreateCurrentUserPurchaseOrder(buyer, "credits", "credit-request")
	if err != nil { t.Fatal(err) }
	settings.Plans[0].Enabled, settings.Plans[0].PriceCents, settings.Plans[0].Credits = false, 999, 100
	if _, err := service.SaveCommerceSettings(admin, settings); err != nil { t.Fatal(err) }
	retry, err := service.CreateCurrentUserPurchaseOrder(buyer, "credits", "credit-request")
	if err != nil || retry.ID != credit.ID || retry.PriceCents != 199 || retry.Credits != 12.34 { t.Fatalf("retry lost snapshot: %#v, %v", retry, err) }
	if _, err := service.CreateCurrentUserPurchaseOrder(buyer, "credits", "new-credit-request"); err == nil { t.Fatal("disabled plan created a new order") }
	list, err := service.ListCurrentUserPurchaseOrders(other, model.Query{})
	if err != nil || list.Total != 0 { t.Fatalf("other user saw orders: %#v, %v", list, err) }
	if _, err := service.CancelCurrentUserPurchaseOrder(other, credit.ID); err == nil { t.Fatal("other user canceled buyer order") }
	for i := 0; i < 2; i++ { if _, err := service.ReviewPurchaseOrder(admin, credit.ID, "complete", "已确认到账"); err != nil { t.Fatal(err) } }
	logs, err := service.CurrentUserCreditLogs(buyer, model.Query{Type: string(model.CreditLogTypeRecharge)})
	if err != nil || logs.Total != 1 || len(logs.Items) != 1 || logs.Items[0].RelatedID != credit.ID || logs.Items[0].Amount != 12.34 { t.Fatalf("recharge log filter = %#v, %v", logs, err) }
	storage, err := service.CreateCurrentUserPurchaseOrder(buyer, "storage", "storage-request")
	if err != nil { t.Fatal(err) }
	if _, err := service.ReviewPurchaseOrder(admin, storage.ID, "complete", "已确认存储套餐款项"); err != nil { t.Fatal(err) }
	wallet, err = service.CurrentUserWallet(buyer)
	if err != nil || wallet.Credits != 17.34 || wallet.Storage.ExtraBytes != 2<<30 || wallet.Storage.LimitBytes != 3<<30 { t.Fatalf("grants = %#v, %v", wallet, err) }
	request := httptest.NewRequest(http.MethodGet, "/api/v1/purchase-orders?userId=buyer", nil).WithContext(other)
	response := httptest.NewRecorder()
	UserPurchaseOrders(response, request)
	var payload struct { Code int `json:"code"`; Data model.PurchaseOrderList `json:"data"` }
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil || payload.Code != 0 || payload.Data.Total != 0 { t.Fatalf("HTTP identity override: %s, %v", response.Body.String(), err) }
}
