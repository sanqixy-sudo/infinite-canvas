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

func TestAccountAssetFoldersAndAtomicOrganization(t *testing.T) {
	const marker = "ACCOUNT_ASSET_FOLDERS_CHILD"
	if os.Getenv(marker) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAccountAssetFoldersAndAtomicOrganization$", "-test.timeout=35s")
		command.Env = append(os.Environ(), marker+"=1")
		if output, err := command.CombinedOutput(); err != nil { t.Fatalf("isolated asset organization: %v\n%s", err, output) }
		return
	}
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:"}
	db, err := repository.DB()
	if err != nil { t.Fatal(err) }
	connection, err := db.DB()
	if err != nil { t.Fatal(err) }
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })
	for _, user := range []model.User{{ID: "folder-owner", Username: "folder-owner", AffCode: "folder-owner", Role: model.UserRoleUser}, {ID: "folder-other", Username: "folder-other", AffCode: "folder-other", Role: model.UserRoleUser}} { if err := db.Create(&user).Error; err != nil { t.Fatal(err) } }
	owner := WithUser(context.Background(), model.AuthUser{ID: "folder-owner", Role: model.UserRoleUser})
	other := WithUser(context.Background(), model.AuthUser{ID: "folder-other", Role: model.UserRoleUser})
	if _, err := repository.SaveUserConfig(model.UserConfig{UserID: "folder-owner", ModelConfig: `{"textModel":"platform"}`, StorageProvider: `{"preserve":"provider"}`, ImageHistory: `{"preserve":"history"}`, AssetData: `{"categories":["旧分类"],"future":{"keep":true},"assets":[]}`}); err != nil { t.Fatal(err) }
	ptr := func(value string) *string { return &value }
	create := func(ctx context.Context, name, parent string) model.AssetFolder {
		result, err := SaveCurrentUserAssetFolder(ctx, model.AssetFolderInput{Name: ptr(name), ParentID: ptr(parent)})
		if err != nil { t.Fatal(err) }
		for _, folder := range result.Folders { if folder.Name == strings.TrimSpace(name) && folder.ParentID == parent { return folder } }
		t.Fatal("new folder not present in snapshot")
		return model.AssetFolder{}
	}
	root := create(owner, "项目", "")
	child := create(owner, "镜头", root.ID)
	keep := create(owner, "保留目录", "")
	foreign := create(other, "他人目录", "")
	for _, input := range []model.AssetFolderInput{{Name: ptr(" 项目 ")}, {ID: root.ID, ParentID: ptr(child.ID)}, {Name: ptr("无效父级"), ParentID: ptr(foreign.ID)}, {ID: "unknown", Name: ptr("不得创建")}, {}} {
		if _, err := SaveCurrentUserAssetFolder(owner, input); err == nil { t.Fatalf("invalid folder accepted: %#v", input) }
	}
	if _, err := SaveCurrentUserAssetFolder(owner, model.AssetFolderInput{ID: child.ID, Name: ptr("分镜")}); err != nil { t.Fatal(err) }
	if err := db.Create(&model.StorageObject{ID: "folder-file", ObjectKey: "folder/file", CreatedBy: "folder-owner", MimeType: "image/png", Bytes: 24}).Error; err != nil { t.Fatal(err) }
	media := json.RawMessage(fmt.Sprintf(`{"id":"folder-media","kind":"image","title":"原图","tags":[" 首个 ","首个"],"folderIds":[%q,%q],"category":"旧分类","metadata":{"browserSourceId":"image%%3Astable"},"data":{"storageKey":"server:folder-file"}}`, root.ID, keep.ID))
	result, err := SaveCurrentUserAssetItem(owner, media)
	if err != nil || len(result.Folders) != 3 { t.Fatalf("new item folders = %#v, %v", result, err) }
	if _, err := SaveCurrentUserAssetItem(owner, json.RawMessage(fmt.Sprintf(`{"id":"folder-text","kind":"text","title":"文本","tags":[],"folderIds":[%q],"data":{"content":"保留正文"}}`, root.ID))); err != nil { t.Fatal(err) }
	if _, err := SaveCurrentUserAssetItem(owner, json.RawMessage(fmt.Sprintf(`{"id":"bad-folder","kind":"text","title":"无效目录","folderIds":[%q],"data":{"content":"不能写入"}}`, foreign.ID))); err == nil { t.Fatal("foreign folder was accepted") }
	_, err = repository.PatchUserConfig("folder-owner", now(), func(saved *model.UserConfig) error {
		values, assets, err := accountAssetEnvelope(saved.AssetData)
		if err != nil { return err }
		for i, raw := range assets {
			var item map[string]json.RawMessage
			if err := json.Unmarshal(raw, &item); err != nil { return err }
			item["futureItem"] = json.RawMessage(`{"preserve":true}`)
			assets[i], _ = json.Marshal(item)
		}
		values["assets"], _ = json.Marshal(assets)
		encoded, err := json.Marshal(values)
		saved.AssetData = string(encoded)
		return err
	})
	if err != nil { t.Fatal(err) }
	result, err = OrganizeCurrentUserAssets(owner, model.AssetOrganizationInput{IDs: []string{"folder-media", "folder-text"}, AddFolderIDs: []string{child.ID}, RemoveFolderIDs: []string{root.ID}, AddTags: []string{" 新标签 ", "新标签"}, RemoveTags: []string{"首个"}})
	if err != nil || len(result.Assets) != 2 || !strings.Contains(string(result.Assets[0]), "futureItem") || !strings.Contains(string(result.Assets[1]), "旧分类") { t.Fatalf("organization lost fields: %#v, %v", result, err) }
	before, _, err := repository.GetUserConfig("folder-owner")
	if err != nil { t.Fatal(err) }
	for _, input := range []model.AssetOrganizationInput{{IDs: []string{"folder-media", "missing"}, AddTags: []string{"不能部分写入"}}, {IDs: []string{"folder-media"}, AddFolderIDs: []string{foreign.ID}}, {IDs: []string{"folder-media"}, AddFolderIDs: []string{root.ID}, RemoveFolderIDs: []string{root.ID}}, {IDs: []string{"folder-media"}, AddTags: []string{"同一标签"}, RemoveTags: []string{"同一标签"}}, {IDs: []string{"folder-media"}, FolderIDs: &[]string{}, AddFolderIDs: []string{keep.ID}}} {
		if _, err := OrganizeCurrentUserAssets(owner, input); err == nil { t.Fatalf("invalid batch accepted: %#v", input) }
		after, _, err := repository.GetUserConfig("folder-owner")
		if err != nil || after.AssetData != before.AssetData { t.Fatalf("failed batch partially wrote: %v", err) }
	}
	if _, err := OrganizeCurrentUserAssets(other, model.AssetOrganizationInput{IDs: []string{"folder-media"}, AddTags: []string{"不得跨用户"}}); err == nil { t.Fatal("foreign account changed assets") }
	// 旧完整快照既不能清空目录，也不能撤销并发标签。
	stale := json.RawMessage(`{"id":"folder-media","kind":"image","title":"只改标题","tags":[],"folderIds":[],"category":"旧分类","data":{"storageKey":"server:folder-file"}}`)
	var wait sync.WaitGroup
	errors := make(chan error, 18)
	for i := 0; i < 6; i++ {
		wait.Add(3)
		go func(i int) { defer wait.Done(); _, err := OrganizeCurrentUserAssets(owner, model.AssetOrganizationInput{IDs: []string{"folder-media"}, AddTags: []string{fmt.Sprintf("并发%d", i)}}); errors <- err }(i)
		go func() { defer wait.Done(); _, err := SaveCurrentUserAssetItem(owner, stale); errors <- err }()
		go func(i int) { defer wait.Done(); _, err := SaveCurrentUserAssetFolder(owner, model.AssetFolderInput{Name: ptr(fmt.Sprintf("并发目录%d", i))}); errors <- err }(i)
	}
	wait.Wait(); close(errors)
	for err := range errors { if err != nil { t.Fatal(err) } }
	saved, _, err := repository.GetUserConfig("folder-owner")
	if err != nil || saved.StorageProvider != before.StorageProvider || saved.ImageHistory != before.ImageHistory || !strings.Contains(saved.AssetData, `"future"`) || !strings.Contains(saved.AssetData, `"categories"`) { t.Fatalf("unrelated fields lost: %#v, %v", saved, err) }
	values, assets, err := accountAssetEnvelope(saved.AssetData)
	if err != nil { t.Fatal(err) }
	folders, err := accountAssetFolders(values)
	if err != nil || len(folders) != 9 { t.Fatalf("concurrent folders lost: %d, %v", len(folders), err) }
	for _, raw := range assets {
		var item accountAsset
		if err := json.Unmarshal(raw, &item); err != nil { t.Fatal(err) }
		if item.ID != "folder-media" { continue }
		if len(item.FolderIDs) != 2 || !strings.Contains(string(raw), child.ID) || !strings.Contains(string(raw), keep.ID) || len(item.Tags) != 7 { t.Fatalf("stale save overwrote organization: %s", raw) }
	}
	usageBefore, err := CurrentUserStorageUsage(owner)
	if err != nil { t.Fatal(err) }
	result, err = DeleteCurrentUserAssetFolder(owner, root.ID)
	if err != nil || len(result.Assets) != 2 || len(result.Folders) != 7 { t.Fatalf("subtree deletion = %#v, %v", result, err) }
	for _, raw := range result.Assets { if strings.Contains(string(raw), root.ID) || strings.Contains(string(raw), child.ID) { t.Fatalf("removed folder reference remained: %s", raw) } }
	usageAfter, err := CurrentUserStorageUsage(owner)
	if err != nil || usageAfter.UsedBytes != usageBefore.UsedBytes || usageAfter.UsedBytes != 24 { t.Fatalf("folder deletion changed quota: %#v, %v", usageAfter, err) }
	if _, err := repository.GetStorageObject("folder-file"); err != nil { t.Fatalf("folder deletion removed physical index: %v", err) }
	// 其他设备已经删除目录，旧窗口只改详情时不应校验或恢复旧目录。
	result, err = SaveCurrentUserAssetItem(owner, media)
	if err != nil { t.Fatalf("stale deleted-folder snapshot blocked details save: %v", err) }
	for _, raw := range result.Assets {
		var item accountAsset
		if err := json.Unmarshal(raw, &item); err != nil { t.Fatal(err) }
		if item.ID == "folder-media" && (len(item.FolderIDs) != 1 || item.FolderIDs[0] != keep.ID || len(item.Tags) != 7) { t.Fatalf("stale deleted folders or tags restored: %s", raw) }
	}
	cleared := []string{}
	result, err = OrganizeCurrentUserAssets(owner, model.AssetOrganizationInput{IDs: []string{"folder-media"}, FolderIDs: &cleared})
	if err != nil { t.Fatal(err) }
	for _, raw := range result.Assets { var item accountAsset; _ = json.Unmarshal(raw, &item); if item.ID == "folder-media" && len(item.FolderIDs) != 0 { t.Fatal("explicit empty folders did not unclassify item") } }
}

func TestAssetFolderTreeAndOrganizationLimits(t *testing.T) {
	folders := []model.AssetFolder{}
	for i := 0; i < 8; i++ { parent := ""; if i > 0 { parent = fmt.Sprint(i-1) }; folders = append(folders, model.AssetFolder{ID: fmt.Sprint(i), Name: "目录", ParentID: parent}) }
	if err := validateAssetFolderTree(folders); err != nil { t.Fatal(err) }
	if err := validateAssetFolderTree(append(folders, model.AssetFolder{ID: "9", Name: "过深", ParentID: "7"})); err == nil { t.Fatal("ninth level accepted") }
	if err := validateAssetFolderTree([]model.AssetFolder{{ID: "a", Name: "Same"}, {ID: "b", Name: " same "}}); err == nil { t.Fatal("trim/case duplicate sibling accepted") }
	if _, err := normalizeAssetIDs(make([]string, 33), 32); err == nil { t.Fatal("too many folder IDs accepted") }
	if _, err := normalizeAssetIDs(make([]string, 201), 200); err == nil { t.Fatal("too many batch items accepted") }
	if _, err := normalizeAssetTags([]string{strings.Repeat("字", 81)}); err == nil { t.Fatal("oversize tag accepted") }
	tooMany := []model.AssetFolder{}
	for i := 0; i < 1001; i++ { tooMany = append(tooMany, model.AssetFolder{ID: fmt.Sprint(i), Name: fmt.Sprint(i)}) }
	if err := validateAssetFolderTree(tooMany); err == nil { t.Fatal("more than 1000 folders accepted") }
}
