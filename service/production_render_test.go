package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Tests exercise queue/ledger boundaries without executing FFmpeg or calling a model.
func TestProductionRenderIsolationAndRecovery(t *testing.T) {
	const marker = "PRODUCTION_RENDER_CHILD"
	if os.Getenv(marker) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestProductionRenderIsolationAndRecovery$", "-test.timeout=40s")
		cmd.Env = append(os.Environ(), marker+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("isolated render: %v\n%s", err, output)
		}
		return
	}
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: filepath.Join(t.TempDir(), "render.db")}
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
	for _, id := range []string{"render-owner", "render-other"} {
		if err := db.Create(&model.User{ID: id, Username: id, AffCode: id, Role: model.UserRoleUser, Status: model.UserStatusActive}).Error; err != nil {
			t.Fatal(err)
		}
	}
	owner := WithUser(context.Background(), model.AuthUser{ID: "render-owner", Role: model.UserRoleUser})
	other := WithUser(context.Background(), model.AuthUser{ID: "render-other", Role: model.UserRoleUser})
	input := ProductionRenderInput{WorkspaceID: "workspace", EpisodeID: "episode", Revision: 2, RequestID: "request"}
	raw, _ := json.Marshal(input)
	hash := sha256.Sum256(raw)
	job := model.ProductionRenderJob{ID: "render-job", UserID: "render-owner", RequestID: input.RequestID, RequestHash: hex.EncodeToString(hash[:]), WorkspaceID: input.WorkspaceID, EpisodeID: input.EpisodeID, Revision: 2, Status: "queued", SnapshotJSON: `{"clips":[],"secret":"do-not-expose"}`, ProviderID: "private-provider", CreatedAt: now(), UpdatedAt: now()}
	provider := model.StorageProvider{ID: job.ProviderID, Type: model.StorageProviderTypeS3, Endpoint: "https://render.invalid", Bucket: "render"}
	if _, err := repository.SaveSettings(model.Settings{Private: model.PrivateSetting{Storage: model.PrivateStorageSetting{Providers: []model.StorageProvider{provider}}}}, now()); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&job).Error; err != nil {
		t.Fatal(err)
	}
	// No plan or FFmpeg fixture: an accepted request must recover before rechecking either.
	recovered, err := CreateCurrentUserProductionRender(owner, input)
	if err != nil || recovered.ID != job.ID {
		t.Fatalf("accepted recovery: %+v %v", recovered, err)
	}
	changed := input
	changed.Revision++
	if _, err := CreateCurrentUserProductionRender(owner, changed); err == nil {
		t.Fatal("request payload replacement accepted")
	}
	if result, err := CurrentUserProductionRenderRequest(other, input.RequestID); err != nil || result != nil {
		t.Fatalf("foreign request visible: %+v %v", result, err)
	}
	if _, err := ActionCurrentUserProductionRender(other, job.ID, "cancel"); err == nil {
		t.Fatal("foreign job cancelled")
	}
	encoded, _ := json.Marshal(job)
	if strings.Contains(string(encoded), "do-not-expose") || strings.Contains(string(encoded), "private-provider") {
		t.Fatal("private snapshot exposed")
	}
	tombstone, err := CancelCurrentUserProductionRenderRequest(owner, "late-request")
	if err != nil || tombstone.Status != "cancelled" {
		t.Fatalf("cancel before post: %+v %v", tombstone, err)
	}
	late := input
	late.RequestID = "late-request"
	if _, err := CreateCurrentUserProductionRender(owner, late); err == nil {
		t.Fatal("late POST escaped cancelled request tombstone")
	}
	nowUnix := time.Now().Unix()
	claimed, err := repository.ClaimProductionRender("worker-one", now(), nowUnix, nowUnix+60)
	if err != nil || claimed == nil || claimed.ID != job.ID {
		t.Fatalf("claim: %+v %v", claimed, err)
	}
	second, err := repository.ClaimProductionRender("worker-two", now(), nowUnix+1, nowUnix+61)
	if err != nil || second != nil {
		t.Fatalf("another worker bypassed lease: %+v %v", second, err)
	}
	if err := repository.RenewProductionRenderLease("worker-two", nowUnix+2, nowUnix+62); !errors.Is(err, repository.ErrProductionRenderStopped) {
		t.Fatalf("foreign lease renewal: %v", err)
	}
	reservation := model.StorageUploadReservation{ID: "render-reservation", UserID: job.UserID, Bytes: 4, ExpiresAt: nowUnix + 1800}
	if err := repository.ReserveUserStorageUpload(reservation, 100, nowUnix); err != nil {
		t.Fatal(err)
	}
	object := model.StorageObject{ID: job.ID, CreatedBy: job.UserID, ProviderID: job.ProviderID, ObjectKey: "renders/output.mp4", MimeType: "video/mp4", Bytes: 4}
	if err := repository.ActionProductionRender(job.UserID, job.ID, "cancel", now(), nil); err != nil {
		t.Fatal(err)
	}
	if err := repository.CompleteProductionRender(*claimed, object, reservation.ID, 100, nowUnix, now()); !errors.Is(err, repository.ErrProductionRenderStopped) {
		t.Fatalf("cancelled upload committed: %v", err)
	}
	var count int64
	db.Model(&model.StorageObject{}).Where("id = ?", job.ID).Count(&count)
	if count != 0 {
		t.Fatal("cancelled output consumed storage")
	}
	db.Model(&model.StorageUploadReservation{}).Where("id = ?", reservation.ID).Count(&count)
	if count != 1 {
		t.Fatal("failed completion removed reservation outside transaction")
	}
	if err := repository.ActionProductionRender(job.UserID, job.ID, "retry", now(), nil); err != nil {
		t.Fatal(err)
	}
	if err := repository.ReleaseProductionRenderLease("worker-one"); err != nil {
		t.Fatal(err)
	}
	retry, err := repository.ClaimProductionRender("worker-new", now(), nowUnix+3, nowUnix+63)
	if err != nil || retry == nil {
		t.Fatal(err)
	}
	if err := repository.CompleteProductionRender(*claimed, object, reservation.ID, 100, nowUnix+4, now()); !errors.Is(err, repository.ErrProductionRenderStopped) {
		t.Fatalf("old worker committed after retry: %v", err)
	}
	intent := model.ProductionRenderUpload{ID: retry.WorkerID, JobID: retry.ID, UserID: retry.UserID, ProviderID: object.ProviderID, ProviderIdentity: renderProviderIdentity(provider), ObjectKey: object.ObjectKey, ReservationID: reservation.ID, State: "pending", NextCheckAt: nowUnix + 3600}
	if err := repository.PrepareProductionRenderUpload(*retry, intent, nowUnix+4); err != nil {
		t.Fatal(err)
	}
	if err := repository.CompleteProductionRender(*retry, object, reservation.ID, 100, nowUnix+4, now()); err != nil {
		t.Fatal(err)
	}
	saved, err := repository.GetProductionRender(job.UserID, job.ID)
	if err != nil || saved.Status != "completed" || saved.OutputBytes != 4 || saved.OutputStorageKey != "server:"+job.ID {
		t.Fatalf("completion: %+v %v", saved, err)
	}
	db.Model(&model.StorageUploadReservation{}).Where("id = ?", reservation.ID).Count(&count)
	if count != 0 {
		t.Fatal("successful output retained reservation")
	}
	if err := repository.CompleteProductionRender(*retry, object, reservation.ID, 100, nowUnix+4, now()); !errors.Is(err, repository.ErrProductionRenderStopped) {
		t.Fatalf("duplicate completion: %v", err)
	}
	t.Run("orphan uploads cannot erase indexed outputs", func(t *testing.T) {
		indexed := model.ProductionRenderUpload{ID: "journal-indexed", JobID: job.ID, UserID: job.UserID, ProviderID: object.ProviderID, ObjectKey: object.ObjectKey, State: "pending", NextCheckAt: nowUnix}
		if err := db.Create(&indexed).Error; err != nil {
			t.Fatal(err)
		}
		if claimed, err := repository.ClaimProductionRenderCleanup(indexed, nowUnix+5, nowUnix+3600); err != nil || claimed {
			t.Fatalf("indexed output scheduled for delete: %v %v", claimed, err)
		}
		var count int64
		db.Model(&model.StorageObject{}).Where("id = ?", object.ID).Count(&count)
		if count != 1 {
			t.Fatal("indexed output removed")
		}
		orphan := model.ProductionRenderUpload{ID: "journal-orphan", JobID: "expired-job", UserID: job.UserID, ProviderID: object.ProviderID, ObjectKey: "renders/orphan.mp4", State: "pending", NextCheckAt: nowUnix}
		if err := db.Create(&orphan).Error; err != nil {
			t.Fatal(err)
		}
		if claimed, err := repository.ClaimProductionRenderCleanup(orphan, nowUnix+5, nowUnix+3600); err != nil || !claimed {
			t.Fatalf("unindexed orphan not scheduled: %v %v", claimed, err)
		}
		if err := repository.FinishProductionRenderCleanup(orphan.ID); err != nil {
			t.Fatal(err)
		}
		var retained model.ProductionRenderUpload
		if err := db.First(&retained, "id = ?", orphan.ID).Error; err != nil || retained.State != "cleaned" {
			t.Fatalf("late-write cleanup tombstone missing: %+v %v", retained, err)
		}
		if claimed, err := repository.ClaimProductionRenderCleanup(orphan, nowUnix+3601, nowUnix+7200); err != nil || !claimed {
			t.Fatalf("late upload not eligible for second cleanup: %v %v", claimed, err)
		}
	})
	t.Run("audio create is idempotent and cancellation blocks late posts", func(t *testing.T) {
		for _, row := range []any{&model.ProductionProject{ID: "audio-plan", UserID: job.UserID, WorkspaceID: "workspace", Revision: 1}, &model.ProductionEpisode{ID: "audio-episode", ProjectID: "audio-plan"}, &model.ProductionShot{ID: "shot", ProjectID: "audio-plan", EpisodeID: "audio-episode"}} {
			if err := db.Create(row).Error; err != nil {
				t.Fatal(err)
			}
		}
		limit := 1.25
		input := CanvasAudioTaskCreateInput{UserID: job.UserID, ClientTaskID: "production_voice_once", Model: "tts-1", ChannelID: "channel", SourceID: "workspace", NodeID: "shot", Prompt: "hello", Endpoint: "/audio/speech", ContentType: "application/json", RequestBody: `{"input":"hello"}`, MaxCredits: &limit}
		first, err := CreateCanvasAudioTask(input)
		if err != nil || !first.NewlyCreated {
			t.Fatalf("first audio create: %+v %v", first, err)
		}
		again, err := CreateCanvasAudioTask(input)
		if err != nil || again.NewlyCreated || again.ID != first.ID {
			t.Fatalf("duplicate starts another audio task: %+v %v", again, err)
		}
		changed := input
		changed.Prompt = "different"
		if _, err := CreateCanvasAudioTask(changed); !errors.Is(err, repository.ErrAudioTaskConflict) {
			t.Fatalf("audio payload changed: %v", err)
		}
		foreign := input
		foreign.UserID = "render-other"
		if _, err := CreateCanvasAudioTask(foreign); err == nil {
			t.Fatal("foreign audio ID reused")
		}
		if stopped, err := StopCanvasTask(job.UserID, "audio", "production_voice_cancel", false, "canvas"); err != nil || !stopped {
			t.Fatalf("cancel unconfirmed audio: %v %v", stopped, err)
		}
		late := input
		late.ClientTaskID = "production_voice_cancel"
		if _, err := CreateCanvasAudioTask(late); err == nil {
			t.Fatal("late audio create escaped cancellation")
		}
		ctx := WithTaskCreditLimit(context.Background(), &limit)
		if !TaskCreditWithinLimit(ctx, 1.25) || TaskCreditWithinLimit(ctx, 1.26) || !TaskCreditWithinLimit(context.Background(), 2) {
			t.Fatal("audio confirmation price limit incorrect")
		}
	})
}

func TestProductionRenderStorageAndCommandBoundaries(t *testing.T) {
	for _, key := range []string{"https://external.example/a.mp4", "video:browser", "server:webdav:/path", "server:../private", "server:", "server:a\nb"} {
		if _, err := productionRenderFileID(key); err == nil {
			t.Fatalf("unowned/invalid key accepted: %q", key)
		}
	}
	if id, err := productionRenderFileID("server:owned-file"); err != nil || id != "owned-file" {
		t.Fatalf("owned id: %s %v", id, err)
	}
	file := model.StorageObject{ID: "audio", CreatedBy: "owner", MimeType: "audio/mpeg"}
	data := repository.StorageReferenceData{ProductionRenders: []model.ProductionRenderJob{{ID: "render", UserID: "owner", Status: "queued", SnapshotJSON: `{"clips":[],"delivery":{"audioTracks":[{"storageKey":"server:audio"}]}}`}}}
	refs := storageFileReferences(file, data, model.PrivateStorageSetting{})
	if refs.CanDelete || len(refs.Blockers) == 0 {
		t.Fatal("queued background audio was not protected from deletion")
	}
	args := renderClipArgs("/tmp/input.png", "/tmp/output.mp4", productionRenderClip{Kind: "image", Seconds: 5}, false)
	joined := strings.Join(args, " ")
	for _, required := range []string{"-protocol_whitelist file,pipe", "-format_whitelist ", "-c:v libx264 -threads 2", "-map_metadata -1", "anullsrc=", "scale=720:1280", "-fs 268435456"} {
		if !strings.Contains(joined, required) {
			t.Fatalf("missing media boundary: %s", required)
		}
	}
	for _, forbidden := range []string{"http", "https", "concat:"} {
		if strings.Contains(joined, forbidden) {
			t.Fatalf("network-capable input protocol in args: %s", forbidden)
		}
	}
}

func TestProductionDeliverySubtitleAndAudioBoundaries(t *testing.T) {
	doc := model.ProductionDocument{Episodes: []model.ProductionEpisode{{ID: "episode", Delivery: &model.ProductionDeliveryEdit{OriginalGain: 1, AudioTracks: []model.ProductionAudioTrack{{ID: "track", ShotID: "shot", StorageKey: "server:audio", Label: "配音", StartSeconds: 2, TrimStartSeconds: 1, DurationSeconds: 3, Gain: 0.5}}, Subtitles: []model.ProductionSubtitle{{ID: "caption", ShotID: "shot", StartSeconds: 2, EndSeconds: 5, Text: "对白"}}}}}, Shots: []model.ProductionShot{{ID: "shot", EpisodeID: "episode"}}}
	if err := validateProductionDelivery(doc); err != nil {
		t.Fatal(err)
	}
	edit := *doc.Episodes[0].Delivery
	args := strings.Join(productionMixArgs("/tmp/joined.mp4", "/tmp/final.mp4", []string{"/tmp/voice.wav"}, edit, 10), " ")
	for _, expected := range []string{"atrim=start=1.000:duration=3.000", "adelay=2000:all=1", "volume=0.500", "amix=inputs=2", "-protocol_whitelist file,pipe", "-c:v copy", "-t 10"} {
		if !strings.Contains(args, expected) {
			t.Fatalf("missing mix boundary %q", expected)
		}
	}
	edit.BurnSubtitles = true
	args = strings.Join(productionMixArgs("in.mp4", "out.mp4", []string{"audio.wav"}, edit, 10), " ")
	if !strings.Contains(args, "subtitles=filename=captions.ass") || !strings.Contains(args, "-c:v libx264 -threads 2") {
		t.Fatal("burn subtitles not configured")
	}
	ass := productionASS([]model.ProductionSubtitle{{StartSeconds: 1.239, EndSeconds: 3, Text: "你好{\\pos(0,0)}\n第二行"}})
	if strings.Contains(ass, "{\\pos") || !strings.Contains(ass, "0:00:01.24") || !strings.Contains(ass, "\\N第二行") {
		t.Fatalf("ASS escaping/time incorrect: %s", ass)
	}
	doc.Episodes[0].Delivery.AudioTracks[0].ShotID = "foreign"
	if validateProductionDelivery(doc) == nil {
		t.Fatal("foreign shot accepted")
	}
	doc.Episodes[0].Delivery.AudioTracks[0].ShotID = "shot"
	doc.Episodes[0].Delivery.AudioTracks[0].StartSeconds = 299
	if validateProductionDelivery(doc) == nil {
		t.Fatal("audio beyond render cap accepted")
	}
}
