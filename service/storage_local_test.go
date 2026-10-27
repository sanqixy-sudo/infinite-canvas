package service

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
)

func TestLocalStorageDefaultAndModeSelection(t *testing.T) {
	storage := normalizePrivateStorageSetting(model.PrivateStorageSetting{})
	if storage.Mode != "local" || !storage.AllowUserGlobalProvider || !storage.AutoSyncAllAssets {
		t.Fatalf("unexpected defaults: %#v", storage)
	}
	storage.Providers = []model.StorageProvider{{ID: "r2", Type: model.StorageProviderTypeS3, Enabled: true, Endpoint: "https://account.r2.cloudflarestorage.com", Bucket: "media", AccessKeyID: "key", SecretAccessKey: "secret", Weight: 1}}
	provider, err := selectStorageProvider(storage)
	if err != nil || provider.ID != localStorageProviderID {
		t.Fatalf("configuring R2 should not switch local mode: %#v %v", provider, err)
	}
	storage.Mode = "r2"
	provider, err = selectStorageProvider(storage)
	if err != nil || provider.ID != "r2" {
		t.Fatalf("R2 selection = %#v, %v", provider, err)
	}
	if err := validateStorageMode(model.PrivateStorageSetting{Mode: "r2"}); err == nil {
		t.Fatal("R2 without usable config accepted")
	}
	object := model.StorageObject{ProviderID: localStorageProviderID}
	if old, ok := findStorageProviderForObject(object, append(storage.Providers, localStorageProvider())); !ok || old.Type != model.StorageProviderTypeLocal {
		t.Fatal("switching modes lost local object provider")
	}
	if _, ok := findStorageProviderForObject(model.StorageObject{ProviderID: "removed", Bucket: "media"}, storage.Providers); ok {
		t.Fatal("missing provider must not silently use another provider with the same bucket")
	}
}

func TestLocalStorageRoundTripRangesAndDelete(t *testing.T) {
	savedDir := config.Cfg.LocalStorageDir
	config.Cfg.LocalStorageDir = t.TempDir()
	t.Cleanup(func() { config.Cfg.LocalStorageDir = savedDir })
	key := "user-1/2026/10/21/file.mp4"
	if err := putLocalObject(key, []byte("0123456789")); err != nil {
		t.Fatal(err)
	}
	if err := putLocalObject(key, []byte("overwrite")); err == nil {
		t.Fatal("existing local file was overwritten")
	}
	for _, test := range []struct {
		rangeHeader string
		status      int
		body        string
	}{
		{"", http.StatusOK, "0123456789"},
		{"bytes=2-5", http.StatusPartialContent, "2345"},
		{"bytes=-3", http.StatusPartialContent, "789"},
		{"bytes=20-30", http.StatusRequestedRangeNotSatisfiable, ""},
	} {
		stream, err := getLocalObjectStream(key, test.rangeHeader)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(stream.Body)
		_ = stream.Body.Close()
		if err != nil || stream.StatusCode != test.status || string(body) != test.body || stream.ContentLength != int64(len(test.body)) {
			t.Fatalf("range %q: status=%d body=%q length=%d err=%v", test.rangeHeader, stream.StatusCode, body, stream.ContentLength, err)
		}
	}
	if bytes, err := measureLocalStorage(); err != nil || bytes != 10 {
		t.Fatalf("size = %d, %v", bytes, err)
	}
	if err := deleteLocalObject(key); err != nil {
		t.Fatal(err)
	}
	if _, err := getLocalObjectStream(key, ""); !os.IsNotExist(err) {
		t.Fatalf("deleted file still readable: %v", err)
	}
}

func TestLocalStorageRejectsEscapingPathsAndSymlinks(t *testing.T) {
	for _, key := range []string{"../file", "/absolute", "a/../file", "a//file", "a\\file", "C:/file", ".", ""} {
		if _, err := localObjectPath(key); err == nil {
			t.Fatalf("unsafe path accepted: %q", key)
		}
	}
	savedDir := config.Cfg.LocalStorageDir
	config.Cfg.LocalStorageDir = t.TempDir()
	t.Cleanup(func() { config.Cfg.LocalStorageDir = savedDir })
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(config.Cfg.LocalStorageDir, "escape")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if err := putLocalObject("escape/file.txt", []byte("private")); err == nil {
		t.Fatal("local storage followed a symlink outside its root")
	}
}

func TestStoragePrivateAccessAndScopedExpiringToken(t *testing.T) {
	savedSecret := config.Cfg.JWTSecret
	config.Cfg.JWTSecret = "test-storage-secret"
	t.Cleanup(func() { config.Cfg.JWTSecret = savedSecret })
	object := model.StorageObject{ID: "file-1", CreatedBy: "owner"}
	if storageObjectOwnedBy(context.Background(), object) || storageObjectOwnedBy(WithUser(context.Background(), model.AuthUser{ID: "other", Role: model.UserRoleUser}), object) {
		t.Fatal("private object accessible without its owner")
	}
	if !storageObjectOwnedBy(WithUser(context.Background(), model.AuthUser{ID: "owner", Role: model.UserRoleUser}), object) {
		t.Fatal("owner denied")
	}
	address, err := storageContentURL(object)
	if err != nil {
		t.Fatal(err)
	}
	parsed, _ := url.Parse(address)
	value := parsed.Query().Get("access")
	if !validStorageContentToken(object, value) || validStorageContentToken(model.StorageObject{ID: "file-2", CreatedBy: "owner"}, value) || validStorageContentToken(object, value+"tampered") || validStorageContentToken(object, "") {
		t.Fatal("file token scope or signature validation failed")
	}
	expired, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{Issuer: "xiaomeng-storage", Subject: object.ID, Audience: jwt.ClaimStrings{object.CreatedBy}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Minute))}).SignedString([]byte(config.Cfg.JWTSecret))
	if validStorageContentToken(object, expired) {
		t.Fatal("expired file token accepted")
	}
}
