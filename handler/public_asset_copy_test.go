package handler

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"github.com/tigerowo/infinite-canvas/service"
)

func TestPublicAssetCopyRemainsOwnedAfterWithdrawal(t *testing.T) {
	const marker = "PUBLIC_ASSET_COPY_CHILD"
	if os.Getenv(marker) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestPublicAssetCopyRemainsOwnedAfterWithdrawal$", "-test.timeout=25s")
		cmd.Env = append(os.Environ(), marker+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("isolated public asset copy: %v\n%s", err, output)
		}
		return
	}
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:", LocalStorageDir: t.TempDir(), JWTSecret: "public-asset-test-secret"}
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
		{ID: "admin-owner", Username: "admin-owner", AffCode: "admin-owner", Role: model.UserRoleAdmin, Status: model.UserStatusActive},
		{ID: "member-owner", Username: "member-owner", AffCode: "member-owner", Role: model.UserRoleUser, Status: model.UserStatusActive},
	} {
		if err := db.Create(&user).Error; err != nil {
			t.Fatal(err)
		}
	}
	admin := service.WithUser(context.Background(), model.AuthUser{ID: "admin-owner", Role: model.UserRoleAdmin})
	member := service.WithUser(context.Background(), model.AuthUser{ID: "member-owner", Role: model.UserRoleUser})
	original, err := service.UploadStorageObject(admin, "library.png", "image/png", []byte("public-media-content"))
	if err != nil {
		t.Fatal(err)
	}
	asset, err := service.SaveAsset(model.Asset{Type: model.AssetTypeImage, Title: "Published", URL: original.URL})
	if err != nil {
		t.Fatal(err)
	}
	current, err := service.PublicAsset(asset.ID)
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	FileContent(response, httptest.NewRequest(http.MethodGet, current.URL, nil), original.ID)
	if response.Code != http.StatusOK || response.Body.String() != "public-media-content" {
		t.Fatalf("published content unavailable: %d %s", response.Code, response.Body.String())
	}
	if _, err := service.StorageObjectInfo(member, original.ID); !errors.Is(err, service.ErrStorageAccessDenied) {
		t.Fatalf("publishing exposed owner's private metadata: %v", err)
	}
	copy, err := service.UploadStorageObject(member, "copy.png", "image/png", response.Body.Bytes())
	if err != nil || copy.ID == original.ID {
		t.Fatalf("independent copy failed: %#v %v", copy, err)
	}
	info, err := service.StorageObjectInfo(member, copy.ID)
	if err != nil || info.CreatedBy != "member-owner" {
		t.Fatalf("copy has wrong owner: %#v %v", info, err)
	}
	if err := service.DeleteAsset(asset.ID); err != nil {
		t.Fatal(err)
	}
	withdrawn := httptest.NewRecorder()
	PublicAsset(withdrawn, httptest.NewRequest(http.MethodGet, "/api/assets/"+asset.ID, nil), asset.ID)
	if withdrawn.Code != http.StatusNotFound {
		t.Fatalf("withdrawn public item remained importable: %d", withdrawn.Code)
	}
	download, err := service.DownloadStorageObject(member, copy.ID, "", "")
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(download.Stream)
	_ = download.Stream.Close()
	if err != nil || string(body) != "public-media-content" {
		t.Fatalf("withdrawal damaged owned copy: %q %v", body, err)
	}
	if err := service.DeleteStorageObject(member, original.ID, nil); !errors.Is(err, service.ErrStorageAccessDenied) {
		t.Fatalf("member could delete shared original: %v", err)
	}
	if err := service.DeleteStorageObject(member, copy.ID, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := service.StorageObjectInfo(admin, original.ID); err != nil {
		t.Fatalf("deleting copy damaged original: %v", err)
	}
}
