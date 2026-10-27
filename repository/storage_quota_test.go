package repository

import (
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
)

func storageQuotaTestDatabase(t *testing.T, dsn string) *gorm.DB {
	t.Helper()
	database, err := gorm.Open(dialector("sqlite", dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	connection, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection.SetMaxOpenConns(8)
	t.Cleanup(func() { _ = connection.Close() })
	if err := database.AutoMigrate(&model.User{}, &model.StorageObject{}, &model.StorageUploadReservation{}); err != nil {
		t.Fatal(err)
	}
	return database
}

func TestStorageQuotaReservationsAcrossDatabaseConnections(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "quota.db") + "?_txlock=immediate&_pragma=journal_mode(WAL)&_pragma=busy_timeout(10000)"
	first := storageQuotaTestDatabase(t, dsn)
	second := storageQuotaTestDatabase(t, dsn)
	user := model.User{ID: "quota-user", Username: "quota-user", AffCode: "quota-user"}
	if err := first.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	var group sync.WaitGroup
	var successful atomic.Int64
	start := make(chan struct{})
	current := time.Now().Unix()
	for i := 0; i < 20; i++ {
		group.Add(1)
		go func(i int) {
			defer group.Done()
			<-start
			database := []*gorm.DB{first, second}[i%2]
			id := fmt.Sprintf("upload-%d", i)
			reservation := model.StorageUploadReservation{ID: id, UserID: user.ID, Bytes: 6, ExpiresAt: current + 1800}
			if err := reserveUserStorageUpload(database, reservation, 50, current); err != nil {
				if !errors.Is(err, ErrStorageQuotaExceeded) {
					t.Errorf("reserve upload: %v", err)
				}
				return
			}
			defer releaseUserStorageUpload(database, id, user.ID)
			object := model.StorageObject{ID: id, CreatedBy: user.ID, ObjectKey: id, ProviderID: fmt.Sprintf("provider-%d", i%2), Bytes: 6}
			if err := commitUserStorageUpload(database, id, object, 50, current); err != nil {
				t.Errorf("commit upload: %v", err)
				return
			}
			successful.Add(1)
		}(i)
	}
	close(start)
	group.Wait()
	usage, err := userStorageUsage(first, user, 50)
	if err != nil || successful.Load() != 8 || usage.UsedBytes != 48 || usage.RemainingBytes != 2 {
		t.Fatalf("concurrent quota: count=%d usage=%+v err=%v", successful.Load(), usage, err)
	}
	var pending int64
	if err := first.Model(&model.StorageUploadReservation{}).Count(&pending).Error; err != nil || pending != 0 {
		t.Fatalf("pending reservations=%d err=%v", pending, err)
	}
}

func TestStorageQuotaRechecksLimitsAndReleasesFailedReservations(t *testing.T) {
	database := storageQuotaTestDatabase(t, filepath.Join(t.TempDir(), "quota.db")+"?_txlock=immediate")
	user := model.User{ID: "owner", Username: "owner", AffCode: "owner", StorageExtraBytes: 10}
	other := model.User{ID: "other", Username: "other", AffCode: "other"}
	if err := database.Create(&[]model.User{user, other}).Error; err != nil {
		t.Fatal(err)
	}
	objects := []model.StorageObject{
		{ID: "local", ProviderID: "storage-local", ObjectKey: "local", CreatedBy: user.ID, Bytes: 40},
		{ID: "r2", ProviderID: "r2", ObjectKey: "r2", CreatedBy: user.ID, Bytes: 20},
		{ID: "other-file", ProviderID: "r2", ObjectKey: "other", CreatedBy: other.ID, Bytes: 999},
	}
	if err := database.Create(&objects).Error; err != nil {
		t.Fatal(err)
	}
	usage, err := userStorageUsage(database, user, 90)
	if err != nil || usage.UsedBytes != 60 || usage.LimitBytes != 100 || usage.RemainingBytes != 40 || usage.ExtraBytes != 10 {
		t.Fatalf("cross-provider usage=%+v err=%v", usage, err)
	}
	current := time.Now().Unix()
	reservation := model.StorageUploadReservation{ID: "reserved", UserID: user.ID, Bytes: 30, ExpiresAt: current + 1800}
	if err := reserveUserStorageUpload(database, reservation, 90, current); err != nil {
		t.Fatal(err)
	}
	blocked := model.StorageUploadReservation{ID: "blocked", UserID: user.ID, Bytes: 20, ExpiresAt: current + 1800}
	if err := reserveUserStorageUpload(database, blocked, 90, current); !errors.Is(err, ErrStorageQuotaExceeded) {
		t.Fatalf("pending upload was not counted: %v", err)
	}
	object := model.StorageObject{ID: "new", ObjectKey: "new", ProviderID: "r2", CreatedBy: user.ID, Bytes: 30}
	if err := commitUserStorageUpload(database, reservation.ID, object, 70, current); !errors.Is(err, ErrStorageQuotaExceeded) {
		t.Fatalf("lowered quota was ignored: %v", err)
	}
	if err := releaseUserStorageUpload(database, reservation.ID, other.ID); err != nil {
		t.Fatal(err)
	}
	if err := reserveUserStorageUpload(database, blocked, 90, current); !errors.Is(err, ErrStorageQuotaExceeded) {
		t.Fatalf("another account released the reservation: %v", err)
	}
	if err := releaseUserStorageUpload(database, reservation.ID, user.ID); err != nil {
		t.Fatal(err)
	}
	if err := reserveUserStorageUpload(database, blocked, 90, current); err != nil {
		t.Fatalf("failed upload did not release quota: %v", err)
	}
	object.ID, object.ObjectKey, object.Bytes = blocked.ID, blocked.ID, blocked.Bytes
	if err := commitUserStorageUpload(database, blocked.ID, object, 90, current); err != nil {
		t.Fatalf("own reservation was counted twice: %v", err)
	}
	if err := commitUserStorageUpload(database, blocked.ID, object, 90, current); !errors.Is(err, ErrStorageReservationExpired) {
		t.Fatalf("reservation was reused: %v", err)
	}
	if err := database.Delete(&model.StorageObject{}, "id = ?", "local").Error; err != nil {
		t.Fatal(err)
	}
	usage, err = userStorageUsage(database, user, 90)
	if err != nil || usage.UsedBytes != 40 || usage.RemainingBytes != 60 {
		t.Fatalf("deleting did not release real usage: %+v %v", usage, err)
	}
	usage, err = userStorageUsage(database, user, 10)
	if err != nil || !usage.OverLimit || usage.RemainingBytes != 0 || usage.UsedBytes != 40 {
		t.Fatalf("lowered quota should retain existing files: %+v %v", usage, err)
	}
}

func TestStorageQuotaExpiredReservationCannotCommit(t *testing.T) {
	database := storageQuotaTestDatabase(t, filepath.Join(t.TempDir(), "quota.db")+"?_txlock=immediate")
	user := model.User{ID: "owner", Username: "owner", AffCode: "owner"}
	if err := database.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	current := time.Now().Unix()
	old := model.StorageUploadReservation{ID: "old", UserID: user.ID, Bytes: 10, ExpiresAt: current + 1}
	if err := reserveUserStorageUpload(database, old, 10, current); err != nil {
		t.Fatal(err)
	}
	object := model.StorageObject{ID: "old-file", ObjectKey: "old-file", CreatedBy: user.ID, Bytes: 10}
	if err := commitUserStorageUpload(database, old.ID, object, 10, current+2); !errors.Is(err, ErrStorageReservationExpired) {
		t.Fatalf("expired upload was finalized: %v", err)
	}
	fresh := model.StorageUploadReservation{ID: "fresh", UserID: user.ID, Bytes: 10, ExpiresAt: current + 1800}
	if err := reserveUserStorageUpload(database, fresh, 10, current+2); err != nil {
		t.Fatalf("expired quota was not reclaimed: %v", err)
	}
	var oldCount int64
	if err := database.Model(&model.StorageUploadReservation{}).Where("id = ?", old.ID).Count(&oldCount).Error; err != nil || oldCount != 0 {
		t.Fatalf("expired reservation not cleaned: %d %v", oldCount, err)
	}
}
