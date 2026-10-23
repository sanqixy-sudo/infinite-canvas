package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"gorm.io/gorm"
)

func TestStorageFileManagement(t *testing.T) {
	const marker = "STORAGE_FILES_CHILD"
	if os.Getenv(marker) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 75*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestStorageFileManagement$", "-test.timeout=70s")
		command.Env = append(os.Environ(), marker+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("isolated storage files: %v\n%s", err, output)
		}
		return
	}
	root := t.TempDir()
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: filepath.Join(root, "test.db"), LocalStorageDir: filepath.Join(root, "media"), JWTSecret: "storage-files-test-only"}
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
	for _, id := range []string{"file-owner", "file-other"} {
		if err := db.Create(&model.User{ID: id, Username: id, AffCode: id, Role: model.UserRoleUser}).Error; err != nil {
			t.Fatal(err)
		}
	}
	owner := WithUser(context.Background(), model.AuthUser{ID: "file-owner", Role: model.UserRoleUser})
	other := WithUser(context.Background(), model.AuthUser{ID: "file-other", Role: model.UserRoleUser})
	makeFile := func(id, user string) model.StorageObject {
		t.Helper()
		object := model.StorageObject{ID: id, ProviderID: localStorageProviderID, ObjectKey: user + "/" + id + ".png", MimeType: "image/png", Bytes: 4, CreatedBy: user, CreatedAt: "2026-10-22T00:00:00Z"}
		if err := putLocalObject(object.ObjectKey, []byte("data")); err != nil {
			t.Fatal(err)
		}
		if _, err := repository.SaveStorageObject(object); err != nil {
			t.Fatal(err)
		}
		return object
	}
	asset := func(id string, file model.StorageObject) json.RawMessage {
		raw, _ := json.Marshal(map[string]any{"id": id, "title": "城市镜头", "kind": "image", "tags": []string{"镜头"}, "data": map[string]any{"storageKey": "server:" + file.ID}})
		return raw
	}
	project := func(id string, file model.StorageObject) json.RawMessage {
		raw, _ := json.Marshal(map[string]any{"id": id, "title": "保护画布", "createdAt": "2026-10-22T00:00:00Z", "updatedAt": "2026-10-22T01:00:00Z", "nodes": []any{map[string]any{"id": "node", "metadata": map[string]any{"storageKey": "server:" + file.ID, "dataUrl": "/api/files/" + file.ID + "/content?access=test"}}}})
		return raw
	}
	t.Run("all occupied files are owner isolated and paginated", func(t *testing.T) {
		orphan := makeFile("orphan", "file-owner")
		makeFile("foreign", "file-other")
		list, err := CurrentUserStorageFiles(owner, model.Query{PageSize: 1})
		if err != nil || list.Total != 1 || len(list.Items) != 1 || list.Items[0].File.ID != orphan.ID || list.Items[0].AssetCount != 0 {
			t.Fatalf("orphan list: %+v %v", list, err)
		}
		if _, err := CurrentUserStorageFileReferences(other, orphan.ID); err == nil {
			t.Fatal("other user read private references")
		}
		if _, err := DeleteCurrentUserStorageFile(other, orphan.ID, true, nil); !errors.Is(err, ErrStorageAccessDenied) {
			t.Fatalf("other-user deletion did not retain permission error: %v", err)
		}
		if _, err := CurrentUserStorageFiles(context.Background(), model.Query{}); err == nil {
			t.Fatal("anonymous file listing")
		}
	})
	t.Run("canvas and history references block and stale saves fail", func(t *testing.T) {
		file := makeFile("canvas-file", "file-owner")
		raw := project("protected-canvas", file)
		if _, err := SaveCurrentUserCanvasProject(owner, raw); err != nil {
			t.Fatal(err)
		}
		refs, err := CurrentUserStorageFileReferences(owner, file.ID)
		if err != nil || refs.CanDelete || len(refs.Blockers) != 1 || refs.Blockers[0].Type != "canvas" {
			t.Fatalf("canvas refs: %+v %v", refs, err)
		}
		if _, err := DeleteCurrentUserStorageFile(owner, file.ID, true, nil); err == nil {
			t.Fatal("referenced canvas file deleted")
		}
		if err := DeleteCurrentUserCanvasProjects(owner, []string{"protected-canvas"}); err != nil {
			t.Fatal(err)
		}
		log := json.RawMessage(fmt.Sprintf(`{"id":"file-history","status":"completed","image":{"storageKey":"server:%s"}}`, file.ID))
		if _, err := SaveCurrentUserImageGenerationLogs(owner, []json.RawMessage{log}); err != nil {
			t.Fatal(err)
		}
		if _, err := DeleteCurrentUserStorageFile(owner, file.ID, true, nil); err == nil {
			t.Fatal("history file deleted")
		}
		if err := DeleteCurrentUserImageGenerationLog(owner, "file-history"); err != nil {
			t.Fatal(err)
		}
		if result, err := DeleteCurrentUserStorageFile(owner, file.ID, true, nil); err != nil || result.FreedBytes != 4 {
			t.Fatalf("release: %+v %v", result, err)
		}
		if result, err := DeleteCurrentUserStorageFile(owner, file.ID, true, nil); err != nil || result.FreedBytes != 0 {
			t.Fatalf("repeat delete: %+v %v", result, err)
		}
		if _, err := SaveCurrentUserCanvasProject(owner, project("stale-new-canvas", file)); err == nil {
			t.Fatal("old file reference restored after deletion")
		}
		if _, err := SaveCurrentUserVideoGenerationLogs(owner, []json.RawMessage{json.RawMessage(fmt.Sprintf(`{"id":"stale-video","video":{"url":"/api/files/%s/content"}}`, file.ID))}); err == nil {
			t.Fatal("stale history reference saved")
		}
		if _, err := SaveCurrentUserImageHistory(owner, json.RawMessage(fmt.Sprintf(`{"logs":[{"image":{"storageKey":"server:%s"}}]}`, file.ID))); err == nil {
			t.Fatal("legacy history bypassed validation")
		}
	})
	t.Run("explicit cleanup removes records and completed output without other account changes", func(t *testing.T) {
		file := makeFile("asset-file", "file-owner")
		if _, err := SaveCurrentUserAssetItem(owner, asset("linked-asset", file)); err != nil {
			t.Fatal(err)
		}
		list, err := CurrentUserStorageFiles(owner, model.Query{Keyword: "城市镜头"})
		if err != nil || list.Total != 1 || list.Items[0].File.ID != file.ID {
			t.Fatalf("visible name search: %+v %v", list, err)
		}
		task := model.CanvasImageTask{ID: "finished-file-task", UserID: "file-owner", Status: "completed", StorageKey: "server:" + file.ID, ImageURL: "/api/files/" + file.ID + "/content", ImageURLs: []string{"/api/files/" + file.ID + "/content", "https://unrelated.invalid/image.png"}, Prompt: "保留提示词", Credits: 2, ResponseBody: "保留审计"}
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
		refs, err := CurrentUserStorageFileReferences(owner, file.ID)
		if err != nil || !refs.CanDelete || refs.AssetCount != 1 || refs.CompletedTaskCount != 1 {
			t.Fatalf("soft refs: %+v %v", refs, err)
		}
		if _, err := DeleteCurrentUserStorageFile(owner, file.ID, false, nil); err == nil {
			t.Fatal("implicit removal accepted")
		}
		if _, err := DeleteCurrentUserStorageFile(owner, file.ID, true, nil); err != nil {
			t.Fatal(err)
		}
		data, err := CurrentUserAssetData(owner)
		if err != nil || strings.Contains(string(data), "linked-asset") {
			t.Fatalf("dangling asset: %s %v", data, err)
		}
		var saved model.CanvasImageTask
		if err := db.First(&saved, "id = ?", task.ID).Error; err != nil || saved.StorageKey != "" || saved.ImageURL != "" || len(saved.ImageURLs) != 1 || saved.Prompt != task.Prompt || saved.Credits != task.Credits || saved.ResponseBody != task.ResponseBody {
			t.Fatalf("task audit damaged: %+v %v", saved, err)
		}
		if _, err := getLocalObjectStream(file.ObjectKey, ""); !os.IsNotExist(err) {
			t.Fatalf("physical file remained: %v", err)
		}
	})
	t.Run("other account and active task references are protected", func(t *testing.T) {
		file := makeFile("shared-file", "file-owner")
		if _, err := SaveCurrentUserCanvasProject(other, project("other-private-title", file)); err != nil {
			t.Fatal(err)
		}
		refs, err := CurrentUserStorageFileReferences(owner, file.ID)
		if err != nil || refs.CanDelete || refs.Blockers[0].Type != "otherAccount" || refs.Blockers[0].ID != "" || strings.Contains(refs.Blockers[0].Title, "private") {
			t.Fatalf("cross-account refs leak: %+v %v", refs, err)
		}
		if err := DeleteCurrentUserCanvasProjects(other, []string{"other-private-title"}); err != nil {
			t.Fatal(err)
		}
		task, err := CreateCanvasAudioTask(CanvasAudioTaskCreateInput{UserID: "file-owner", ClientTaskID: "active-file-task", RequestBody: fmt.Sprintf(`{"referenceAudios":["/api/files/%s/content"]}`, file.ID)})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := DeleteCurrentUserStorageFile(owner, file.ID, true, nil); err == nil {
			t.Fatal("active input removed")
		}
		task.Status = "completed"
		task.AudioURL, task.StorageKey = "/api/files/"+file.ID+"/content", "server:"+file.ID
		task.UserID = "file-other"
		if err := db.Model(&model.CanvasAudioTask{}).Where("id = ?", task.ID).Updates(map[string]any{"status": task.Status, "user_id": task.UserID, "audio_url": task.AudioURL, "storage_key": task.StorageKey}).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := DeleteCurrentUserStorageFile(owner, file.ID, true, nil); err == nil {
			t.Fatal("other account completed output removed")
		}
		if err := db.Delete(&model.CanvasAudioTask{}, "id = ?", task.ID).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := DeleteCurrentUserStorageFile(owner, file.ID, true, nil); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("published review protects media until revoked", func(t *testing.T) {
		file := makeFile("review-media", "file-owner")
		team := model.Team{ID: "storage-review-team", Name: "审片团队", OwnerID: "file-owner"}
		if err := repository.CreateTeam(team, model.TeamMember{TeamID: team.ID, UserID: "file-owner", Role: "owner"}); err != nil {
			t.Fatal(err)
		}
		review := model.ProductionReview{ID: "storage-review", TeamID: team.ID, PublisherID: "file-owner", Title: "第一版审片", MediaObjectIDs: []string{file.ID}}
		if err := db.Create(&review).Error; err != nil {
			t.Fatal(err)
		}
		refs, err := CurrentUserStorageFileReferences(owner, file.ID)
		if err != nil || refs.CanDelete || len(refs.Blockers) != 1 || refs.Blockers[0].Type != "published" || refs.Blockers[0].ID != review.ID {
			t.Fatalf("review media protection: %+v %v", refs, err)
		}
		if _, err := DeleteCurrentUserStorageFile(owner, file.ID, true, nil); err == nil {
			t.Fatal("unrevoked review media deleted")
		}
		if err := RevokeCurrentProductionReview(owner, review.ID); err != nil {
			t.Fatal(err)
		}
		refs, err = CurrentUserStorageFileReferences(owner, file.ID)
		if err != nil || !refs.CanDelete || len(refs.Blockers) != 0 {
			t.Fatalf("revoked review retained media protection: %+v %v", refs, err)
		}
		if result, err := DeleteCurrentUserStorageFile(owner, file.ID, true, nil); err != nil || result.FreedBytes != file.Bytes {
			t.Fatalf("revoked review media release: %+v %v", result, err)
		}
	})
	t.Run("queued and running renders protect clip and audio inputs", func(t *testing.T) {
		for _, state := range []struct{ active, terminal string }{{"queued", "cancelled"}, {"running", "failed"}} {
			clip := makeFile("render-clip-"+state.active, "file-owner")
			audio := makeFile("render-audio-"+state.active, "file-owner")
			raw, err := json.Marshal(map[string]any{"clips": []any{map[string]any{"storageKey": "server:" + clip.ID}}, "delivery": map[string]any{"audioTracks": []any{map[string]any{"storageKey":"server:"+audio.ID}}}})
			if err != nil {
				t.Fatal(err)
			}
			job := model.ProductionRenderJob{ID: "storage-render-" + state.active, UserID: "file-owner", RequestID: "storage-render-" + state.active, Status: state.active, SnapshotJSON: string(raw)}
			if err := db.Create(&job).Error; err != nil {
				t.Fatal(err)
			}
			for _, file := range []model.StorageObject{clip, audio} {
				refs, err := CurrentUserStorageFileReferences(owner, file.ID)
				if err != nil || refs.CanDelete || len(refs.Blockers) != 1 || refs.Blockers[0].Type != "activeTask" || refs.Blockers[0].ID != job.ID {
					t.Fatalf("%s render input %s: %+v %v", state.active, file.ID, refs, err)
				}
				if _, err := DeleteCurrentUserStorageFile(owner, file.ID, true, nil); err == nil {
					t.Fatalf("%s render input deleted: %s", state.active, file.ID)
				}
			}
			if err := db.Model(&job).Update("status", state.terminal).Error; err != nil {
				t.Fatal(err)
			}
			for _, file := range []model.StorageObject{clip, audio} {
				refs, err := CurrentUserStorageFileReferences(owner, file.ID)
				if err != nil || !refs.CanDelete || len(refs.Blockers) != 0 {
					t.Fatalf("%s render retained input %s: %+v %v", state.terminal, file.ID, refs, err)
				}
				if result, err := DeleteCurrentUserStorageFile(owner, file.ID, true, nil); err != nil || result.FreedBytes != file.Bytes {
					t.Fatalf("%s render input release %s: %+v %v", state.terminal, file.ID, result, err)
				}
			}
		}
	})
	t.Run("saved episode delivery protects audio until detached",func(t *testing.T){
		file:=makeFile("delivery-audio","file-owner")
		project:=model.ProductionProject{ID:"delivery-plan",UserID:"file-owner",WorkspaceID:"delivery-workspace",Revision:1}
		if err:=db.Create(&project).Error;err!=nil{t.Fatal(err)}
		episode:=model.ProductionEpisode{ID:"delivery-episode",ProjectID:project.ID,Delivery:&model.ProductionDeliveryEdit{OriginalGain:1,AudioTracks:[]model.ProductionAudioTrack{{ID:"track",StorageKey:"server:"+file.ID,Label:"本集音轨",DurationSeconds:3,Gain:1}}}}
		if err:=db.Create(&episode).Error;err!=nil{t.Fatal(err)}
		if refs,err:=CurrentUserStorageFileReferences(owner,file.ID);err!=nil||refs.CanDelete||len(refs.Blockers)!=1{t.Fatalf("saved audio not protected: %+v %v",refs,err)}
		if _,err:=DeleteCurrentUserStorageFile(owner,file.ID,true,nil);err==nil{t.Fatal("saved audio physically deleted")}
		if err:=db.Model(&episode).Update("delivery",nil).Error;err!=nil{t.Fatal(err)}
		if result,err:=DeleteCurrentUserStorageFile(owner,file.ID,true,nil);err!=nil||result.FreedBytes!=file.Bytes{t.Fatalf("detached audio not released: %+v %v",result,err)}
	})
	t.Run("physical and final database failures retain charged retryable indexes", func(t *testing.T) {
		provider := model.StorageProvider{ID: "test-r2", Type: model.StorageProviderTypeS3, Endpoint: "https://r2.invalid", Bucket: "test", AccessKeyID: "test-only", SecretAccessKey: "test-only", Enabled: true}
		if _, err := repository.SaveSettings(model.Settings{Private: model.PrivateSetting{Storage: model.PrivateStorageSetting{Mode: "local", Providers: []model.StorageProvider{provider}}}}, "test"); err != nil {
			t.Fatal(err)
		}
		file := model.StorageObject{ID: "r2-failure", ProviderID: provider.ID, Bucket: provider.Bucket, ObjectKey: "test/r2.png", PublicURL: "https://cdn.invalid/r2.png", Bytes: 5, MimeType: "image/png", CreatedBy: "file-owner"}
		if _, err := repository.SaveStorageObject(file); err != nil {
			t.Fatal(err)
		}
		before, err := CurrentUserStorageUsage(owner)
		if err != nil {
			t.Fatal(err)
		}
		original := safeProxyHTTPClient
		t.Cleanup(func() { safeProxyHTTPClient = original })
		status := http.StatusServiceUnavailable
		safeProxyHTTPClient = &http.Client{Transport: storageQuotaTransport(func(r *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: status, Status: http.StatusText(status), Header: http.Header{}, Body: io.NopCloser(strings.NewReader("test response")), Request: r}, nil
		})}
		if _, err := DeleteCurrentUserStorageFile(owner, file.ID, true, nil); err == nil {
			t.Fatal("failed physical delete accepted")
		}
		after, err := CurrentUserStorageUsage(owner)
		if err != nil || after.UsedBytes != before.UsedBytes {
			t.Fatalf("failure released quota: %+v %+v %v", before, after, err)
		}
		refs, err := CurrentUserStorageFileReferences(owner, file.ID)
		if err != nil || !refs.File.DeletePending || !refs.CanDelete {
			t.Fatalf("retry state hidden: %+v %v", refs, err)
		}
		if _, err := SaveCurrentUserAssetItem(owner, asset("pending-asset", file)); err == nil {
			t.Fatal("pending delete accepted a new reference")
		}
		status = http.StatusNoContent
		if result, err := DeleteCurrentUserStorageFile(owner, file.ID, true, nil); err != nil || result.FreedBytes != 5 {
			t.Fatalf("R2 retry failed: %+v %v", result, err)
		}
		if _, err := SaveAsset(model.Asset{ID: "stale-cdn", Title: "old CDN", Type: model.AssetTypeImage, URL: file.PublicURL + "?expired=1"}); err == nil {
			t.Fatal("CDN tombstone reference accepted")
		}
		after, err = CurrentUserStorageUsage(owner)
		if err != nil || after.UsedBytes != before.UsedBytes-5 {
			t.Fatalf("completed tombstone still charged: %+v %v", after, err)
		}
		local := makeFile("commit-retry", "file-owner")
		if _, err := SaveCurrentUserAssetItem(owner, asset("commit-asset", local)); err != nil {
			t.Fatal(err)
		}
		if err := db.Callback().Update().Before("gorm:update").Register("test:fail_storage_complete", func(tx *gorm.DB) {
			if tx.Statement.Table == "storage_objects" {
				if updates, ok := tx.Statement.Dest.(map[string]any); ok && updates["delete_completed_at"] != nil {
					tx.AddError(errors.New("forced completion failure"))
				}
			}
		}); err != nil {
			t.Fatal(err)
		}
		if _, err := DeleteCurrentUserStorageFile(owner, local.ID, true, nil); err == nil {
			t.Fatal("forced metadata failure accepted")
		}
		if err := db.Callback().Update().Remove("test:fail_storage_complete"); err != nil {
			t.Fatal(err)
		}
		refs, err = CurrentUserStorageFileReferences(owner, local.ID)
		if err != nil || !refs.File.DeletePending || refs.AssetCount != 1 {
			t.Fatalf("failed commit lost recoverable metadata: %+v %v", refs, err)
		}
		if result, err := DeleteCurrentUserStorageFile(owner, local.ID, true, nil); err != nil || result.FreedBytes != 4 {
			t.Fatalf("finalize retry: %+v %v", result, err)
		}
	})
	t.Run("published writes preserve originals on missing references", func(t *testing.T) {
		file := makeFile("public-file", "file-owner")
		asset, err := SaveAsset(model.Asset{ID: "published", Title: "原素材", Type: model.AssetTypeImage, URL: "/api/files/" + file.ID + "/content"})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := DeleteCurrentUserStorageFile(owner, file.ID, true, nil); err == nil {
			t.Fatal("published file removed")
		}
		asset.URL = "/api/files/nonexistent/content"
		asset.CoverURL = ""
		if _, err := SaveAsset(asset); err == nil {
			t.Fatal("missing public media accepted")
		}
		saved, _, err := repository.GetAsset(asset.ID)
		if err != nil || saved.URL != "/api/files/"+file.ID+"/content" {
			t.Fatalf("failed publish overwrote original: %+v %v", saved, err)
		}
		prompt, err := SavePrompt(model.Prompt{ID: "published-prompt", Title: "提示词", Prompt: "保留", Preview: "![](/api/files/" + file.ID + "/content)"})
		if err != nil {
			t.Fatal(err)
		}
		prompt.Preview = "![](/api/files/nonexistent/content)"
		if _, err := SavePrompt(prompt); err == nil {
			t.Fatal("missing markdown image accepted")
		}
		if _, err := SaveSystemAgentSkill(model.AgentSkill{ID: "", Name: "有效技能", Content: "内容", Enabled: true, CoverStorageKey: "server:" + file.ID}); err != nil {
			t.Fatal(err)
		}
		privateSkill, err := SaveCurrentUserAgentSkill(other, model.AgentSkill{Name: "其他账号私密技能名称", Content: "内容", CoverStorageKey: "server:" + file.ID})
		if err != nil {
			t.Fatal(err)
		}
		refs, err := CurrentUserStorageFileReferences(owner, file.ID)
		if err != nil {
			t.Fatal(err)
		}
		hidden := false
		for _, blocker := range refs.Blockers {
			if blocker.Type == "otherAccount" {
				hidden = true
			}
			if blocker.ID == privateSkill.ID || strings.Contains(blocker.Title, privateSkill.Name) {
				t.Fatal("private skill identity leaked to file owner")
			}
		}
		if !hidden {
			t.Fatal("other account private skill not protected")
		}
		if _, err := SaveCurrentUserAgentSkill(other, model.AgentSkill{Name: "错误技能", Content: "内容", CoverStorageKey: "server:nonexistent"}); err == nil {
			t.Fatal("missing user skill cover accepted")
		}
	})
	t.Run("concurrent create versus delete cannot commit a dangling reference", func(t *testing.T) {
		for i := 0; i < 4; i++ {
			file := makeFile(fmt.Sprintf("race-%d", i), "file-owner")
			start := make(chan struct{})
			var savedErr, deletedErr error
			var group sync.WaitGroup
			group.Add(2)
			go func() {
				defer group.Done()
				<-start
				_, savedErr = SaveCurrentUserCanvasProject(owner, project(fmt.Sprintf("race-canvas-%d", i), file))
			}()
			go func() {
				defer group.Done()
				<-start
				_, deletedErr = DeleteCurrentUserStorageFile(owner, file.ID, true, nil)
			}()
			close(start)
			group.Wait()
			if savedErr == nil && deletedErr == nil {
				t.Fatal("both reference save and physical delete succeeded")
			}
			if savedErr != nil && deletedErr != nil {
				t.Fatalf("neither operation completed: %v / %v", savedErr, deletedErr)
			}
		}
	})
}

func TestStorageMediaReferenceParsing(t *testing.T) {
	values, err := storageMediaValues(`{"title":"server:not-a-reference","prompt":"/api/files/not-a-reference/content","metadata":{"storageKey":"server:exact","dataUrl":"/api/files/signed/content?access=secret#x"},"preview":"![](/api/files/markdown/content)","referenceAudios":["server:audio"],"first_frame_url":"/api/files/first/content"}`)
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]bool{}
	for _, value := range values {
		if id := storageIDFromMediaValue(value); id != "" {
			ids[id] = true
		}
	}
	if len(ids) != 5 || !ids["exact"] || !ids["signed"] || !ids["markdown"] || !ids["audio"] || !ids["first"] || ids["not-a-reference"] {
		t.Fatalf("incorrect semantic references: %+v", ids)
	}
	for _, value := range []string{"server:webdav:custom", "server:bad/path", "/api/files/id/content-extra", "/other/api/files/id/content"} {
		if storageIDFromMediaValue(value) != "" {
			t.Fatalf("false reference: %s", value)
		}
	}
}
