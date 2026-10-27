package service

import (
	"context"
	"encoding/json"
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

func TestTaskCenterIsolationAndFacts(t *testing.T) {
	const marker = "TASK_CENTER_CHILD"
	if os.Getenv(marker) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestTaskCenterIsolationAndFacts$", "-test.timeout=35s")
		command.Env = append(os.Environ(), marker+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("isolated task center: %v\n%s", err, output)
		}
		return
	}
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: filepath.Join(t.TempDir(), "tasks.db")}
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
	owner := WithUser(context.Background(), model.AuthUser{ID: "task-center-owner", Role: model.UserRoleUser})
	insert := func(value any) {
		t.Helper()
		if err := db.Create(value).Error; err != nil {
			t.Fatal(err)
		}
	}
	const stamp = "2026-01-01T00:00:00Z"
	const secret = "private-credential-never-expose"
	for _, id := range []string{"task-center-owner", "task-center-other"} {
		insert(&model.User{ID: id, Username: id, AffCode: id, Role: model.UserRoleUser, Status: model.UserStatusActive})
	}
	insert(&model.CanvasProject{UserID: "task-center-owner", ID: "own-canvas", ProjectData: `{}`, DeletedAt: ""})
	insert(&model.CanvasProject{UserID: "task-center-other", ID: "private-canvas", ProjectData: `{}`, DeletedAt: ""})
	insert(&model.ProductionProject{ID: "plan", UserID: "task-center-owner", WorkspaceID: "own-canvas", Title: "制作计划"})
	insert(&model.CanvasImageTask{ID: "same-id", UserID: "task-center-owner", Source: "canvas", SourceID: "own-canvas", NodeID: "image-node", Model: "图片模型", Status: "completed", Credits: 99, CreatedAt: stamp, RequestBody: secret, ResponseBody: secret, ImageURL: "https://invalid/" + secret})
	insert(&model.VideoTask{ID: "same-id", UserID: "task-center-owner", Source: "canvas", CanvasID: "private-canvas", SourceID: "video-node", Model: "视频模型", Status: "failed", CreatedAt: stamp, Error: "timeout " + secret, ErrorDetail: secret})
	insert(&model.CanvasAudioTask{ID: "wf-audio-test", UserID: "task-center-owner", Source: "canvas", SourceID: "own-canvas", NodeID: "audio-node", WorkflowRef: `{"key":"` + secret + `"}`, Model: "配音模型", Status: "running", Progress: 140, CreatedAt: stamp})
	insert(&model.VideoTask{ID: "gateway", UserID: "task-center-owner", Source: "canvas", CanvasID: "own-canvas", SourceID: "video-node", Model: "网关模型", Status: "completed", BillingStatus: "pending_usage", ReservedCredits: 10, GatewaySnapshot: secret, CreatedAt: stamp})
	insert(&model.ProductionRenderJob{ID: "render", UserID: "task-center-owner", RequestID: "render-request", WorkspaceID: "own-canvas", EpisodeID: "ep", EpisodeTitle: "第一集成片", Status: "queued", SnapshotJSON: secret, CreatedAt: stamp})
	insert(&model.ProductionTaskRecord{RecordID: "history-live", ID: "same-id", UserID: "task-center-owner", Kind: "image", Model: "旧图片名", Status: "completed", CanvasID: "own-canvas", CreatedAt: stamp})
	insert(&model.ProductionTaskLink{RecordID: "history-live", ProjectID: "plan", UserID: "task-center-owner", WorkspaceID: "own-canvas", EpisodeID: "ep", ShotID: "shot", ShotTitle: "开场镜头"})
	insert(&model.ProductionTaskRecord{RecordID: "history-only", ID: "cleaned", UserID: "task-center-owner", Kind: "video", Model: "历史视频", Status: "completed", CanvasID: "deleted-canvas", CreatedAt: stamp})
	insert(&model.CanvasImageTask{ID: "private-task", UserID: "task-center-other", Source: "canvas", Model: secret, CreatedAt: stamp})
	insert(&model.CreditLog{ID: "image-charge", UserID: "task-center-owner", RelatedID: "image:same-id", Type: model.CreditLogTypeAIConsume, Amount: -5})
	insert(&model.CreditLog{ID: "image-refund", UserID: "task-center-owner", RelatedID: "image:same-id", Type: model.CreditLogTypeAIRefund, Amount: 2})
	insert(&model.CreditLog{ID: "gateway-charge", UserID: "task-center-owner", RelatedID: "gateway", Type: model.CreditLogTypeAIConsume, Amount: -10})
	insert(&model.CreditLog{ID: "other-charge", UserID: "task-center-other", RelatedID: "video:same-id", Type: model.CreditLogTypeAIConsume, Amount: -88})
	all, err := CurrentUserTaskCenter(owner, model.Query{PageSize: 50}, "all")
	if err != nil {
		t.Fatal(err)
	}
	if all.Total != 6 || len(all.Items) != 6 {
		t.Fatalf("expected six deduplicated own tasks, got %+v", all)
	}
	rows := map[string]model.TaskCenterItem{}
	for _, item := range all.Items {
		rows[item.Kind+":"+item.ID] = item
	}
	image := rows["image:same-id"]
	if image.SettledCredits == nil || *image.SettledCredits != 3 || image.Title != "开场镜头" || image.WorkspaceID != "own-canvas" || image.Archived {
		t.Fatalf("image facts: %+v", image)
	}
	video := rows["video:same-id"]
	if video.SettledCredits != nil || video.CanvasID != "" || video.Error != "请求超时，请核对原任务状态后再操作" {
		t.Fatalf("must not reuse image/other-user ledger or private canvas: %+v", video)
	}
	audio := rows["audio:wf-audio-test"]
	if !audio.Workflow || !audio.CanStop || audio.Progress != 100 {
		t.Fatalf("workflow mapping: %+v", audio)
	}
	gateway := rows["video:gateway"]
	if !gateway.Gateway || gateway.CanStop || gateway.SettledCredits != nil || gateway.NetCredits == nil || *gateway.NetCredits != 10 {
		t.Fatalf("reservation is not settled cost: %+v", gateway)
	}
	if !rows["video:cleaned"].Archived || rows["video:cleaned"].CanvasID != "" || rows["video:cleaned"].CanStop {
		t.Fatal("cleaned history mapping")
	}
	if !rows["render:render"].CanStop || rows["render:render"].BillingStatus != "no_charge" {
		t.Fatal("render mapping")
	}
	encoded, _ := json.Marshal(all)
	if strings.Contains(string(encoded), secret) {
		t.Fatal("private upstream values leaked")
	}
	filtered, err := CurrentUserTaskCenter(owner, model.Query{Type: "video", PageSize: 1}, "attention")
	if err != nil || filtered.Total != 2 || len(filtered.Items) != 1 {
		t.Fatalf("filter and SQL pagination: %+v %v", filtered, err)
	}
	next, err := CurrentUserTaskCenter(owner, model.Query{Type: "video", PageSize: 1, Page: 2}, "attention")
	if err != nil || next.Items[0].ID == filtered.Items[0].ID {
		t.Fatalf("stable pagination: %+v %v", next, err)
	}
	searched, err := CurrentUserTaskCenter(owner, model.Query{Keyword: "第一集"}, "all")
	if err != nil || searched.Total != 1 || searched.Items[0].Kind != "render" {
		t.Fatalf("title search: %+v %v", searched, err)
	}
	if _, err := CurrentUserTaskCenter(context.Background(), model.Query{}, "all"); err == nil {
		t.Fatal("anonymous task listing allowed")
	}
	if _, err := CurrentUserTaskCenter(owner, model.Query{Type: "secrets"}, "all"); err == nil {
		t.Fatal("invalid type allowed")
	}
	if _, err := CurrentUserTaskCenter(owner, model.Query{}, "bad-status"); err == nil {
		t.Fatal("invalid status allowed")
	}
	if _, err := CurrentUserTaskCenter(owner, model.Query{Keyword: strings.Repeat("长", 101)}, "all"); err == nil {
		t.Fatal("unbounded search allowed")
	}
	// The stored workflow ID is passed as-is; it must not be hashed a second time.
	stopped, err := StopCanvasTask("task-center-owner", "audio", "wf-audio-test", false, "canvas")
	if err != nil || !stopped {
		t.Fatalf("stored workflow stop: %v %v", stopped, err)
	}
	var stored model.CanvasAudioTask
	if err := db.First(&stored, "id = ?", "wf-audio-test").Error; err != nil || stored.Status != "cancelled" {
		t.Fatalf("workflow stop state: %+v %v", stored, err)
	}
	var outsider model.CanvasImageTask
	if err := db.First(&outsider, "id = ?", "private-task").Error; err != nil || outsider.Status != "" {
		t.Fatal("other user's task changed")
	}
}
