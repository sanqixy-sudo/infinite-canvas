package service

import (
	"context"
	"os"
	"os/exec"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

func TestAdminUserEditingPreservesPurchasedStorage(t *testing.T) {
	const marker = "ADMIN_USER_ASSETS_CHILD"
	if os.Getenv(marker) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAdminUserEditingPreservesPurchasedStorage$", "-test.timeout=25s")
		cmd.Env = append(os.Environ(), marker+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("isolated user asset policy: %v\n%s", err, output)
		}
		return
	}
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:"}
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
	created, err := SaveUser(model.User{Username: "new-user", StorageExtraBytes: 1 << 30}, "test-password")
	if err != nil || created.StorageExtraBytes != 0 {
		t.Fatalf("admin user creation granted unreviewed storage: %+v %v", created, err)
	}
	if err := database.Model(&model.User{}).Where("id = ?", created.ID).Updates(map[string]any{"credits": 12.34, "storage_extra_bytes": 4567}).Error; err != nil {
		t.Fatal(err)
	}
	updated, err := SaveUser(model.User{ID: created.ID, Username: created.Username, DisplayName: "编辑后的用户", StorageExtraBytes: 0, Credits: 0}, "")
	if err != nil || updated.StorageExtraBytes != 4567 || updated.Credits != 12.34 || updated.DisplayName != "编辑后的用户" {
		t.Fatalf("ordinary user edit cleared purchased assets: %+v %v", updated, err)
	}
	if err := database.Model(&model.User{}).Where("id = ?", created.ID).Updates(map[string]any{"credits": 24.68, "storage_extra_bytes": 8910}).Error; err != nil {
		t.Fatal(err)
	}
	session, err := Login(created.Username, "test-password")
	if err != nil || session.User.Credits != 24.68 {
		t.Fatalf("login lost granted credits: %+v %v", session.User, err)
	}
	saved, found, err := repository.GetUserByID(created.ID)
	if err != nil || !found || saved.StorageExtraBytes != 8910 || saved.Credits != 24.68 {
		t.Fatalf("login lost purchased storage: %+v %v", saved, err)
	}
}
