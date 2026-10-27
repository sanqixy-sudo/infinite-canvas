package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	gm "github.com/tigerowo/infinite-canvas/gateway/model"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

func TestProductionTaskIsolationAndBilling(t *testing.T) {
	const marker = "PRODUCTION_TASK_CHILD"
	if os.Getenv(marker) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestProductionTaskIsolationAndBilling$", "-test.timeout=40s")
		command.Env = append(os.Environ(), marker+"=1")
		if output, err := command.CombinedOutput(); err != nil { t.Fatalf("isolated production task database: %v\n%s", err, output) }
		return
	}
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: filepath.Join(t.TempDir(), "production-task.db")}
	db, err := repository.DB()
	if err != nil { t.Fatal(err) }
	connection, err := db.DB()
	if err != nil { t.Fatal(err) }
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })
	for _, id := range []string{"task-owner", "task-other"} {
		if err := db.Create(&model.User{ID: id, Username: id, AffCode: id, Role: model.UserRoleUser, Status: model.UserStatusActive, Credits: 100}).Error; err != nil { t.Fatal(err) }
	}
	owner := WithUser(context.Background(), model.AuthUser{ID: "task-owner", Role: model.UserRoleUser})
	other := WithUser(context.Background(), model.AuthUser{ID: "task-other", Role: model.UserRoleUser})
	makePlan := func(workspace string, duplicateShot bool) *model.ProductionDocument {
		t.Helper()
		raw, err := json.Marshal(map[string]any{"id": workspace, "createdAt": now(), "updatedAt": now(), "nodes": []map[string]string{{"id": "shared-image", "type": "image"}, {"id": "shared-video", "type": "video"}}})
		if err != nil { t.Fatal(err) }
		if _, err := SaveCurrentUserCanvasProject(owner, raw); err != nil { t.Fatal(err) }
		doc, err := CreateCurrentUserProduction(owner, workspace, "近期制作任务")
		if err != nil { t.Fatal(err) }
		doc.Episodes = []model.ProductionEpisode{{ID: "episode", Title: "第一集"}}
		doc.Shots = []model.ProductionShot{{ID: "shot", EpisodeID: "episode", Title: "镜头", Seconds: 5, Status: "draft", CanvasID: workspace, ImageNodeID: "shared-image", VideoNodeID: "shared-video"}}
		if duplicateShot { copy := doc.Shots[0]; copy.ID, copy.Order = "shot-copy", 1; doc.Shots = append(doc.Shots, copy) }
		doc, err = SaveCurrentUserProduction(owner, *doc)
		if err != nil { t.Fatal(err) }
		return doc
	}
	plan := makePlan("task-root-a", true)
	makePlan("task-root-b", false)
	const stamp = "2026-01-01T00:00:00Z"
	const privateMarker = "do-not-expose-private-task-data"
	input, output, invalid := int64(120), int64(280), int64(-1)
	newVideo := func(id, canvas string) model.VideoTask {
		return model.VideoTask{ID: id, UserID: "task-owner", Source: "canvas", CanvasID: canvas, SourceID: "shared-video", Model: "视频模型", Status: "completed", CreatedAt: stamp, VideoURL: "https://media.invalid/"+privateMarker, Error: privateMarker, ErrorDetail: privateMarker, RequestBody: privateMarker, ResponseBody: privateMarker, LastResponse: privateMarker}
	}
	newImage := func(id, canvas string) model.CanvasImageTask {
		return model.CanvasImageTask{ID: id, UserID: "task-owner", Source: "canvas", SourceID: canvas, NodeID: "shared-image", Model: "图片模型", Status: "completed", Credits: 9, CreatedAt: stamp, Prompt: privateMarker, ImageURL: "https://media.invalid/"+privateMarker, RequestBody: privateMarker, ResponseBody: privateMarker, Error: privateMarker}
	}
	insert := func(value any) {
		t.Helper()
		var err error
		switch task := value.(type) {
		case *model.VideoTask: _, err = repository.SaveVideoTask(*task)
		case *model.CanvasImageTask: _, err = repository.SaveCanvasImageTask(*task)
		default: err = db.Create(value).Error
		}
		if err != nil { t.Fatal(err) }
	}
	ordinary := newVideo("ordinary", plan.WorkspaceID)
	// Even stray billing fields do not turn a normal task into a settled gateway task.
	ordinary.Credits, ordinary.SettledCredits, ordinary.BillingStatus = 12, 12, "settled"
	insert(&ordinary)
	history := newVideo("history", plan.WorkspaceID)
	history.CreatedAt = "2025-12-31T23:59:59Z"
	insert(&history)
	settled := newVideo("gateway-settled", plan.WorkspaceID)
	settled.GatewaySnapshot, settled.BillingStatus = `{"apiKey":"`+privateMarker+`"}`, "settled"
	settled.ReservedCredits, settled.SettledCredits, settled.ActualTokens = 8, 3.5, 400
	settled.ActualInputTokens, settled.ActualOutputTokens = &input, &output
	insert(&settled)
	pending := settled
	pending.ID, pending.BillingStatus, pending.SettledCredits = "gateway-pending", "pending_balance", 99
	insert(&pending)
	badUsage := settled
	badUsage.ID, badUsage.ActualTokens, badUsage.ActualInputTokens = "gateway-negative", -1, &invalid
	badUsage.ReservedCredits, badUsage.SettledCredits = -1, -1
	insert(&badUsage)
	reserved := settled
	reserved.ID, reserved.BillingStatus = "gateway-reserved", "reserved"
	insert(&reserved)
	image := newImage("image", plan.WorkspaceID)
	insert(&image)
	for _, test := range []struct { id string; change func(*model.VideoTask) }{
		{"other-plan", func(v *model.VideoTask) { v.CanvasID = "task-root-b" }},
		{"other-account", func(v *model.VideoTask) { v.UserID = "task-other" }},
		{"unbound-node", func(v *model.VideoTask) { v.SourceID = "unbound" }},
		{"workbench", func(v *model.VideoTask) { v.Source = "video-workbench" }},
		{"legacy-no-canvas", func(v *model.VideoTask) { v.CanvasID = "" }},
	} {
		task := newVideo(test.id, plan.WorkspaceID); test.change(&task); insert(&task)
	}
	for _, test := range []struct { id string; change func(*model.CanvasImageTask) }{
		{"other-plan-image", func(v *model.CanvasImageTask) { v.SourceID = "task-root-b" }},
		{"other-account-image", func(v *model.CanvasImageTask) { v.UserID = "task-other" }},
		{"unbound-image", func(v *model.CanvasImageTask) { v.NodeID = "unbound" }},
		{"workbench-image", func(v *model.CanvasImageTask) { v.Source = "image-workbench" }},
	} {
		task := newImage(test.id, plan.WorkspaceID); test.change(&task); insert(&task)
	}
	state := func() string {
		t.Helper()
		var users []model.User; var videos []model.VideoTask; var images []model.CanvasImageTask; var logs []model.CreditLog
		if err := db.Order("id").Find(&users).Error; err != nil { t.Fatal(err) }
		if err := db.Order("id").Find(&videos).Error; err != nil { t.Fatal(err) }
		if err := db.Order("id").Find(&images).Error; err != nil { t.Fatal(err) }
		if err := db.Order("id").Find(&logs).Error; err != nil { t.Fatal(err) }
		raw, err := json.Marshal([]any{users, videos, images, logs}); if err != nil { t.Fatal(err) }; return string(raw)
	}
	before := state()
	t.Run("scope is account plus canvas plus node, and all attempts remain visible", func(t *testing.T) {
		result, err := CurrentUserProductionTasks(owner, plan.WorkspaceID)
		if err != nil { t.Fatal(err) }
		want := map[string]bool{"ordinary": true, "history": true, "gateway-settled": true, "gateway-pending": true, "gateway-negative": true, "gateway-reserved": true, "image": true}
		if len(result.Items) != len(want) || result.HasMore { t.Fatalf("unexpected scoped count: %+v", result) }
		for _, item := range result.Items {
			if !want[item.ID] || item.CanvasID != plan.WorkspaceID || len(item.ShotIDs) != 2 || item.ShotIDs[0] != "shot" || item.ShotIDs[1] != "shot-copy" { t.Fatalf("invalid task association: %+v", item) }
			delete(want, item.ID)
		}
		if len(want) != 0 { t.Fatalf("lost historical attempts: %v", want) }
		second, err := CurrentUserProductionTasks(owner, "task-root-b")
		if err != nil || len(second.Items) != 2 { t.Fatalf("same node IDs across projects mixed tasks: %+v / %v", second, err) }
		for _, item := range second.Items { if item.ID != "other-plan" && item.ID != "other-plan-image" { t.Fatalf("wrong project task: %+v", item) } }
		foreign, err := CurrentUserProductionTasks(other, plan.WorkspaceID)
		if err != nil || len(foreign.Items) != 0 { t.Fatalf("foreign plan visible: %+v / %v", foreign, err) }
		missing, err := CurrentUserProductionTasks(owner, "no-plan")
		if err != nil || len(missing.Items) != 0 || missing.Items == nil { t.Fatalf("empty list contract: %+v / %v", missing, err) }
		if _, err := CurrentUserProductionTasks(context.Background(), plan.WorkspaceID); err == nil { t.Fatal("anonymous access accepted") }
	})
	t.Run("unknown money remains null and pending usage is not settlement", func(t *testing.T) {
		result, err := CurrentUserProductionTasks(owner, plan.WorkspaceID)
		if err != nil { t.Fatal(err) }
		items := map[string]model.ProductionTask{}
		for _, item := range result.Items { items[item.ID] = item }
		for _, id := range []string{"ordinary", "history", "image"} {
			item := items[id]
			if item.BillingStatus != "unknown" || item.ReservedCredits != nil || item.SettledCredits != nil || item.ActualTokens != nil || item.ActualInputTokens != nil || item.ActualOutputTokens != nil { t.Fatalf("unknown fees were fabricated: %+v", item) }
		}
		paid := items["gateway-settled"]
		if paid.ReservedCredits == nil || *paid.ReservedCredits != 8 || paid.SettledCredits == nil || *paid.SettledCredits != 3.5 || paid.ActualTokens == nil || *paid.ActualTokens != 400 || paid.ActualInputTokens == nil || *paid.ActualInputTokens != 120 || paid.ActualOutputTokens == nil || *paid.ActualOutputTokens != 280 { t.Fatalf("settled details lost: %+v", paid) }
		waiting := items["gateway-pending"]
		if waiting.BillingStatus != "pending_balance" || waiting.SettledCredits != nil || waiting.ActualTokens == nil || *waiting.ActualTokens != 400 { t.Fatalf("pending balance shown as paid: %+v", waiting) }
		reservation := items["gateway-reserved"]
		if reservation.SettledCredits != nil || reservation.ActualTokens != nil || reservation.ActualInputTokens != nil || reservation.ActualOutputTokens != nil { t.Fatalf("reservation shown as actual usage: %+v", reservation) }
		invalid := items["gateway-negative"]
		if invalid.ReservedCredits != nil || invalid.SettledCredits != nil || invalid.ActualTokens != nil || invalid.ActualInputTokens != nil { t.Fatalf("negative fee/usage exposed: %+v", invalid) }
		raw, err := json.Marshal(result); if err != nil { t.Fatal(err) }
		if strings.Contains(string(raw), privateMarker) || !strings.Contains(string(raw), `"settledCredits":null`) { t.Fatalf("unsafe or missing-null response: %s", raw) }
		images, videos, err := repository.ListProductionShotTasks("task-owner", plan.ID, 201)
		if err != nil { t.Fatal(err) }
		for _, task := range images { if task.RequestBody != "" || task.ImageURL != "" || task.Error != "" || task.Prompt != "" { t.Fatal("image query loaded private fields") } }
		for _, task := range videos { if task.GatewaySnapshot != "" && task.GatewaySnapshot != "gateway" { t.Fatal("query loaded gateway credentials instead of presence flag") }; if task.RequestBody != "" || task.VideoURL != "" || task.Error != "" { t.Fatal("video query loaded private fields") } }
	})
	if after := state(); after != before { t.Fatal("task listing changed task, balance, or credit ledger state") }
	t.Run("history paginates after server filters while summaries count the whole scope", func(t *testing.T) {
		capPlan := makePlan("task-root-cap", false)
		for i := 0; i < 200; i++ {
			id := fmt.Sprintf("cap-%03d", i)
			if i%2 == 0 { task := newVideo(id, capPlan.WorkspaceID); insert(&task) } else { task := newImage(id, capPlan.WorkspaceID); insert(&task) }
		}
		exact, err := CurrentUserProductionTasks(owner, capPlan.WorkspaceID, ProductionTaskQuery{Page: 1, PageSize: 100})
		if err != nil || len(exact.Items) != 100 || !exact.HasMore || exact.Total != 200 || exact.Summary.TaskCount != 200 { t.Fatalf("first page: %+v / %v", exact, err) }
		extra := newVideo("cap-200", capPlan.WorkspaceID); insert(&extra)
		result, err := CurrentUserProductionTasks(owner, capPlan.WorkspaceID, ProductionTaskQuery{Page: 3, PageSize: 100})
		if err != nil || len(result.Items) != 1 || result.HasMore || result.Summary.TaskCount != 201 { t.Fatalf("last page: %+v / %v", result, err) }
		filtered, err := CurrentUserProductionTasks(owner, capPlan.WorkspaceID, ProductionTaskQuery{Page: 1, PageSize: 100, Status: "failed"})
		if err != nil || len(filtered.Items) != 0 || filtered.Summary.TaskCount != 201 { t.Fatalf("filter changed all-history cost scope: %+v / %v", filtered, err) }
		for i := 1; i < len(result.Items); i++ {
			a, b := result.Items[i-1], result.Items[i]
			if a.CreatedAt < b.CreatedAt || a.CreatedAt == b.CreatedAt && a.RecordID < b.RecordID { t.Fatalf("task order changed at %d", i) }
		}
	})
	t.Run("bindings and actual costs survive node rebinding and original task cleanup", func(t *testing.T) {
		isolated := makePlan("durable-cost", true)
		task := newImage("durable-image", isolated.WorkspaceID); task.Status = "processing"; insert(&task)
		if err := ConsumeUserCredits("task-owner", "image", 2.75, "/images", TaskCreditReference{ID: task.ID, Kind: "image"}); err != nil { t.Fatal(err) }
		if err := RefundUserCredits("task-owner", "image", 0.75, "/images", "image:" + task.ID); err != nil { t.Fatal(err) }
		task.Status, task.CompletedAt = "completed", stamp
		if _, err := SaveCanvasImageTask(task); err != nil { t.Fatal(err) }
		if err := db.Model(&model.ProductionShot{}).Where("project_id = ?", isolated.ID).Updates(map[string]any{"image_node_id": "new-node", "title": "renamed"}).Error; err != nil { t.Fatal(err) }
		if err := repository.DeleteUserCanvasImageTask("task-owner", task.ID); err != nil { t.Fatal(err) }
		if _, err := repository.SaveCanvasImageTask(task); !errors.Is(err, repository.ErrProductionTaskReplay) { t.Fatalf("cleaned-up task ID replayed: %v", err) }
		result, err := CurrentUserProductionTasks(owner, isolated.WorkspaceID)
		if err != nil || len(result.Items) != 1 || result.Summary.SettledCredits != 2 || result.Summary.ChargedCredits != 2.75 || result.Summary.RefundedCredits != 0.75 || result.Summary.TaskCount != 1 || len(result.ShotCosts) != 2 { t.Fatalf("durable cost facts: %+v / %v", result, err) }
		if result.Items[0].ShotTitles[0] != "镜头" || result.Items[0].ChargedCredits == nil || *result.Items[0].ChargedCredits != 2.75 { t.Fatal("original identity or ledger missing") }
		for _, cost := range result.ShotCosts { if cost.SettledCredits != 2 { t.Fatal("shared task attribution lost") } }
		foreign, err := CurrentUserProductionTasks(other, isolated.WorkspaceID)
		if err != nil || foreign.Summary.TaskCount != 0 { t.Fatal("cross-account cost disclosure") }
		insert(&model.ProductionProject{ID: "foreign-production", UserID: "task-other", WorkspaceID: "foreign-workspace", Revision: 1})
		insert(&model.ProductionShot{ProjectID: "foreign-production", ID: "foreign-shot", EpisodeID: "foreign-episode", CanvasID: "foreign-workspace", ImageNodeID: "shared-image", Title: "其他账号"})
		foreignTask := task; foreignTask.UserID, foreignTask.SourceID = "task-other", "foreign-workspace"
		if _, err := repository.SaveCanvasImageTask(foreignTask); err != nil { t.Fatal(err) }
		foreign, err = CurrentUserProductionTasks(other, "foreign-workspace")
		if err != nil || len(foreign.Items) != 1 || foreign.Items[0].RecordID == result.Items[0].RecordID || foreign.Items[0].NetCredits != nil { t.Fatalf("account task IDs collided: %+v / %v", foreign, err) }
		stillOwned, err := CurrentUserProductionTasks(owner, isolated.WorkspaceID)
		if err != nil || stillOwned.Summary.SettledCredits != 2 || stillOwned.Items[0].RecordID != result.Items[0].RecordID { t.Fatal("another account overwrote durable history") }
	})
	t.Run("confirmed zero charge is settled while missing billing stays unknown", func(t *testing.T) {
		isolated := makePlan("zero-cost-history", false)
		free := newImage("confirmed-free", isolated.WorkspaceID); insert(&free)
		unknown := newImage("unpriced", isolated.WorkspaceID); insert(&unknown)
		if err := ConsumeUserCredits("task-owner", "free-model", 0, "/images", TaskCreditReference{ID: free.ID, Kind: "image"}); err != nil { t.Fatal(err) }
		result, err := CurrentUserProductionTasks(owner, isolated.WorkspaceID)
		if err != nil || result.Summary.SettledTaskCount != 1 || result.Summary.UnknownTaskCount != 1 || result.Summary.SettledCredits != 0 { t.Fatalf("zero and unknown mixed: %+v / %v", result, err) }
		for _, item := range result.Items {
			if item.ID == free.ID && (item.SettledCredits == nil || *item.SettledCredits != 0 || item.ChargedCredits == nil || item.BillingStatus != "settled") { t.Fatalf("confirmed zero charge lost: %+v", item) }
			if item.ID == unknown.ID && (item.SettledCredits != nil || item.ChargedCredits != nil || item.BillingStatus != "unknown") { t.Fatalf("missing charge became free: %+v", item) }
		}
		var log model.CreditLog
		if err := db.Where("user_id = ? AND related_id = ?", "task-owner", "image:"+free.ID).First(&log).Error; err != nil { t.Fatal(err) }
		if err := repository.DeleteCreditLog(log.ID); !errors.Is(err, repository.ErrProductionLedgerReadOnly) { t.Fatalf("linked ledger deleted: %v", err) }
		log.RelatedID, log.Amount = "", -99
		if _, err := repository.SaveCreditLog(log); !errors.Is(err, repository.ErrProductionLedgerReadOnly) { t.Fatalf("linked ledger rewritten: %v", err) }
		log.ID, log.RelatedID = "forged-production-entry", "image:"+free.ID
		if _, err := repository.SaveCreditLog(log); !errors.Is(err, repository.ErrProductionLedgerReadOnly) { t.Fatalf("linked ledger appended outside billing: %v", err) }
		log.ID, log.RelatedID = "unlinked-entry", ""
		if _, err := repository.SaveCreditLog(log); err != nil { t.Fatal(err) }
		if err := repository.DeleteCreditLog(log.ID); err != nil { t.Fatal(err) }
	})
	t.Run("same task ID in another media kind cannot contribute charges or refunds", func(t *testing.T) {
		isolated := makePlan("typed-cost-history", false)
		image := newImage("same-media-id", isolated.WorkspaceID); insert(&image)
		if err := ConsumeUserCredits("task-owner", "video-model", 7, "/videos", TaskCreditReference{ID: image.ID, Kind: "video"}); err != nil { t.Fatal(err) }
		if err := ConsumeUserCredits("task-owner", "image-model", 2, "/images", TaskCreditReference{ID: image.ID, Kind: "image"}); err != nil { t.Fatal(err) }
		if err := RefundUserCredits("task-owner", "video-model", 3, "/videos", "video:"+image.ID); err != nil { t.Fatal(err) }
		result, err := CurrentUserProductionTasks(owner, isolated.WorkspaceID)
		if err != nil || len(result.Items) != 1 || result.Summary.SettledCredits != 2 || result.Summary.ChargedCredits != 2 || result.Summary.RefundedCredits != 0 { t.Fatalf("cross-kind cost leaked: %+v / %v", result, err) }
	})
	t.Run("retry chains never branch and accepted request IDs recover without a fresh quote", func(t *testing.T) {
		isolated := makePlan("retry-history", false)
		original := newVideo("retry-original", isolated.WorkspaceID)
		original.Status, original.BillingStatus, original.GatewaySnapshot = "failed", "released", `{"request":{"model":"old"}}`
		insert(&original)
		list, err := CurrentUserProductionTasks(owner, isolated.WorkspaceID)
		if err != nil || len(list.Items) != 1 || !list.Items[0].CanRetry { t.Fatalf("safe failure not retryable: %+v / %v", list, err) }
		recordID := list.Items[0].RecordID
		child := original; child.ID = "gateway_" + gatewayHash([]string{"task-owner", "stable-retry-id"}); child.RetryOf, child.Attempt = recordID, 2
		insert(&child)
		list, err = CurrentUserProductionTasks(owner, isolated.WorkspaceID)
		if err != nil { t.Fatal(err) }
		for _, item := range list.Items { if item.ID == original.ID && item.CanRetry { t.Fatal("failed child allowed retrying the parent again") } }
		accepted, err := RetryCurrentUserProductionTask(owner, ProductionRetryInput{WorkspaceID: isolated.WorkspaceID, RecordID: recordID, RequestID: "stable-retry-id", QuoteID: "expired"})
		if err != nil || accepted["accepted"] != true { t.Fatalf("accepted retry did not recover: %+v / %v", accepted, err) }
		if _, err := RetryCurrentUserProductionTask(owner, ProductionRetryInput{WorkspaceID: isolated.WorkspaceID, RecordID: recordID, RequestID: "different-retry-id"}); err == nil { t.Fatal("parent retry branched") }
		if _, err := RetryCurrentUserProductionTask(other, ProductionRetryInput{WorkspaceID: isolated.WorkspaceID, RecordID: recordID, RequestID: "stable-retry-id"}); err == nil { t.Fatal("foreign user read accepted retry") }
		unknown := original; unknown.ID, unknown.Status = "uncertain-original", "unknown"; insert(&unknown)
		list, err = CurrentUserProductionTasks(owner, isolated.WorkspaceID)
		if err != nil { t.Fatal(err) }
		for _, item := range list.Items { if item.ID == unknown.ID { if item.CanRetry { t.Fatal("uncertain task retryable") }; if _, err := RetryCurrentUserProductionTask(owner, ProductionRetryInput{WorkspaceID: isolated.WorkspaceID, RecordID: item.RecordID, RequestID: "unknown-retry"}); err == nil { t.Fatal("uncertain request replayed") } } }
		before, _, _ := repository.GetUserByID("task-owner")
		branch := child; branch.ID = "another-retry"
		if _, _, err := repository.ReserveGatewayTask(branch, model.CreditLog{}); !errors.Is(err, repository.ErrGatewayConflict) { t.Fatalf("atomic retry branch check failed: %v", err) }
		after, _, _ := repository.GetUserByID("task-owner")
		if before.Credits != after.Credits { t.Fatal("rejected retry changed balance") }
	})
	t.Run("gateway retry identity includes canvas and node without forwarding origin", func(t *testing.T) {
		request := GatewaySubmit{Request: gm.Request{RequestID: "origin-retry", Model: "video-model"}, Source: "canvas", SourceID: "shared-video", CanvasID: plan.WorkspaceID}
		task := newVideo("gateway_"+gatewayHash([]string{"task-owner", request.RequestID}), plan.WorkspaceID)
		task.GatewayRequestHash = gatewaySubmitHash(request)
		insert(&task)
		result, err := SubmitGatewayTask(owner, request)
		if err != nil || result["canvasId"] != plan.WorkspaceID { t.Fatalf("same-origin retry: %+v / %v", result, err) }
		for _, change := range []func(*GatewaySubmit){func(r *GatewaySubmit) { r.CanvasID = "task-root-b" }, func(r *GatewaySubmit) { r.SourceID = "different-node" }, func(r *GatewaySubmit) { r.Source = "video-workbench" }} {
			copy := request; change(&copy)
			if _, err := SubmitGatewayTask(owner, copy); err == nil || !strings.Contains(err.Error(), "同一任务标识") { t.Fatalf("origin-changing retry accepted: %v", err) }
			conflict := task; conflict.CanvasID, conflict.GatewayRequestHash = copy.CanvasID, gatewaySubmitHash(copy)
			if _, _, err := repository.ReserveGatewayTask(conflict, model.CreditLog{}); !errors.Is(err, repository.ErrGatewayConflict) { t.Fatalf("reservation race accepted different origin: %v", err) }
		}
		raw, err := json.Marshal(request.Request); if err != nil { t.Fatal(err) }
		if strings.Contains(string(raw), "canvasId") || strings.Contains(string(raw), "sourceId") { t.Fatal("canvas origin leaked into middleware/provider request") }
	})
	t.Run("normal video writes cannot move an existing task to another origin", func(t *testing.T) {
		original := newVideo("ordinary-origin", plan.WorkspaceID)
		insert(&original)
		for _, change := range []func(*model.VideoTask){func(v *model.VideoTask) { v.CanvasID = "task-root-b" }, func(v *model.VideoTask) { v.SourceID = "different-node" }, func(v *model.VideoTask) { v.Source = "video-workbench" }} {
			copy := original; change(&copy)
			if err := CheckVideoTaskOrigin(copy.UserID, copy.ID, copy.Source, copy.SourceID, copy.CanvasID); err == nil { t.Fatal("different task origin passed preflight") }
			if _, err := repository.SaveVideoTask(copy); !errors.Is(err, repository.ErrVideoTaskOriginConflict) { t.Fatalf("task origin overwritten during atomic save: %v", err) }
		}
		current, found, err := repository.GetUserVideoTask(original.UserID, original.ID)
		if err != nil || !found || current.CanvasID != original.CanvasID || current.SourceID != original.SourceID || current.Source != original.Source { t.Fatalf("origin changed: %+v / %v", current, err) }
		if err := CheckVideoTaskOrigin(original.UserID, original.ID, original.Source, original.SourceID, original.CanvasID); err != nil { t.Fatalf("same-origin retry blocked: %v", err) }
		legacy := newVideo("legacy-origin", ""); insert(&legacy)
		legacy.CanvasID = plan.WorkspaceID
		if _, err := repository.SaveVideoTask(legacy); !errors.Is(err, repository.ErrVideoTaskOriginConflict) { t.Fatalf("unmarked old task guessed a canvas: %v", err) }
		// A stop-before-create tombstone must remain stopped, even before origin is known.
		stopped := model.VideoTask{ID: "stopped-origin", UserID: "task-owner", Source: "canvas", Status: "cancelled"}; insert(&stopped)
		incoming := newVideo(stopped.ID, plan.WorkspaceID)
		kept, err := repository.SaveVideoTask(incoming)
		if err != nil || kept.Status != "cancelled" || kept.CanvasID != "" { t.Fatalf("cancel tombstone was replaced: %+v / %v", kept, err) }
	})
	t.Run("workflow videos persist canvas and node separately and reject origin-changing retries", func(t *testing.T) {
		input := WorkflowRunInput{ExpectedCapability: "video", Source: "canvas", SourceID: plan.WorkspaceID, NodeID: "shared-video", Ref: WorkflowRef{Scope: "system", ChannelID: "workflow-channel"}}
		resolved := ResolvedWorkflow{Entry: model.WorkflowEntry{Capability: "video", Title: "视频工作流"}, Channel: model.ModelChannel{Name: "测试渠道"}}
		const taskID = "wf-video-origin"
		if err := createWorkflowTaskRecord(model.AuthUser{ID: "task-owner"}, taskID, resolved, input, `{"scope":"system"}`, "test-workflow", 0); err != nil { t.Fatal(err) }
		snapshot, found, err := workflowTaskSnapshot("task-owner", taskID)
		if err != nil || !found || snapshot.canvasID != plan.WorkspaceID || snapshot.sourceID != "shared-video" || !snapshot.matchesVideoOrigin(input) { t.Fatalf("workflow task origin mapping: %+v / %v", snapshot, err) }
		for _, change := range []func(*WorkflowRunInput){func(i *WorkflowRunInput) { i.SourceID = "task-root-b" }, func(i *WorkflowRunInput) { i.NodeID = "different-node" }, func(i *WorkflowRunInput) { i.Source = "video-workbench" }} {
			copy := input; change(&copy)
			if snapshot.matchesVideoOrigin(copy) { t.Fatal("workflow retry accepted different canvas/node/source") }
		}
		snapshot.canvasID = ""
		if snapshot.matchesVideoOrigin(input) { t.Fatal("workflow retry guessed an old unmarked canvas") }
	})
	t.Run("shot voiceover keeps isolated durable task costs after audio row cleanup",func(t *testing.T){
		doc:=makePlan("voice-history",false)
		if err:=db.Model(&model.User{}).Where("id = ?","task-owner").Update("credits",100).Error;err!=nil{t.Fatal(err)}
		audio:=model.CanvasAudioTask{ID:"production_voice_history",UserID:"task-owner",Source:"canvas",SourceID:doc.WorkspaceID,NodeID:"shot",Model:"voice",RequestHash:"same",Status:"queued",CreatedAt:now(),UpdatedAt:now()}
		if _,err:=repository.SaveCanvasAudioTask(audio);err!=nil{t.Fatal(err)}
		list,err:=CurrentUserProductionTasks(owner,doc.WorkspaceID);if err!=nil||len(list.Items)!=1||list.Items[0].Kind!="audio"||list.Items[0].NetCredits!=nil{t.Fatal("audio origin or unknown cost lost",list,err)}
		if _,_,err:=repository.ConsumeUserCredits("task-owner",2,now(),model.CreditLog{ID:"audio-debit",UserID:"task-owner",RelatedID:"audio:"+audio.ID,Type:model.CreditLogTypeAIConsume,Amount:-2,CreatedAt:now()},nil);err!=nil{t.Fatal(err)}
		audio.Status,audio.CompletedAt="completed",now();if _,err:=repository.UpdateCanvasAudioTask(audio);err!=nil{t.Fatal(err)}
		list,err=CurrentUserProductionTasks(owner,doc.WorkspaceID);if err!=nil||list.Summary.SettledCredits!=2||list.Items[0].CanRetry{t.Fatal("audio settlement or retry policy",list,err)}
		if err:=repository.DeleteFinishedCanvasAudioTasksBefore("2999-01-01T00:00:00Z");err!=nil{t.Fatal(err)}
		list,err=CurrentUserProductionTasks(owner,doc.WorkspaceID);if err!=nil||list.Summary.SettledCredits!=2{t.Fatal("cleanup deleted audio cost",list,err)}
		if _,err:=repository.SaveCanvasAudioTask(audio);!errors.Is(err,repository.ErrProductionTaskReplay){t.Fatal("cleaned task ID re-executed",err)}
		foreign:=audio;foreign.ID="production_voice_foreign";foreign.UserID="task-other"
		if _,err:=repository.SaveCanvasAudioTask(foreign);err==nil{t.Fatal("another account attached audio to this shot")}
		otherList,err:=CurrentUserProductionTasks(other,doc.WorkspaceID);if err!=nil||len(otherList.Items)!=0{t.Fatal("audio leaked to other account",otherList,err)}
	})

}
