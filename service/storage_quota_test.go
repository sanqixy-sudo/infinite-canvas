package service

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

type storageQuotaTransport func(*http.Request) (*http.Response, error)

func (transport storageQuotaTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func TestUserStorageQuotaAcrossUploadAndDirectRegistration(t *testing.T) {
	const marker = "USER_STORAGE_QUOTA_CHILD"
	if os.Getenv(marker) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestUserStorageQuotaAcrossUploadAndDirectRegistration$", "-test.timeout=35s")
		cmd.Env = append(os.Environ(), marker+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("isolated quota paths: %v\n%s", err, output)
		}
		return
	}
	directory := t.TempDir()
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:", LocalStorageDir: directory, JWTSecret: "quota-test"}
	database, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })
	user := model.User{ID: "quota-user", Username: "quota-user", AffCode: "quota-user", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if err := database.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	ctx := WithUser(context.Background(), model.PublicUser(user))
	if _, err := SaveCommerceSettings(ctx, model.CommerceSetting{DefaultStorageBytes: 8}); err != nil {
		t.Fatal(err)
	}
	for _, object := range []model.StorageObject{
		{ID: "existing-local", ObjectKey: "existing-local", ProviderID: localStorageProviderID, CreatedBy: user.ID, Bytes: 2},
		{ID: "existing-r2", ObjectKey: "existing-r2", ProviderID: "old-r2", CreatedBy: user.ID, Bytes: 2},
	} {
		if _, err := repository.SaveStorageObject(object); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := UploadStorageObject(ctx, "too-large.bin", "application/octet-stream", []byte("12345")); err == nil {
		t.Fatal("cross-provider used bytes were ignored")
	}
	blockedDirectory := filepath.Join(t.TempDir(), "occupied")
	if err := os.WriteFile(blockedDirectory, []byte("occupied"), 0o600); err != nil {
		t.Fatal(err)
	}
	config.Cfg.LocalStorageDir = blockedDirectory
	if _, err := UploadStorageObject(ctx, "failed.bin", "application/octet-stream", []byte("1234")); err == nil {
		t.Fatal("upload into a non-directory should fail")
	}
	config.Cfg.LocalStorageDir = directory
	var pending int64
	if err := database.Model(&model.StorageUploadReservation{}).Count(&pending).Error; err != nil || pending != 0 {
		t.Fatalf("failed upload leaked quota: %d %v", pending, err)
	}
	upload, err := UploadStorageObject(ctx, "fits.bin", "application/octet-stream", []byte("1234"))
	if err != nil || upload.Bytes != 4 {
		t.Fatalf("upload after failure: %+v %v", upload, err)
	}
	usage, err := CurrentUserStorageUsage(ctx)
	if err != nil || usage.UsedBytes != 8 || usage.LimitBytes != 8 || usage.RemainingBytes != 0 {
		t.Fatalf("actual upload quota: %+v %v", usage, err)
	}
	if err := DeleteStorageObject(ctx, upload.ID, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := SaveCommerceSettings(ctx, model.CommerceSetting{DefaultStorageBytes: 3}); err != nil {
		t.Fatal(err)
	}
	usage, err = CurrentUserStorageUsage(ctx)
	if err != nil || !usage.OverLimit || usage.UsedBytes != 4 || usage.RemainingBytes != 0 {
		t.Fatalf("lowering allowance deleted or miscounted files: %+v %v", usage, err)
	}
	if _, err := UploadStorageObject(ctx, "blocked.bin", "application/octet-stream", []byte("1")); err == nil {
		t.Fatal("over-limit account uploaded a new file")
	}
	if _, err := SaveCommerceSettings(ctx, model.CommerceSetting{DefaultStorageBytes: 8}); err != nil {
		t.Fatal(err)
	}
	if err := database.Model(&model.User{}).Where("id = ?", user.ID).Update("storage_extra_bytes", 2).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := repository.SaveSettings(model.Settings{Private: model.PrivateSetting{Storage: model.PrivateStorageSetting{Mode: "local", AllowUserProvider: true, AllowUserGlobalProvider: true}}}, "fixture"); err != nil {
		t.Fatal(err)
	}
	actualSize := int64(7)
	savedClient := safeProxyHTTPClient
	safeProxyHTTPClient = &http.Client{Transport: storageQuotaTransport(func(request *http.Request) (*http.Response, error) {
		if request.Method != "PROPFIND" {
			t.Fatalf("unexpected WebDAV metadata request: %s", request.Method)
		}
		body := fmt.Sprintf(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/canvas/quota-user/upload.bin</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>%d</d:getcontentlength><d:getlastmodified>Thu, 22 Oct 2026 00:00:00 GMT</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`, actualSize)
		return &http.Response{StatusCode: http.StatusMultiStatus, Header: http.Header{"Content-Type": {"application/xml"}}, Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
	})}
	t.Cleanup(func() { safeProxyHTTPClient = savedClient })
	enabled := true
	input := DirectStorageObjectInput{Provider: StorageObjectProviderInput{Enabled: &enabled, Type: model.StorageProviderTypeWebDAV, Endpoint: "https://dav.invalid", Username: "quota-user", Password: "test-only", PathPrefix: "canvas"}, ObjectKey: "canvas/quota-user/upload.bin", Bytes: 0}
	if _, err := RegisterDirectStorageObject(ctx, input); err == nil {
		t.Fatal("caller-supplied zero bytes bypassed actual WebDAV size")
	}
	actualSize, input.Bytes = 3, 999
	direct, err := RegisterDirectStorageObject(ctx, input)
	if err != nil || direct.Bytes != 3 {
		t.Fatalf("verified direct registration failed: %+v %v", direct, err)
	}
	usage, err = CurrentUserStorageUsage(ctx)
	if err != nil || usage.UsedBytes != 7 || usage.BaseBytes != 8 || usage.ExtraBytes != 2 || usage.LimitBytes != 10 {
		t.Fatalf("extra space or actual direct size missing: %+v %v", usage, err)
	}
	if err := DeleteDirectStorageObjectRecord(ctx, direct.ID); err != nil {
		t.Fatal(err)
	}
	usage, err = CurrentUserStorageUsage(ctx)
	if err != nil || usage.UsedBytes != 4 || usage.RemainingBytes != 6 {
		t.Fatalf("deleting direct index did not release usage: %+v %v", usage, err)
	}
	if _, err := CurrentUserStorageUsage(context.Background()); err == nil {
		t.Fatal("anonymous user read an account quota")
	}
}
