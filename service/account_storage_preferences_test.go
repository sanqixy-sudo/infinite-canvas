package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

func TestAccountStoragePreferencesAndAtomicAssets(t *testing.T) {
	const marker = "ACCOUNT_STORAGE_PREFERENCES_CHILD"
	if os.Getenv(marker) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAccountStoragePreferencesAndAtomicAssets$", "-test.timeout=35s")
		command.Env = append(os.Environ(), marker+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("isolated account storage: %v\n%s", err, output)
		}
		return
	}
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:"}
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
	for _, user := range []model.User{{ID: "owner", Username: "owner", AffCode: "owner", Role: model.UserRoleUser}, {ID: "other", Username: "other", AffCode: "other", Role: model.UserRoleUser}} {
		if err := db.Create(&user).Error; err != nil {
			t.Fatal(err)
		}
	}
	owner := WithUser(context.Background(), model.AuthUser{ID: "owner", Role: model.UserRoleUser})
	other := WithUser(context.Background(), model.AuthUser{ID: "other", Role: model.UserRoleUser})
	if value, err := CurrentUserStoragePreferences(owner); err != nil || value.AutoSaveAssetsToCloud {
		t.Fatalf("default preference = %#v, %v", value, err)
	}
	if _, err := SaveCurrentUserStoragePreferences(context.Background(), true); err == nil {
		t.Fatal("anonymous preference write accepted")
	}
	legacy := model.UserConfig{UserID: "owner", ModelConfig: `{"textModel":"platform","apiKey":"retired-secret"}`, StorageProvider: `{"marker":"provider"}`, ImageHistory: `{"marker":"history"}`, AssetData: `{"categories":["legacy-category"],"assets":[{"id":"legacy","kind":"image","metadata":{"keep":true},"data":{"storageKey":"image:legacy"}}]}`}
	if _, err := repository.SaveUserConfig(legacy); err != nil {
		t.Fatal(err)
	}
	if _, err := SaveCurrentUserStoragePreferences(owner, true); err != nil {
		t.Fatal(err)
	}
	if _, err := SaveCurrentUserModelConfig(owner, json.RawMessage(`{"textModel":"updated-platform","autoSaveAssetsToCloud":false}`)); err != nil {
		t.Fatal(err)
	}
	if value, err := CurrentUserStoragePreferences(owner); err != nil || !value.AutoSaveAssetsToCloud {
		t.Fatalf("model save overrode authoritative storage preference: %#v, %v", value, err)
	}
	saved, _, err := repository.GetUserConfig("owner")
	if err != nil || saved.StorageProvider != legacy.StorageProvider || saved.ImageHistory != legacy.ImageHistory || saved.AssetData != legacy.AssetData || !strings.Contains(saved.ModelConfig, "retired-secret") || !strings.Contains(saved.ModelConfig, "updated-platform") {
		t.Fatalf("unrelated account fields lost: %#v, %v", saved, err)
	}
	if value, err := CurrentUserStoragePreferences(other); err != nil || value.AutoSaveAssetsToCloud {
		t.Fatalf("account preference leaked: %#v, %v", value, err)
	}
	for _, object := range []model.StorageObject{{ID: "owned-image", ObjectKey: "owned/image", CreatedBy: "owner", MimeType: "image/png", Bytes: 24}, {ID: "other-image", ObjectKey: "other/image", CreatedBy: "other", MimeType: "image/jpeg", Bytes: 50}, {ID: "unsupported", ObjectKey: "owned/archive", CreatedBy: "owner", MimeType: "application/zip", Bytes: 10}} {
		if err := db.Create(&object).Error; err != nil {
			t.Fatal(err)
		}
	}
	media := json.RawMessage(`{"id":"cloud-media","kind":"video","title":"归档图片","coverUrl":"blob:old","createdAt":"client-time","metadata":{"prompt":"保留创作说明","nested":{"keep":true}},"data":{"storageKey":"server:owned-image","url":"https://unarchived.invalid/file","dataUrl":"blob:old","bytes":999999,"mimeType":"video/mp4","width":32,"height":16}}`)
	result, err := SaveCurrentUserAssetItem(owner, media)
	if err != nil || len(result.Assets) != 2 {
		t.Fatalf("media save = %#v, %v", result, err)
	}
	var canonical accountAsset
	if err := json.Unmarshal(result.Assets[0], &canonical); err != nil || canonical.Kind != "image" || canonical.Data.Bytes != 24 || canonical.Data.MimeType != "image/png" || canonical.Data.DataURL != "/api/files/owned-image/content" || canonical.Data.URL != "" || canonical.CreatedAt == "client-time" {
		t.Fatalf("client media data was trusted: %#v, %v", canonical, err)
	}
	if strings.Contains(string(result.Assets[0]), "blob:") || strings.Contains(string(result.Assets[0]), "unarchived.invalid") || !strings.Contains(string(result.Assets[0]), "保留创作说明") {
		t.Fatal("media references not normalized or metadata lost")
	}
	if result, err := SaveCurrentUserAssetItem(owner, media); err != nil || len(result.Assets) != 2 {
		t.Fatalf("same-ID retry duplicated item: %#v, %v", result, err)
	}
	duplicate := json.RawMessage(`{"id":"different-id","kind":"image","title":"相同文件","data":{"storageKey":"server:owned-image"}}`)
	if result, err := SaveCurrentUserAssetItem(owner, duplicate); err != nil || len(result.Assets) != 2 || !strings.Contains(string(result.Assets[0]), "cloud-media") {
		t.Fatalf("same-storage retry duplicated file: %#v, %v", result, err)
	}
	updateToDuplicate := json.RawMessage(`{"id":"legacy","kind":"image","title":"不能覆盖其他条目","data":{"storageKey":"server:owned-image"}}`)
	if result, err := SaveCurrentUserAssetItem(owner, updateToDuplicate); err != nil || len(result.Assets) != 2 || !strings.Contains(string(result.Assets[0]), "cloud-media") || !strings.Contains(string(result.Assets[1]), "image:legacy") || strings.Contains(string(result.Assets[1]), "server:owned-image") {
		t.Fatalf("changing an existing ID duplicated storage or overwrote its original item: %#v, %v", result, err)
	}
	for _, key := range []string{"image:local", "file:local", "blob:local", "https://unarchived.invalid/image.png", "server:other-image", "server:missing", "server:unsupported"} {
		asset := json.RawMessage(fmt.Sprintf(`{"id":"invalid","kind":"image","title":"无效引用","data":{"storageKey":%q}}`, key))
		if _, err := SaveCurrentUserAssetItem(owner, asset); err == nil {
			t.Fatalf("invalid or foreign file accepted: %s", key)
		}
	}
	var wait sync.WaitGroup
	errors := make(chan error, 18)
	for i := 0; i < 6; i++ {
		wait.Add(3)
		go func() { defer wait.Done(); _, err := SaveCurrentUserStoragePreferences(owner, true); errors <- err }()
		go func() {
			defer wait.Done()
			_, err := SaveCurrentUserModelConfig(owner, json.RawMessage(`{"textModel":"concurrent-platform","autoSaveAssetsToCloud":false}`))
			errors <- err
		}()
		go func(i int) {
			defer wait.Done()
			_, err := SaveCurrentUserAssetItem(owner, json.RawMessage(fmt.Sprintf(`{"id":"text-%d","kind":"text","title":"文本","data":{"content":"并发保存"}}`, i)))
			errors <- err
		}(i)
	}
	wait.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	if value, err := CurrentUserStoragePreferences(owner); err != nil || !value.AutoSaveAssetsToCloud {
		t.Fatalf("concurrent preference lost: %#v, %v", value, err)
	}
	saved, _, err = repository.GetUserConfig("owner")
	var assets AccountAssetData
	if err != nil || json.Unmarshal([]byte(saved.AssetData), &assets) != nil || len(assets.Assets) != 8 || !strings.Contains(saved.AssetData, "image:legacy") || !strings.Contains(saved.AssetData, "legacy-category") || saved.StorageProvider != legacy.StorageProvider {
		t.Fatalf("concurrent merge lost data: %#v, %v", saved, err)
	}
	if result, err := DeleteCurrentUserAssetItem(other, "cloud-media"); err != nil || len(result.Assets) != 0 {
		t.Fatalf("other account delete result = %#v, %v", result, err)
	}
	if result, err := DeleteCurrentUserAssetItem(owner, "cloud-media"); err != nil || len(result.Assets) != 7 {
		t.Fatalf("delete did not preserve remaining items: %#v, %v", result, err)
	}
	if _, err := repository.GetStorageObject("owned-image"); err != nil {
		t.Fatalf("deleting library item deleted the file: %v", err)
	}
	if _, err := SaveCurrentUserAssetData(owner, json.RawMessage(`{"assets":[]}`)); err == nil {
		t.Fatal("legacy list overwrite remained enabled")
	}
}
