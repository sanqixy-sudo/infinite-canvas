package repository

import (
	"errors"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrStorageQuotaExceeded = errors.New("storage quota exceeded")
var ErrStorageReservationExpired = errors.New("storage reservation expired")

func UserStorageUsage(userID string, baseBytes int64) (model.StorageUsage, error) {
	db, err := DB()
	if err != nil {
		return model.StorageUsage{}, err
	}
	var user model.User
	if err := db.First(&user, "id = ?", userID).Error; err != nil {
		return model.StorageUsage{}, err
	}
	return userStorageUsage(db, user, baseBytes)
}

func userStorageUsage(tx *gorm.DB, user model.User, baseBytes int64) (model.StorageUsage, error) {
	usage := model.StorageUsage{BaseBytes: max(baseBytes, 0), ExtraBytes: max(user.StorageExtraBytes, 0)}
	const maximum = int64(^uint64(0) >> 1)
	usage.LimitBytes = maximum
	if usage.ExtraBytes <= maximum-usage.BaseBytes {
		usage.LimitBytes = usage.BaseBytes + usage.ExtraBytes
	}
	if err := tx.Model(&model.StorageObject{}).Where("created_by = ?", user.ID).
		Select("COALESCE(SUM(CASE WHEN bytes > 0 THEN bytes ELSE 0 END), 0)").Scan(&usage.UsedBytes).Error; err != nil {
		return model.StorageUsage{}, err
	}
	usage.RemainingBytes = max(usage.LimitBytes-usage.UsedBytes, 0)
	usage.OverLimit = usage.UsedBytes > usage.LimitBytes
	return usage, nil
}

func ReserveUserStorageUpload(reservation model.StorageUploadReservation, baseBytes, currentTime int64) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return reserveUserStorageUpload(db, reservation, baseBytes, currentTime)
}

func reserveUserStorageUpload(db *gorm.DB, reservation model.StorageUploadReservation, baseBytes, currentTime int64) error {
	if reservation.Bytes < 0 || reservation.ID == "" || reservation.UserID == "" || reservation.ExpiresAt <= currentTime {
		return ErrStorageQuotaExceeded
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var user model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, "id = ?", reservation.UserID).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ? AND expires_at <= ?", user.ID, currentTime).Delete(&model.StorageUploadReservation{}).Error; err != nil {
			return err
		}
		if err := checkStorageUploadQuota(tx, user, baseBytes, reservation.Bytes, currentTime, ""); err != nil {
			return err
		}
		return tx.Create(&reservation).Error
	})
}

func CommitUserStorageUpload(reservationID string, object model.StorageObject, baseBytes, currentTime int64) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return commitUserStorageUpload(db, reservationID, object, baseBytes, currentTime)
}

func commitUserStorageUpload(db *gorm.DB, reservationID string, object model.StorageObject, baseBytes, currentTime int64) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var user model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, "id = ?", object.CreatedBy).Error; err != nil {
			return err
		}
		var reservation model.StorageUploadReservation
		err := tx.First(&reservation, "id = ? AND user_id = ?", reservationID, user.ID).Error
		if errors.Is(err, gorm.ErrRecordNotFound) || err == nil && reservation.ExpiresAt <= currentTime {
			return ErrStorageReservationExpired
		}
		if err != nil {
			return err
		}
		if object.Bytes != reservation.Bytes || object.Bytes < 0 {
			return ErrStorageQuotaExceeded
		}
		if err := checkStorageUploadQuota(tx, user, baseBytes, object.Bytes, currentTime, reservation.ID); err != nil {
			return err
		}
		if err := tx.Create(&object).Error; err != nil {
			return err
		}
		return tx.Delete(&reservation).Error
	})
}

func checkStorageUploadQuota(tx *gorm.DB, user model.User, baseBytes, uploadBytes, currentTime int64, excludedReservation string) error {
	usage, err := userStorageUsage(tx, user, baseBytes)
	if err != nil {
		return err
	}
	var reserved int64
	query := tx.Model(&model.StorageUploadReservation{}).Where("user_id = ? AND expires_at > ?", user.ID, currentTime)
	if excludedReservation != "" {
		query = query.Where("id <> ?", excludedReservation)
	}
	if err := query.Select("COALESCE(SUM(bytes), 0)").Scan(&reserved).Error; err != nil {
		return err
	}
	if usage.OverLimit || uploadBytes > usage.RemainingBytes || reserved > usage.RemainingBytes-uploadBytes {
		return ErrStorageQuotaExceeded
	}
	return nil
}

func ReleaseUserStorageUpload(reservationID, userID string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return releaseUserStorageUpload(db, reservationID, userID)
}

func releaseUserStorageUpload(db *gorm.DB, reservationID, userID string) error {
	return db.Where("id = ? AND user_id = ?", reservationID, userID).Delete(&model.StorageUploadReservation{}).Error
}
