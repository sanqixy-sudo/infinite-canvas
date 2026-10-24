package service

import (
	"context"
	"encoding/json"
	"errors"
	"io"
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

func TestReviewSnapshotPrivacyAndSelection(t *testing.T) {
	doc := model.ProductionDocument{ProductionProject: model.ProductionProject{ID: "p", UserID: "owner", WorkspaceID: "private-workspace", Revision: 3, Title: "审片"},
		Episodes: []model.ProductionEpisode{{ID: "e", Title: "第一集", Script: "private-script"}, {ID: "hidden", Title: "不分享"}},
		Shots: []model.ProductionShot{{ID: "s", EpisodeID: "e", Title: "镜头", CanvasID: "private-canvas", Description: "画面", Seconds: 5, SelectedImageCandidateID: "i", SelectedVideoCandidateID: "v", Candidates: []model.ProductionCandidate{{ID: "i", Kind: "image", StorageKey: "server:owned", Content: "https://secret.invalid/private?access=secret"}, {ID: "v", Kind: "video", Content: "https://secret.invalid/video"}}}, {ID: "hidden-shot", EpisodeID: "hidden", Title: "不分享"}}}
	input := ReviewPublishInput{WorkspaceID: doc.WorkspaceID, Revision: 3, EpisodeIDs: []string{"e"}}
	snapshot, ids, err := buildReviewSnapshot(doc, []model.StorageObject{{ID: "owned", CreatedBy: "owner", MimeType: "image/png"}}, input)
	if err != nil || len(snapshot.Shots) != 1 || len(ids) != 1 || snapshot.Shots[0].ImageID != "owned" || !snapshot.Shots[0].UnavailableMedia || snapshot.Episodes[0].Script != "" { t.Fatalf("snapshot selection: %+v %+v %v", snapshot, ids, err) }
	raw, _ := json.Marshal(ReviewDetail{ProductionReview: model.ProductionReview{WorkspaceID: doc.WorkspaceID, Snapshot: "private snapshot", MediaObjectIDs: ids}, Episodes: snapshot.Episodes, Shots: []ReviewShot{snapshot.Shots[0].ReviewShot}})
	for _, secret := range []string{"private-", "secret.invalid", "server:", "imageObjectId", "mediaObjectIds", "workspaceId"} { if strings.Contains(string(raw), secret) { t.Fatalf("private field leaked: %s", raw) } }
	input.Revision = 2; if _, _, err := buildReviewSnapshot(doc, nil, input); err == nil { t.Fatal("accepted stale version") }
	input.Revision = 3; input.EpisodeIDs = []string{"e", "e"}; if _, _, err := buildReviewSnapshot(doc, nil, input); err == nil { t.Fatal("accepted duplicate episodes") }
	input.EpisodeIDs = []string{"unknown"}; if _, _, err := buildReviewSnapshot(doc, nil, input); err == nil { t.Fatal("accepted unknown episode") }
	input.EpisodeIDs = []string{"e"}; snapshot, ids, err = buildReviewSnapshot(doc, []model.StorageObject{{ID: "owned", CreatedBy: "other", MimeType: "image/png"}}, input)
	if err != nil || len(ids) != 0 || snapshot.Shots[0].ImageID != "" { t.Fatal("shared another user's media") }
}

func TestTeamInvitesReviewRevocationAndIsolation(t *testing.T) {
	const marker = "TEAM_REVIEW_CHILD"
	if os.Getenv(marker) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second); defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestTeamInvitesReviewRevocationAndIsolation$", "-test.timeout=40s")
		command.Env = append(os.Environ(), marker+"=1")
		if output, err := command.CombinedOutput(); err != nil { t.Fatalf("team isolated database: %v\n%s", err, output) }; return
	}
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: filepath.Join(t.TempDir(), "team.db"), LocalStorageDir: t.TempDir()}
	db, err := repository.DB(); if err != nil { t.Fatal(err) }
	connection, err := db.DB(); if err != nil { t.Fatal(err) }; connection.SetMaxOpenConns(1); t.Cleanup(func() { _ = connection.Close() })
	if err := db.AutoMigrate(&model.Team{}, &model.TeamMember{}, &model.TeamInvite{}, &model.TeamProject{}, &model.TeamAsset{}, &model.TeamAudit{}, &model.ProductionReview{}, &model.ProductionReviewComment{}, &model.ProductionProject{}, &model.ProductionEpisode{}, &model.ProductionScene{}, &model.ProductionAsset{}, &model.ProductionShot{}); err != nil { t.Fatal(err) }
	for _, id := range []string{"team-owner", "team-member", "team-other"} { if err := db.Create(&model.User{ID: id, Username: id, AffCode: id, Role: model.UserRoleUser}).Error; err != nil { t.Fatal(err) } }
	owner := WithUser(context.Background(), model.AuthUser{ID: "team-owner", Role: model.UserRoleUser})
	member := WithUser(context.Background(), model.AuthUser{ID: "team-member", Role: model.UserRoleUser})
	other := WithUser(context.Background(), model.AuthUser{ID: "team-other", Role: model.UserRoleUser})
	team, err := CreateCurrentUserTeam(owner, "审片组"); if err != nil { t.Fatal(err) }
	invite, err := CreateCurrentTeamInvite(owner, team.ID); if err != nil { t.Fatal(err) }
	if _, err := JoinCurrentTeam(member, invite.Code); err != nil { t.Fatal(err) }
	if _, err := JoinCurrentTeam(member, invite.Code); err != nil { t.Fatalf("existing member should be idempotent: %v", err) }
	if _, err := JoinCurrentTeam(other, invite.Code); err == nil { t.Fatal("reused single-use invite") }
	if err := ChangeCurrentTeamMember(member, team.ID, "team-member", "admin"); !errors.Is(err, ErrStorageAccessDenied) { t.Fatalf("member escalated: %v", err) }
	if err := ChangeCurrentTeamMember(owner, team.ID, "team-owner", ""); !errors.Is(err, ErrStorageAccessDenied) { t.Fatalf("owner removed: %v", err) }
	file := model.StorageObject{ID: "team-image", CreatedBy: "team-owner", ProviderID: localStorageProviderID, ObjectKey: "team/image.png", MimeType: "image/png", Bytes: 3}
	if err := putLocalObject(file.ObjectKey, []byte("png")); err != nil { t.Fatal(err) }; if err := db.Create(&file).Error; err != nil { t.Fatal(err) }
	project := model.ProductionProject{ID: "team-plan", UserID: "team-owner", WorkspaceID: "team-workspace", Title: "短剧", Revision: 1}
	for _, row := range []any{&project, &model.ProductionEpisode{ProjectID: project.ID, ID: "episode", Title: "第一集"}, &model.ProductionShot{ProjectID: project.ID, ID: "shot", EpisodeID: "episode", Title: "镜头", SelectedImageCandidateID: "candidate", Candidates: []model.ProductionCandidate{{ID: "candidate", Kind: "image", StorageKey: "server:"+file.ID}}}} { if err := db.Create(row).Error; err != nil { t.Fatal(err) } }
	input := ReviewPublishInput{WorkspaceID: project.WorkspaceID, Revision: 1, EpisodeIDs: []string{"episode"}}
	if _, err := PublishCurrentTeamReview(member, team.ID, input); err == nil { t.Fatal("member published someone else's plan") }
	review, err := PublishCurrentTeamReview(owner, team.ID, input); if err != nil { t.Fatal(err) }
	public, err := CurrentProductionReview(member, review.ID); if err != nil || len(public.Shots) != 1 || public.Shots[0].ImageURL == "" { t.Fatalf("member review: %+v %v", public, err) }
	if _, err := StorageObjectInfo(member, file.ID); !errors.Is(err, ErrStorageAccessDenied) { t.Fatal("sharing opened private storage metadata") }
	download, err := CurrentReviewMedia(member, review.ID, "shot", "image", "bytes=0-1"); if err != nil { t.Fatal(err) }; body, _ := io.ReadAll(download.Stream); _ = download.Stream.Close()
	if string(body) != "pn" || download.StatusCode != 206 { t.Fatalf("range media: %q %d", body, download.StatusCode) }
	if err := AddCurrentReviewComment(member, review.ID, "other-shot", "意见"); err == nil { t.Fatal("commented on foreign shot") }
	if err := AddCurrentReviewComment(member, review.ID, "shot", "节奏再快一点"); err != nil { t.Fatal(err) }
	comments, err := CurrentReviewComments(owner, review.ID, "shot", model.Query{}); if err != nil || comments.Total != 1 { t.Fatalf("comments: %+v %v", comments, err) }
	if err := ChangeCurrentTeamMember(owner, team.ID, "team-member", ""); err != nil { t.Fatal(err) }
	if _, err := CurrentProductionReview(member, review.ID); !errors.Is(err, ErrStorageAccessDenied) { t.Fatalf("revoked member read snapshot: %v", err) }
	if _, err := CurrentReviewMedia(member, review.ID, "shot", "image", ""); !errors.Is(err, ErrStorageAccessDenied) { t.Fatalf("revoked member read old media URL: %v", err) }
	if err := AddCurrentReviewComment(member, review.ID, "shot", "应拒绝"); !errors.Is(err, ErrStorageAccessDenied) { t.Fatalf("revoked member posted comment: %v", err) }
	if err := RevokeCurrentProductionReview(owner, review.ID); err != nil { t.Fatal(err) }
	if _, err := CurrentReviewMedia(owner, review.ID, "shot", "image", ""); err == nil { t.Fatal("revoked review still served media") }
}
