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

func TestAccountCreditAudit(t *testing.T) {
	const marker = "ACCOUNT_CREDIT_AUDIT_CHILD"
	if os.Getenv(marker) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAccountCreditAudit$", "-test.timeout=25s", "-test.v")
		cmd.Env = append(os.Environ(), marker+"=1")
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("isolated credit audit: %v\n%s", err, output)
		}
		return
	}
	previous := config.Cfg
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:", AILogDir: t.TempDir()}
	t.Cleanup(func() { config.Cfg = previous })
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })
	for _, user := range []model.User{
		{ID: "account-owner", Username: "owner", AffCode: "owner", Credits: 10, Role: model.UserRoleUser, Status: model.UserStatusActive},
		{ID: "other-user", Username: "other", AffCode: "other", Credits: 90, Role: model.UserRoleAdmin, Status: model.UserStatusActive},
	} {
		if err := db.Create(&user).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, log := range []model.CreditLog{
		{ID: "owner-log", UserID: "account-owner", Type: model.CreditLogTypeAIConsume, Amount: -2, Balance: 10, Remark: "image-model", Extra: `{"model":"image-model","private":"must-not-expose"}`},
		{ID: "other-log", UserID: "other-user", Type: model.CreditLogTypeAIRefund, Amount: 2, Balance: 90, Remark: "private-other-model"},
	} {
		if err := db.Create(&log).Error; err != nil {
			t.Fatal(err)
		}
	}
	owner := model.AuthUser{ID: "account-owner", Role: model.UserRoleUser}
	for _, test := range []struct {
		path  string
		total int
	}{
		{"/api/v1/credit-logs?userId=other-user&pageSize=1", 1},
		{"/api/v1/credit-logs?keyword=private-other-model", 0},
		{"/api/v1/credit-logs?type=ai_refund", 0},
	} {
		r := httptest.NewRequest(http.MethodGet, test.path, nil)
		r = r.WithContext(service.WithUser(r.Context(), owner))
		w := httptest.NewRecorder()
		UserCreditLogs(w, r)
		var body struct {
			Code int                        `json:"code"`
			Data model.AccountCreditLogList `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body.Code != 0 || body.Data.Total != test.total || strings.Contains(w.Body.String(), "must-not-expose") || strings.Contains(w.Body.String(), "other-log") {
			t.Fatalf("account isolation failed for %s: %s", test.path, w.Body.String())
		}
	}
	if _, err := service.CurrentUserCreditLogs(context.Background(), model.Query{}); err == nil {
		t.Fatal("anonymous caller could read credit logs")
	}
	admin := model.AuthUser{ID: "other-user", Role: model.UserRoleAdmin}
	for _, body := range []string{`{"id":"owner-log","amount":100}`, `{"id":"fabricated-log","userId":"account-owner","amount":100}`} {
		r := httptest.NewRequest(http.MethodPost, "/api/admin/credit-logs", strings.NewReader(body))
		r = r.WithContext(service.WithUser(r.Context(), admin))
		w := httptest.NewRecorder()
		AdminSaveCreditLog(w, r)
		if w.Code != http.StatusMethodNotAllowed {
			t.Fatalf("credit log write accepted: %d", w.Code)
		}
	}
	r := httptest.NewRequest(http.MethodDelete, "/api/admin/credit-logs/owner-log", nil)
	r = r.WithContext(service.WithUser(r.Context(), admin))
	w := httptest.NewRecorder()
	AdminDeleteCreditLog(w, r, "owner-log")
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("credit log delete accepted: %d", w.Code)
	}
	for _, body := range []string{`{}`, `{"credits":null}`, `{"credits":"bad"}`, `{`} {
		r := httptest.NewRequest(http.MethodPost, "/api/admin/users/account-owner/credits", strings.NewReader(body))
		w := httptest.NewRecorder()
		AdminAdjustUserCredits(w, r, "account-owner")
		if !strings.Contains(w.Body.String(), "有效的目标") {
			t.Fatalf("invalid balance request accepted: %s", w.Body.String())
		}
	}
	var logs []model.CreditLog
	if err := db.Order("id").Find(&logs).Error; err != nil || len(logs) != 2 {
		t.Fatalf("audit log count changed: %#v, err=%v", logs, err)
	}
	user, found, err := repository.GetUserByID("account-owner")
	if err != nil || !found || user.Credits != 10 || logs[1].Amount != -2 {
		t.Fatalf("audit/balance changed: %#v, logs=%#v, err=%v", user, logs, err)
	}
}
