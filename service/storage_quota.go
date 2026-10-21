package service

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

func CurrentUserStorageUsage(ctx context.Context) (model.StorageUsage, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" || user.Role == model.UserRoleGuest {
		return model.StorageUsage{}, safeMessageError{message: "请先登录"}
	}
	settings, err := AccountCommerceSettings()
	if err != nil {
		return model.StorageUsage{}, err
	}
	return repository.UserStorageUsage(user.ID, settings.DefaultStorageBytes)
}

func reserveStorageUpload(ctx context.Context, bytes int64) (model.StorageUploadReservation, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" || user.Role == model.UserRoleGuest {
		return model.StorageUploadReservation{}, safeMessageError{message: "请先登录后上传文件，访客素材保存在浏览器本地"}
	}
	settings, err := AccountCommerceSettings()
	if err != nil {
		return model.StorageUploadReservation{}, err
	}
	current := time.Now()
	reservation := model.StorageUploadReservation{ID: uuid.NewString(), UserID: user.ID, Bytes: bytes, ExpiresAt: current.Add(30 * time.Minute).Unix()}
	err = repository.ReserveUserStorageUpload(reservation, settings.DefaultStorageBytes, current.Unix())
	return reservation, storageQuotaError(err)
}

func commitStorageUpload(reservation model.StorageUploadReservation, object model.StorageObject) error {
	settings, err := AccountCommerceSettings()
	if err != nil {
		return err
	}
	return storageQuotaError(repository.CommitUserStorageUpload(reservation.ID, object, settings.DefaultStorageBytes, time.Now().Unix()))
}

func releaseStorageUpload(reservation model.StorageUploadReservation) {
	if err := repository.ReleaseUserStorageUpload(reservation.ID, reservation.UserID); err != nil {
		log.Printf("release storage upload reservation failed id=%s err=%v", reservation.ID, err)
	}
}

func storageQuotaError(err error) error {
	if errors.Is(err, repository.ErrStorageQuotaExceeded) {
		return safeMessageError{message: "个人存储空间不足，请清理素材或扩容后再上传"}
	}
	if errors.Is(err, repository.ErrStorageReservationExpired) {
		return safeMessageError{message: "上传已超时，请重试"}
	}
	return err
}
