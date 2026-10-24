package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
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

var errRenderCommitAcknowledgement = errors.New("injected: committed, acknowledgement lost")

// Exercise the genuinely ambiguous outcome: SQL commits successfully, then its acknowledgement fails.
type renderCommitFaultPool struct {
	*sql.DB
	fail *bool
}
type renderCommitFaultTx struct {
	*sql.Tx
	fail *bool
}

func (pool *renderCommitFaultPool) BeginTx(ctx context.Context, opts *sql.TxOptions) (gorm.ConnPool, error) {
	tx, err := pool.DB.BeginTx(ctx, opts)
	if err != nil {
		return nil, err
	}
	return &renderCommitFaultTx{tx, pool.fail}, nil
}
func (tx *renderCommitFaultTx) Commit() error {
	if err := tx.Tx.Commit(); err != nil {
		return err
	}
	if *tx.fail {
		*tx.fail = false
		return errRenderCommitAcknowledgement
	}
	return nil
}

// No real R2, production database, FFmpeg, or model is contacted. Each process owns a temporary SQLite DB.
func TestProductionRenderStorageFailureRecovery(t *testing.T) {
	const marker = "PRODUCTION_RENDER_STORAGE_RECOVERY_CHILD"
	if os.Getenv(marker) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestProductionRenderStorageFailureRecovery$", "-test.timeout=55s")
		cmd.Env = append(os.Environ(), marker+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("isolated render storage recovery: %v\n%s", err, output)
		}
		return
	}
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: filepath.Join(t.TempDir(), "recovery.db"), LocalStorageDir: t.TempDir()}
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
	provider := model.StorageProvider{ID: "recovery-r2", Type: model.StorageProviderTypeS3, Endpoint: "https://account.r2.cloudflarestorage.com", Bucket: "renders", AccessKeyID: "test-only", SecretAccessKey: "test-only", Enabled: true}
	settings := model.Settings{Private: model.PrivateSetting{Storage: model.PrivateStorageSetting{Mode: "r2", AllowUserGlobalProvider: true, Providers: []model.StorageProvider{provider}}}}
	if _, err := repository.SaveSettings(settings, now()); err != nil {
		t.Fatal(err)
	}
	filename := filepath.Join(t.TempDir(), "render.mp4")
	if err := os.WriteFile(filename, []byte("mp4!"), 0600); err != nil {
		t.Fatal(err)
	}
	objects := map[string]string{}
	deletes := []string{}
	var onPut func(*http.Request)
	savedClient := safeProxyHTTPClient
	safeProxyHTTPClient = &http.Client{Transport: storageQuotaTransport(func(request *http.Request) (*http.Response, error) {
		if request.URL.Host != "account.r2.cloudflarestorage.com" {
			t.Fatalf("unexpected host: %s", request.URL.Host)
		}
		switch request.Method {
		case http.MethodPut:
			data, err := io.ReadAll(request.Body)
			if err != nil {
				return nil, err
			}
			objects[request.URL.Path] = string(data)
			if onPut != nil {
				onPut(request)
			}
		case http.MethodDelete:
			deletes = append(deletes, request.URL.Path)
			delete(objects, request.URL.Path)
		default:
			t.Fatalf("unexpected network operation: %s", request.Method)
		}
		return &http.Response{StatusCode: http.StatusNoContent, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("")), Request: request}, nil
	})}
	t.Cleanup(func() { safeProxyHTTPClient = savedClient })
	newJob := func(t *testing.T, id string) (model.ProductionRenderJob, context.Context) {
		t.Helper()
		user := model.User{ID: id, Username: id, AffCode: id, Role: model.UserRoleUser, Status: model.UserStatusActive}
		if err := db.Create(&user).Error; err != nil {
			t.Fatal(err)
		}
		job := model.ProductionRenderJob{ID: id, UserID: id, RequestID: id, Status: "running", WorkerID: id + "-worker", ProviderID: provider.ID, CreatedAt: now()}
		if err := db.Create(&job).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Save(&model.ProductionRenderLease{ID: "renderer", WorkerID: job.WorkerID, ExpiresAt: time.Now().Add(time.Minute).Unix()}).Error; err != nil {
			t.Fatal(err)
		}
		return job, WithUser(context.Background(), model.PublicUser(user))
	}
	journal := func(t *testing.T, job model.ProductionRenderJob) model.ProductionRenderUpload {
		t.Helper()
		var row model.ProductionRenderUpload
		if err := db.First(&row, "id = ?", job.WorkerID).Error; err != nil {
			t.Fatal(err)
		}
		return row
	}
	makeDue := func(t *testing.T, id string) {
		t.Helper()
		if err := db.Model(&model.ProductionRenderUpload{}).Where("id = ?", id).Update("next_check_at", 0).Error; err != nil {
			t.Fatal(err)
		}
	}
	count := func(t *testing.T, row any, query string, value string) int64 {
		t.Helper()
		var n int64
		if err := db.Model(row).Where(query, value).Count(&n).Error; err != nil {
			t.Fatal(err)
		}
		return n
	}

	t.Run("commit acknowledgement loss preserves valid R2 output", func(t *testing.T) {
		job, ctx := newJob(t, "committed")
		fail := false
		savedPool, savedStatementPool := db.ConnPool, db.Statement.ConnPool
		pool := &renderCommitFaultPool{connection, &fail}
		db.ConnPool, db.Statement.ConnPool = pool, pool
		defer func() { db.ConnPool, db.Statement.ConnPool = savedPool, savedStatementPool; onPut = nil }()
		onPut = func(*http.Request) { fail = true }
		before := len(deletes)
		if err := persistProductionRender(ctx, job, filename); !errors.Is(err, errRenderCommitAcknowledgement) {
			t.Fatalf("missing ambiguous commit injection: %v", err)
		}
		object, err := repository.GetStorageObject(job.ID)
		if err != nil {
			t.Fatal(err)
		}
		if objects["/"+provider.Bucket+"/"+object.ObjectKey] != "mp4!" || len(deletes) != before {
			t.Fatal("committed file was deleted after acknowledgement loss")
		}
		saved, err := repository.GetProductionRender(job.UserID, job.ID)
		if err != nil || saved.Status != "completed" {
			t.Fatalf("commit did not apply: %+v %v", saved, err)
		}
		if count(t, &model.ProductionRenderUpload{}, "job_id = ?", job.ID) != 0 || count(t, &model.StorageUploadReservation{}, "user_id = ?", job.UserID) != 0 {
			t.Fatal("successful transaction retained upload journal or reservation")
		}
	})
	t.Run("cancelled late upload cannot overwrite retry", func(t *testing.T) {
		job, ctx := newJob(t, "cancelled")
		var oldPath string
		onPut = func(request *http.Request) {
			oldPath = request.URL.Path
			if err := repository.ActionProductionRender(job.UserID, job.ID, "cancel", now(), nil); err != nil {
				t.Fatal(err)
			}
			makeDue(t, job.WorkerID)
			cleanupProductionRenderUploads()
			// The original PUT completes after cleanup's DELETE and recreates its own attempt key.
			objects[oldPath] = "late old attempt"
		}
		defer func() { onPut = nil }()
		if err := persistProductionRender(ctx, job, filename); !errors.Is(err, repository.ErrProductionRenderStopped) {
			t.Fatalf("late cancellation committed: %v", err)
		}
		if count(t, &model.StorageObject{}, "id = ?", job.ID) != 0 {
			t.Fatal("cancelled file was registered")
		}
		row := journal(t, job)
		if row.State != "cleaned" || objects[oldPath] == "" {
			t.Fatal("late-write tombstone fixture invalid")
		}
		if err := repository.ActionProductionRender(job.UserID, job.ID, "retry", now(), nil); err != nil {
			t.Fatal(err)
		}
		if err := repository.ReleaseProductionRenderLease(job.WorkerID); err != nil {
			t.Fatal(err)
		}
		retry, err := repository.ClaimProductionRender("retry-worker", now(), time.Now().Unix(), time.Now().Add(time.Minute).Unix())
		if err != nil || retry == nil {
			t.Fatalf("retry claim: %+v %v", retry, err)
		}
		onPut = nil
		if err := persistProductionRender(ctx, *retry, filename); err != nil {
			t.Fatal(err)
		}
		current, err := repository.GetStorageObject(job.ID)
		if err != nil {
			t.Fatal(err)
		}
		newPath := "/" + provider.Bucket + "/" + current.ObjectKey
		if newPath == oldPath {
			t.Fatal("retry reused old attempt key")
		}
		makeDue(t, row.ID)
		cleanupProductionRenderUploads()
		if objects[oldPath] != "" || objects[newPath] != "mp4!" {
			t.Fatal("cleanup retained late orphan or deleted valid retry")
		}
	})
	t.Run("expired lease recovers without re-executing old job", func(t *testing.T) {
		job, ctx := newJob(t, "crashed")
		onPut = func(*http.Request) {
			if err := db.Model(&model.ProductionRenderLease{}).Where("id = ?", "renderer").Update("expires_at", 0).Error; err != nil {
				t.Fatal(err)
			}
		}
		if err := persistProductionRender(ctx, job, filename); !errors.Is(err, repository.ErrProductionRenderStopped) {
			t.Fatalf("expired worker committed: %v", err)
		}
		onPut = nil
		row := journal(t, job)
		claimed, err := repository.ClaimProductionRender("restarted-worker", now(), time.Now().Unix(), time.Now().Add(time.Minute).Unix())
		if err != nil || claimed != nil {
			t.Fatalf("restart replayed interrupted render: %+v %v", claimed, err)
		}
		saved, err := repository.GetProductionRender(job.UserID, job.ID)
		if err != nil || saved.Status != "failed" {
			t.Fatalf("interrupted job not failed: %+v %v", saved, err)
		}
		makeDue(t, row.ID)
		cleanupProductionRenderUploads()
		if objects["/"+provider.Bucket+"/"+row.ObjectKey] != "" || count(t, &model.StorageObject{}, "id = ?", job.ID) != 0 {
			t.Fatal("restart retained orphan or registered expired output")
		}
	})
	t.Run("live lease and R2 target are protected during upload", func(t *testing.T) {
		firstUploadProvider := provider
		firstUploadProvider.ID = "first-upload-r2"
		settings.Private.Storage.Providers = append(settings.Private.Storage.Providers, firstUploadProvider)
		if _, err := repository.SaveSettings(settings, now()); err != nil {
			t.Fatal(err)
		}
		job, ctx := newJob(t, "live")
		job.ProviderID = firstUploadProvider.ID
		if err := db.Model(&job).Update("provider_id", job.ProviderID).Error; err != nil {
			t.Fatal(err)
		}
		onPut = func(request *http.Request) {
			makeDue(t, job.WorkerID)
			before := len(deletes)
			cleanupProductionRenderUploads()
			if len(deletes) != before || journal(t, job).State != "pending" {
				t.Fatal("cleanup touched active upload")
			}
			changed := settings
			changed.Private.Storage.Providers = append([]model.StorageProvider(nil), settings.Private.Storage.Providers...)
			last := len(changed.Private.Storage.Providers) - 1
			changed.Private.Storage.Providers[last].Bucket = "wrong-bucket"
			if _, err := repository.SaveSettings(changed, now()); err == nil {
				t.Fatal("bucket changed during unfinished upload")
			}
			changed.Private.Storage.Providers[last] = firstUploadProvider
			changed.Private.Storage.Providers[last].SecretAccessKey = "rotated-test-only"
			changed.Private.Storage.Providers[last].Enabled = false
			if _, err := repository.SaveSettings(changed, now()); err != nil {
				t.Fatalf("credential rotation/disable blocked: %v", err)
			}
			if _, err := repository.SaveSettings(settings, now()); err != nil {
				t.Fatal(err)
			}
		}
		if err := persistProductionRender(ctx, job, filename); err != nil {
			t.Fatal(err)
		}
		onPut = nil
	})
	t.Run("expired space reservation leaves recoverable orphan", func(t *testing.T) {
		job, ctx := newJob(t, "expired-space")
		onPut = func(*http.Request) {
			if err := db.Model(&model.StorageUploadReservation{}).Where("user_id = ?", job.UserID).Update("expires_at", 0).Error; err != nil {
				t.Fatal(err)
			}
		}
		if err := persistProductionRender(ctx, job, filename); err == nil {
			t.Fatal("expired quota reservation committed")
		}
		onPut = nil
		row := journal(t, job)
		if objects["/"+provider.Bucket+"/"+row.ObjectKey] == "" {
			t.Fatal("unconfirmed output was blindly deleted")
		}
		if err := repository.UpdateProductionRender(job, 0, "injected upload failure", now()); err != nil {
			t.Fatal(err)
		}
		makeDue(t, row.ID)
		cleanupProductionRenderUploads()
		if count(t, &model.StorageObject{}, "id = ?", job.ID) != 0 || objects["/"+provider.Bucket+"/"+row.ObjectKey] != "" {
			t.Fatal("expired quota orphan recovery failed")
		}
	})
	t.Run("changed destination is rejected before upload intent", func(t *testing.T) {
		moving := provider
		moving.ID = "moving-r2"
		initial := settings
		initial.Private.Storage.Providers = append(append([]model.StorageProvider(nil), settings.Private.Storage.Providers...), moving)
		if _, err := repository.SaveSettings(initial, now()); err != nil {
			t.Fatal(err)
		}
		job, _ := newJob(t, "moved-before-upload")
		job.ProviderID = moving.ID
		if err := db.Model(&job).Update("provider_id", job.ProviderID).Error; err != nil {
			t.Fatal(err)
		}
		changed := initial
		changed.Private.Storage.Providers = append([]model.StorageProvider(nil), initial.Private.Storage.Providers...)
		changed.Private.Storage.Providers[len(changed.Private.Storage.Providers)-1].Bucket = "moved"
		if _, err := repository.SaveSettings(changed, now()); err != nil {
			t.Fatal(err)
		}
		intent := model.ProductionRenderUpload{ID: job.WorkerID, JobID: job.ID, UserID: job.UserID, ProviderID: moving.ID, ProviderIdentity: renderProviderIdentity(moving), ObjectKey: "old-target.mp4", State: "pending"}
		if err := repository.PrepareProductionRenderUpload(job, intent, time.Now().Unix()); !errors.Is(err, repository.ErrProductionRenderStopped) {
			t.Fatalf("old destination intent accepted: %v", err)
		}
		if count(t, &model.ProductionRenderUpload{}, "id = ?", job.WorkerID) != 0 {
			t.Fatal("rejected destination left journal")
		}
		if _, err := repository.SaveSettings(settings, now()); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("configuration mismatch never deletes another bucket", func(t *testing.T) {
		job, ctx := newJob(t, "changed-during-upload")
		onPut = func(*http.Request) {
			// Simulate out-of-band settings corruption, bypassing the guarded administrator save.
			changed := settings
			changed.Private.Storage.Providers = append([]model.StorageProvider(nil), settings.Private.Storage.Providers...)
			changed.Private.Storage.Providers[0].Bucket = "other-bucket"
			raw, err := json.Marshal(changed.Private)
			if err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.Setting{}).Where(map[string]any{"key": model.SettingKeyPrivate}).Update("value", json.RawMessage(raw)).Error; err != nil {
				t.Fatal(err)
			}
		}
		if err := persistProductionRender(ctx, job, filename); !errors.Is(err, repository.ErrProductionRenderStopped) {
			t.Fatalf("changed destination committed: %v", err)
		}
		onPut = nil
		row := journal(t, job)
		original := "/" + provider.Bucket + "/" + row.ObjectKey
		other := "/other-bucket/" + row.ObjectKey
		objects[other] = "unrelated object"
		if err := repository.UpdateProductionRender(job, 0, "injected configuration change", now()); err != nil {
			t.Fatal(err)
		}
		before := len(deletes)
		makeDue(t, row.ID)
		cleanupProductionRenderUploads()
		if len(deletes) != before || objects[original] == "" || objects[other] != "unrelated object" {
			t.Fatal("mismatched provider identity deleted a file")
		}
		// Restore exact physical destination as an operator would after repairing configuration.
		raw, err := json.Marshal(settings.Private)
		if err != nil {
			t.Fatal(err)
		}
		if err := db.Model(&model.Setting{}).Where(map[string]any{"key": model.SettingKeyPrivate}).Update("value", json.RawMessage(raw)).Error; err != nil {
			t.Fatal(err)
		}
		makeDue(t, row.ID)
		cleanupProductionRenderUploads()
		if objects[original] != "" || objects[other] != "unrelated object" {
			t.Fatal("restored provider cleanup targeted wrong bucket")
		}
	})
	t.Run("quota decrease after upload rejects registration", func(t *testing.T) {
		job, ctx := newJob(t, "reduced-space")
		commerce, err := AccountCommerceSettings()
		if err != nil {
			t.Fatal(err)
		}
		onPut = func(*http.Request) {
			reduced := commerce
			reduced.DefaultStorageBytes = 3
			if _, err := repository.SaveCommerceSettings(reduced, now()); err != nil {
				t.Fatal(err)
			}
		}
		if err := persistProductionRender(ctx, job, filename); err == nil {
			t.Fatal("quota decrease was ignored")
		}
		onPut = nil
		if _, err := repository.SaveCommerceSettings(commerce, now()); err != nil {
			t.Fatal(err)
		}
		row := journal(t, job)
		if err := repository.UpdateProductionRender(job, 0, "injected quota change", now()); err != nil {
			t.Fatal(err)
		}
		makeDue(t, row.ID)
		cleanupProductionRenderUploads()
		if count(t, &model.StorageObject{}, "id = ?", job.ID) != 0 || objects["/"+provider.Bucket+"/"+row.ObjectKey] != "" {
			t.Fatal("quota decrease committed output or leaked recoverable orphan")
		}
	})
	t.Run("deleted owner does not strand uploaded object", func(t *testing.T) {
		job, ctx := newJob(t, "deleted-owner")
		onPut = func(*http.Request) {
			if err := db.Where("id = ?", job.UserID).Delete(&model.User{}).Error; err != nil {
				t.Fatal(err)
			}
		}
		if err := persistProductionRender(ctx, job, filename); err == nil {
			t.Fatal("deleted owner received output")
		}
		onPut = nil
		row := journal(t, job)
		if err := repository.UpdateProductionRender(job, 0, "owner deleted", now()); err != nil {
			t.Fatal(err)
		}
		makeDue(t, row.ID)
		cleanupProductionRenderUploads()
		if objects["/"+provider.Bucket+"/"+row.ObjectKey] != "" || journal(t, job).State != "cleaned" {
			t.Fatal("deleted owner blocked orphan recovery")
		}
	})
	t.Run("deleted owner indexed output remains intact", func(t *testing.T) {
		object, err := repository.GetStorageObject("committed")
		if err != nil {
			t.Fatal(err)
		}
		row := model.ProductionRenderUpload{ID: "indexed-owner-cleanup", JobID: object.ID, UserID: object.CreatedBy, ProviderID: object.ProviderID, ProviderIdentity: renderProviderIdentity(provider), ObjectKey: object.ObjectKey, State: "pending"}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Where("id = ?", object.CreatedBy).Delete(&model.User{}).Error; err != nil {
			t.Fatal(err)
		}
		before := len(deletes)
		cleanupProductionRenderUploads()
		if len(deletes) != before || objects["/"+provider.Bucket+"/"+object.ObjectKey] != "mp4!" || count(t, &model.StorageObject{}, "id = ?", object.ID) != 1 || count(t, &model.ProductionRenderUpload{}, "id = ?", row.ID) != 0 {
			t.Fatal("missing owner allowed cleanup of an indexed file")
		}
	})
	t.Run("late PUT tombstone survives target change and supports restoration", func(t *testing.T) {
		isolated := provider
		isolated.ID = "relocated-r2"
		settings.Private.Storage.Providers = append(settings.Private.Storage.Providers, isolated)
		if _, err := repository.SaveSettings(settings, now()); err != nil {
			t.Fatal(err)
		}
		job, ctx := newJob(t, "relocated")
		job.ProviderID = isolated.ID
		if err := db.Model(&job).Update("provider_id", job.ProviderID).Error; err != nil {
			t.Fatal(err)
		}
		var oldPath string
		onPut = func(request *http.Request) {
			oldPath = request.URL.Path
			if err := repository.ActionProductionRender(job.UserID, job.ID, "cancel", now(), nil); err != nil {
				t.Fatal(err)
			}
			makeDue(t, job.WorkerID)
			cleanupProductionRenderUploads()
			objects[oldPath] = "late upload"
		}
		if err := persistProductionRender(ctx, job, filename); !errors.Is(err, repository.ErrProductionRenderStopped) {
			t.Fatalf("cancelled relocated upload committed: %v", err)
		}
		onPut = nil
		row := journal(t, job)
		if row.State != "cleaned" {
			t.Fatal("cleanup tombstone was not retained")
		}
		moved := settings
		moved.Private.Storage.Providers = append([]model.StorageProvider(nil), settings.Private.Storage.Providers...)
		moved.Private.Storage.Providers[len(moved.Private.Storage.Providers)-1].Bucket = "relocated-bucket"
		if _, err := repository.SaveSettings(moved, now()); err != nil {
			t.Fatalf("cleaned tombstone blocked changing unused target: %v", err)
		}
		newPath := "/relocated-bucket/" + row.ObjectKey
		objects[newPath] = "other bucket file"
		before := len(deletes)
		makeDue(t, row.ID)
		cleanupProductionRenderUploads()
		if len(deletes) != before || objects[oldPath] != "late upload" || objects[newPath] != "other bucket file" {
			t.Fatal("late tombstone targeted relocated bucket")
		}
		if _, err := repository.SaveSettings(settings, now()); err != nil {
			t.Fatalf("old tombstone blocked restoring original target: %v", err)
		}
		makeDue(t, row.ID)
		cleanupProductionRenderUploads()
		if objects[oldPath] != "" || objects[newPath] != "other bucket file" {
			t.Fatal("restored target cleanup touched unrelated data")
		}
	})
}
