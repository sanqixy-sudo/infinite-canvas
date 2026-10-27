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
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"gorm.io/gorm"
)

// Follow the isolated service database fixture used by the asset/storage tests.
func TestProductionDocumentAtomicityAndOwnership(t *testing.T) {
	const marker = "PRODUCTION_DOCUMENT_CHILD"
	if os.Getenv(marker) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestProductionDocumentAtomicityAndOwnership$", "-test.timeout=40s")
		command.Env = append(os.Environ(), marker+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("isolated production database: %v\n%s", err, output)
		}
		return
	}
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: filepath.Join(t.TempDir(), "production.db")}
	db, err := repository.DB()
	if err != nil { t.Fatal(err) }
	connection, err := db.DB()
	if err != nil { t.Fatal(err) }
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })
	if err := db.AutoMigrate(&model.ProductionProject{}, &model.ProductionEpisode{}, &model.ProductionScene{}, &model.ProductionAsset{}, &model.ProductionShot{}); err != nil { t.Fatal(err) }
	for _, id := range []string{"production-owner", "production-other"} {
		if err := db.Create(&model.User{ID: id, Username: id, AffCode: id, Role: model.UserRoleUser}).Error; err != nil { t.Fatal(err) }
	}
	owner := WithUser(context.Background(), model.AuthUser{ID: "production-owner", Role: model.UserRoleUser})
	other := WithUser(context.Background(), model.AuthUser{ID: "production-other", Role: model.UserRoleUser})
	makeCanvas := func(ctx context.Context, id, workspaceID string) {
		t.Helper()
		raw, err := json.Marshal(map[string]any{
			"id": id, "workspaceId": workspaceID, "createdAt": now(), "updatedAt": now(),
			"nodes": []map[string]string{{"id": "text", "type": "text"}, {"id": "image", "type": "image"}, {"id": "video", "type": "video"}, {"id": "panorama", "type": "panorama"}},
		})
		if err != nil { t.Fatal(err) }
		if _, err := SaveCurrentUserCanvasProject(ctx, raw); err != nil { t.Fatal(err) }
	}
	makeCanvas(owner, "root-a", "")
	makeCanvas(owner, "child-a", "root-a")
	makeCanvas(owner, "root-b", "")
	makeCanvas(owner, "child-b", "root-b")
	// A foreign account can submit this workspace string, but it must not grant access.
	makeCanvas(other, "foreign-child", "root-a")
	doc, err := CreateCurrentUserProduction(owner, "root-a", "短剧制作计划")
	if err != nil { t.Fatal(err) }
	duplicate, err := CreateCurrentUserProduction(owner, "root-a", "不覆盖原名称")
	if err != nil || duplicate.ID != doc.ID || duplicate.Title != doc.Title || duplicate.Revision != 1 {
		t.Fatalf("duplicate create replaced plan: %+v / %v", duplicate, err)
	}
	doc.Episodes = []model.ProductionEpisode{{ID: "episode", Title: "第一集", Script: "原剧本", Order: 0}}
	doc.Scenes = []model.ProductionScene{{ID: "scene", EpisodeID: "episode", Title: "街道", Description: "原场次", Order: 0}}
	doc.Assets = []model.ProductionAsset{{ID: "asset", Kind: "character", Title: "主角", Description: "原设定", References: []model.ProductionNodeRef{{CanvasID: "child-a", NodeID: "image"}}}}
	doc.Shots = []model.ProductionShot{{ID: "shot", EpisodeID: "episode", SceneID: "scene", Title: "街头镜头", Description: "原画面", Seconds: 5, AssetIDs: []string{"asset"}, CanvasID: "child-a", TextNodeID: "text", ImageNodeID: "image", VideoNodeID: "video", Status: "draft"}}
	doc, err = SaveCurrentUserProduction(owner, *doc)
	if err != nil || doc.Revision != 2 { t.Fatalf("initial save: %+v / %v", doc, err) }
	load := func() model.ProductionDocument {
		t.Helper()
		current, err := CurrentUserProduction(owner, "root-a")
		if err != nil || current == nil { t.Fatalf("load plan: %+v / %v", current, err) }
		return *current
	}
	snapshot := func() string {
		t.Helper()
		raw, err := json.Marshal(load())
		if err != nil { t.Fatal(err) }
		return string(raw)
	}
	t.Run("stale revision cannot change any table", func(t *testing.T) {
		before := snapshot()
		stale := load()
		stale.Revision--
		stale.Title, stale.Episodes[0].Script = "旧窗口覆盖", "不可写入"
		if _, err := SaveCurrentUserProduction(owner, stale); err == nil || !strings.Contains(err.Error(), "其他窗口") { t.Fatalf("stale save was not rejected: %v", err) }
		if after := snapshot(); after != before { t.Fatal("stale save changed persisted document") }
	})
	t.Run("account, workspace, and node types are checked", func(t *testing.T) {
		before := snapshot()
		if visible, err := CurrentUserProduction(other, "root-a"); err != nil || visible != nil { t.Fatalf("foreign plan was visible: %+v / %v", visible, err) }
		if _, err := CreateCurrentUserProduction(other, "root-a", "禁止跨账号"); err == nil { t.Fatal("foreign root accepted") }
		if _, err := CreateCurrentUserProduction(owner, "child-a", "禁止绑定子画布"); err == nil { t.Fatal("child canvas accepted as workspace") }
		if _, err := SaveCurrentUserProduction(other, load()); err == nil { t.Fatal("foreign account modified plan") }
		if err := DeleteCurrentUserProduction(other, doc.ID, doc.Revision); err == nil { t.Fatal("foreign account deleted plan") }
		cases := []struct { name string; change func(*model.ProductionDocument) }{
			{"foreign reference", func(d *model.ProductionDocument) { d.Assets[0].References[0].CanvasID = "foreign-child" }},
			{"other workspace reference", func(d *model.ProductionDocument) { d.Assets[0].References[0].CanvasID = "child-b" }},
			{"other workspace shot", func(d *model.ProductionDocument) { d.Shots[0].CanvasID = "child-b" }},
			{"missing node", func(d *model.ProductionDocument) { d.Shots[0].TextNodeID = "missing" }},
			{"panorama is not shot image", func(d *model.ProductionDocument) { d.Shots[0].ImageNodeID = "panorama" }},
			{"wrong text type", func(d *model.ProductionDocument) { d.Shots[0].TextNodeID = "video" }},
		}
		for _, test := range cases {
			draft := load()
			test.change(&draft)
			if _, err := SaveCurrentUserProduction(owner, draft); err == nil { t.Fatalf("%s accepted", test.name) }
			if snapshot() != before { t.Fatalf("%s changed persisted plan", test.name) }
		}
		valid := load()
		valid.Assets[0].References[0].NodeID = "panorama"
		if _, err := SaveCurrentUserProduction(owner, valid); err != nil { t.Fatalf("panorama asset reference rejected: %v", err) }
	})
	t.Run("child insertion failure rolls back root revision and all children", func(t *testing.T) {
		before := snapshot()
		forced := errors.New("forced production shot insert failure")
		fired := false
		const callback = "test:production_shot_failure"
		if err := db.Callback().Create().Before("gorm:create").Register(callback, func(tx *gorm.DB) {
			if tx.Statement.Table == "production_shots" { fired = true; tx.AddError(forced) }
		}); err != nil { t.Fatal(err) }
		t.Cleanup(func() { _ = db.Callback().Create().Remove(callback) })
		draft := load()
		draft.Title, draft.Episodes[0].Script = "不应保存", "已执行过分集写入"
		draft.Scenes[0].Description, draft.Assets[0].Description, draft.Shots[0].Description = "不应保存", "不应保存", "触发写入失败"
		if _, err := SaveCurrentUserProduction(owner, draft); !errors.Is(err, forced) || !fired { t.Fatalf("failure was not injected at final child insert: %v", err) }
		if snapshot() != before { t.Fatal("failed transaction partially replaced production document") }
	})
	t.Run("child IDs cannot overwrite another production", func(t *testing.T) {
		before := snapshot()
		otherPlan, err := CreateCurrentUserProduction(owner, "root-b", "第二个项目")
		if err != nil { t.Fatal(err) }
		copy := load()
		copy.ProductionProject = otherPlan.ProductionProject
		copy.Episodes[0].Script = "第二个项目的剧本"
		copy.Assets[0].References[0].CanvasID, copy.Shots[0].CanvasID = "child-b", "child-b"
		if _, err := SaveCurrentUserProduction(owner, copy); err != nil { t.Fatalf("same child IDs in different project: %v", err) }
		if snapshot() != before { t.Fatal("second project replaced first project children") }
	})
	t.Run("candidates keep media identity, type, adoption, and canvas protection", func(t *testing.T) {
		makeCanvas(owner, "candidate-root", "")
		for _, id := range []string{"candidate-file-a", "candidate-file-b"} {
			if err := db.Create(&model.StorageObject{ID: id, ObjectKey: id, CreatedBy: "production-owner", MimeType: "image/png", Bytes: 1}).Error; err != nil { t.Fatal(err) }
		}
		const imageURL = "https://media.invalid/image.png?signature=first"
		const videoURL = "https://media.invalid/video.mp4"
		const otherURL = "https://media.invalid/other.png"
		makeResultCanvas := func(ctx context.Context, id, storageKey, storedURL, outputURL string) {
			t.Helper()
			raw, err := json.Marshal(map[string]any{
				"id": id, "workspaceId": "candidate-root", "createdAt": now(), "updatedAt": now(),
				"nodes": []map[string]any{
					{"id": "stored-image", "type": "image", "metadata": map[string]string{"status": "success", "storageKey": storageKey, "content": storedURL}},
					{"id": "url-video", "type": "video", "metadata": map[string]string{"status": "success", "content": outputURL}},
					{"id": "panorama", "type": "panorama", "metadata": map[string]string{"status": "success", "content": otherURL}},
					{"id": "loading", "type": "image", "metadata": map[string]string{"status": "loading", "content": otherURL}},
					{"id": "stopping", "type": "image", "metadata": map[string]string{"status": "stopping", "content": otherURL}},
					{"id": "error", "type": "video", "metadata": map[string]string{"status": "error", "content": otherURL}},
				},
			})
			if err != nil { t.Fatal(err) }
			if _, err := SaveCurrentUserCanvasProject(ctx, raw); err != nil { t.Fatal(err) }
		}
		makeResultCanvas(owner, "candidate-canvas", "server:candidate-file-a", imageURL, videoURL)
		makeResultCanvas(other, "candidate-foreign", "server:candidate-file-a", imageURL, videoURL)
		plan, err := CreateCurrentUserProduction(owner, "candidate-root", "候选验收")
		if err != nil { t.Fatal(err) }
		plan.Episodes = []model.ProductionEpisode{{ID: "candidate-episode", Title: "第一集"}}
		plan.Shots = []model.ProductionShot{{
			ID: "candidate-shot", EpisodeID: "candidate-episode", Title: "候选镜头", Seconds: 5, Status: "draft",
			Candidates: []model.ProductionCandidate{
				{ID: "candidate-image", Title: "图片 V1", Kind: "image", CanvasID: "candidate-canvas", NodeID: "stored-image", StorageKey: "server:candidate-file-a"},
				{ID: "candidate-video", Title: "视频 V1", Kind: "video", CanvasID: "candidate-canvas", NodeID: "url-video", Content: videoURL},
			},
			SelectedImageCandidateID: "candidate-image", SelectedVideoCandidateID: "candidate-video",
		}}
		if _, err := SaveCurrentUserProduction(owner, *plan); err != nil { t.Fatal(err) }
		loadCandidates := func() model.ProductionDocument {
			t.Helper()
			current, err := CurrentUserProduction(owner, "candidate-root")
			if err != nil || current == nil { t.Fatalf("load candidates: %+v / %v", current, err) }
			return *current
		}
		candidateSnapshot := func() string {
			t.Helper()
			raw, err := json.Marshal(loadCandidates())
			if err != nil { t.Fatal(err) }
			return string(raw)
		}
		before := candidateSnapshot()
		cases := []struct { name string; change func(*model.ProductionShot) }{
			{"foreign candidate", func(s *model.ProductionShot) { s.Candidates[0].CanvasID = "candidate-foreign" }},
			{"other workspace candidate", func(s *model.ProductionShot) { s.Candidates[0].CanvasID = "child-a" }},
			{"missing node", func(s *model.ProductionShot) { s.Candidates[0].NodeID = "missing" }},
			{"wrong node type", func(s *model.ProductionShot) { s.Candidates[0].Kind = "video"; s.SelectedImageCandidateID = "" }},
			{"unsupported type", func(s *model.ProductionShot) { s.Candidates[0].Kind = "audio"; s.SelectedImageCandidateID = "" }},
			{"panorama is not image", func(s *model.ProductionShot) { s.Candidates[0].NodeID, s.Candidates[0].StorageKey, s.Candidates[0].Content = "panorama", "", otherURL }},
			{"loading result", func(s *model.ProductionShot) { s.Candidates[0].NodeID, s.Candidates[0].StorageKey, s.Candidates[0].Content = "loading", "", otherURL }},
			{"stopping result", func(s *model.ProductionShot) { s.Candidates[0].NodeID, s.Candidates[0].StorageKey, s.Candidates[0].Content = "stopping", "", otherURL }},
			{"failed result", func(s *model.ProductionShot) { s.Candidates[1].NodeID, s.Candidates[1].Content = "error", otherURL }},
			{"changed storage identity", func(s *model.ProductionShot) { s.Candidates[0].StorageKey = "server:candidate-file-b" }},
			{"stored media also includes signed URL", func(s *model.ProductionShot) { s.Candidates[0].Content = imageURL }},
			{"URL cannot replace storage identity", func(s *model.ProductionShot) { s.Candidates[0].StorageKey, s.Candidates[0].Content = "", imageURL }},
			{"changed URL identity", func(s *model.ProductionShot) { s.Candidates[1].Content = otherURL }},
			{"URL media has no storage key", func(s *model.ProductionShot) { s.Candidates[1].StorageKey, s.Candidates[1].Content = "server:candidate-file-a", "" }},
			{"missing adopted ID", func(s *model.ProductionShot) { s.SelectedImageCandidateID = "missing" }},
			{"wrong adopted type", func(s *model.ProductionShot) { s.SelectedImageCandidateID = "candidate-video" }},
			{"duplicate global ID", func(s *model.ProductionShot) { s.Candidates[0].ID = s.ID; s.SelectedImageCandidateID = s.ID }},
			{"duplicate node", func(s *model.ProductionShot) { c := s.Candidates[0]; c.ID = "candidate-copy"; s.Candidates = append(s.Candidates, c) }},
		}
		for _, value := range []string{"data:image/png;base64,AA==", "blob:https://media.invalid/id", "/relative.png", "https://", "https://media.invalid/space here.png", "https://media.invalid/" + strings.Repeat("a", 4096)} {
			cases = append(cases, struct { name string; change func(*model.ProductionShot) }{"invalid candidate URL", func(s *model.ProductionShot) { s.Candidates[1].Content = value }})
		}
		for _, test := range cases {
			draft := loadCandidates()
			test.change(&draft.Shots[0])
			if _, err := SaveCurrentUserProduction(owner, draft); err == nil { t.Fatalf("%s accepted", test.name) }
			if candidateSnapshot() != before { t.Fatalf("%s mutated saved candidates", test.name) }
		}
		// Signed display URL refreshes do not change the persisted storage identity.
		makeResultCanvas(owner, "candidate-canvas", "server:candidate-file-a", "https://media.invalid/image.png?signature=second", videoURL)
		if _, err := SaveCurrentUserProduction(owner, loadCandidates()); err != nil { t.Fatalf("storage-key identity depended on display URL: %v", err) }
		makeResultCanvas(owner, "candidate-canvas", "server:candidate-file-b", imageURL, videoURL)
		if _, err := SaveCurrentUserProduction(owner, loadCandidates()); err == nil { t.Fatal("source file replacement left candidate valid") }
		makeResultCanvas(owner, "candidate-canvas", "server:candidate-file-a", imageURL, otherURL)
		if _, err := SaveCurrentUserProduction(owner, loadCandidates()); err == nil { t.Fatal("source URL replacement left candidate valid") }
		makeResultCanvas(owner, "candidate-canvas", "server:candidate-file-a", imageURL, videoURL)
		// The shot has no canvasId: only candidate references should protect this canvas.
		if err := repository.SoftDeleteUserCanvasProjects("production-owner", []string{"candidate-canvas"}, now()); !errors.Is(err, repository.ErrProductionCanvasReferenced) { t.Fatalf("candidate-only reference did not block deletion: %v", err) }
		if refs, err := CurrentUserProductionReferencesCanvases(owner, []string{"candidate-canvas"}); err != nil || !refs { t.Fatalf("candidate-only reference missing from read query: %v / %v", refs, err) }
		cleared := loadCandidates()
		cleared.Shots[0].Candidates = nil
		cleared.Shots[0].SelectedImageCandidateID, cleared.Shots[0].SelectedVideoCandidateID = "", ""
		if _, err := SaveCurrentUserProduction(owner, cleared); err != nil { t.Fatalf("clear candidate adoption: %v", err) }
		if err := DeleteCurrentUserCanvasProjects(owner, []string{"candidate-canvas"}); err != nil { t.Fatalf("cleared candidates still blocked deletion: %v", err) }
	})
	t.Run("canvas deletion is blocked until plan is deleted", func(t *testing.T) {
		for _, id := range []string{"root-a", "child-a"} {
			if err := repository.SoftDeleteUserCanvasProjects("production-owner", []string{id}, now()); !errors.Is(err, repository.ErrProductionCanvasReferenced) { t.Fatalf("referenced canvas %s deletion: %v", id, err) }
		}
		makeCanvas(owner, "unused-child", "root-a")
		if err := DeleteCurrentUserCanvasProjects(owner, []string{"unused-child"}); err != nil { t.Fatalf("unreferenced canvas blocked: %v", err) }
		current := load()
		if err := DeleteCurrentUserProduction(owner, current.ID, current.Revision-1); err == nil { t.Fatal("stale delete accepted") }
		if err := DeleteCurrentUserProduction(owner, current.ID, current.Revision); err != nil { t.Fatal(err) }
		if gone, err := CurrentUserProduction(owner, "root-a"); err != nil || gone != nil { t.Fatalf("deleted plan remains: %+v / %v", gone, err) }
		for _, table := range []any{&model.ProductionEpisode{}, &model.ProductionScene{}, &model.ProductionAsset{}, &model.ProductionShot{}} {
			var count int64
			if err := db.Model(table).Where("project_id = ?", current.ID).Count(&count).Error; err != nil || count != 0 { t.Fatalf("plan children remain: %d / %v", count, err) }
		}
		var canvasCount int64
		if err := db.Model(&model.CanvasProject{}).Where("user_id = ? AND id IN ? AND deleted_at = ''", "production-owner", []string{"root-a", "child-a"}).Count(&canvasCount).Error; err != nil || canvasCount != 2 { t.Fatalf("plan deletion removed canvases: %d / %v", canvasCount, err) }
		if err := DeleteCurrentUserCanvasProjects(owner, []string{"root-a", "child-a"}); err != nil { t.Fatalf("canvas remained blocked after plan deletion: %v", err) }
	})
}

func TestProductionCandidateLimits(t *testing.T) {
	makePlan := func(shots, candidates int) model.ProductionDocument {
		doc := model.ProductionDocument{ProductionProject: model.ProductionProject{ID: "plan", WorkspaceID: "root", Title: "候选上限", Revision: 1}, Episodes: []model.ProductionEpisode{{ID: "episode", Title: "第一集"}}}
		for i := 0; i < shots; i++ {
			shot := model.ProductionShot{ID: fmt.Sprintf("shot-%d", i), EpisodeID: "episode", Title: "镜头", Seconds: 5, Status: "draft"}
			for j := 0; j < candidates; j++ {
				shot.Candidates = append(shot.Candidates, model.ProductionCandidate{ID: fmt.Sprintf("candidate-%d-%d", i, j), Title: "候选", Kind: "image", CanvasID: "canvas", NodeID: fmt.Sprintf("node-%d", j), Content: "https://media.invalid/image.png"})
			}
			doc.Shots = append(doc.Shots, shot)
		}
		return doc
	}
	valid := makePlan(50, 20)
	if err := normalizeProduction(&valid); err != nil { t.Fatalf("1000 candidates rejected: %v", err) }
	tooManyPerShot := makePlan(1, 21)
	if err := normalizeProduction(&tooManyPerShot); err == nil || !strings.Contains(err.Error(), "20") { t.Fatalf("per-shot limit missing: %v", err) }
	tooManyTotal := makePlan(51, 20)
	if err := normalizeProduction(&tooManyTotal); err == nil || !strings.Contains(err.Error(), "1000") { t.Fatalf("plan candidate limit missing: %v", err) }
}
