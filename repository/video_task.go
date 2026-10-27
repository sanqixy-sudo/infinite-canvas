package repository

import (
	"errors"
	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrVideoTaskOriginConflict = errors.New("同一任务标识不能用于不同画布或节点")

func SaveFailedTranslatedVideoTask(task model.VideoTask, refundLog model.CreditLog) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		updated := tx.Model(&model.VideoTask{}).Where("id = ? AND status NOT IN ?", task.ID, []string{"completed", "failed", "cancelled", "canceled"}).Select("*").Updates(&task)
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected == 0 { return nil }
		if refundLog.Amount <= 0 {
			return captureProductionTask(tx, &task, false)
		}
		user, found, err := refundUserCredits(tx, task.UserID, refundLog.Amount, refundLog.CreatedAt)
		if err != nil {
			return err
		}
		if !found {
			return gorm.ErrRecordNotFound
		}
		refundLog.Balance = user.Credits
		refundLog.RelatedID = "video:" + task.ID
		if err := tx.Create(&refundLog).Error; err != nil { return err }
		return captureProductionTask(tx, &task, false)
	})
}

func SaveVideoTask(task model.VideoTask, storageIDs ...string) (model.VideoTask, error) {
	db, err := DB()
	if err != nil {
		return task, err
	}
	err = withUserStorageLock(db, task.UserID, storageIDs, func(tx *gorm.DB) error {
		var writeErr error
		task, writeErr = saveVideoTask(tx, task)
		return writeErr
	})
	return task, err
}

func saveVideoTask(db *gorm.DB, task model.VideoTask) (model.VideoTask, error) {
	var count int64
	if err := db.Model(&model.VideoTask{}).Where("id = ?", task.ID).Count(&count).Error; err != nil { return task, err }
	if count == 0 { if err := rejectProductionTaskReplay(db, task.UserID, task.ID); err != nil { return task, err } }
	insert := db.Clauses(clause.OnConflict{DoNothing: true}).Create(&task)
	if insert.Error != nil {
		return task, insert.Error
	}
	var existing model.VideoTask
	if err := db.First(&existing, "user_id = ? AND id = ?", task.UserID, task.ID).Error; err != nil { return task, err }
	if existing.Status == "cancelled" { return existing, nil }
	if existing.Source != task.Source || existing.SourceID != task.SourceID || existing.CanvasID != task.CanvasID { return task, ErrVideoTaskOriginConflict }
	if task.SubmissionHash == "" { task.SubmissionHash = existing.SubmissionHash }
	update := db.Model(&model.VideoTask{}).Where("user_id = ? AND id = ? AND status <> ?", task.UserID, task.ID, "cancelled").Select("*").Updates(&task)
	if update.Error == nil && update.RowsAffected == 0 {
		update = db.First(&task, "user_id = ? AND id = ?", task.UserID, task.ID)
	}
	if update.Error != nil { return task, update.Error }
	return task, captureProductionTask(db, &task, insert.RowsAffected > 0)
}

func PrepareCanvasVideoSubmission(task model.VideoTask) (model.VideoTask, bool, error) {
	db, err := DB(); if err != nil { return task, false, err }
	created := false
	err = withUserStorageLock(db, task.UserID, nil, func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&model.VideoTask{}).Where("id = ?", task.ID).Count(&count).Error; err != nil { return err }
		if count == 0 { if err := rejectProductionTaskReplay(tx, task.UserID, task.ID); err != nil { return err } }
		insert := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&task)
		if insert.Error != nil { return insert.Error }
		if insert.RowsAffected == 0 {
			var old model.VideoTask
			if err := tx.Where("user_id = ? AND id = ?", task.UserID, task.ID).First(&old).Error; err != nil { return err }
			if old.SubmissionHash != task.SubmissionHash { return ErrVideoTaskOriginConflict }
			task = old; return nil
		}
		created = true
		return captureProductionTask(tx, &task, true)
	})
	return task, created, err
}

func MarkUncertainVideoSubmission(userID, id, stamp string) error {
	db, err := DB(); if err != nil { return err }
	return db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.VideoTask{}).Where("user_id = ? AND id = ? AND status = 'submitting'", userID, id).Updates(map[string]any{"status": "unknown", "updated_at": stamp})
		if result.Error != nil || result.RowsAffected == 0 { return result.Error }
		return RefreshProductionTask(tx, "video", userID, id)
	})
}

func UpdateVideoTask(task model.VideoTask, storageIDs ...string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return withUserStorageLock(db, task.UserID, storageIDs, func(tx *gorm.DB) error {
		result := tx.Model(&model.VideoTask{}).
			Where("id = ? AND status <> ?", task.ID, "cancelled").
			Select("*").Updates(&task)
		if result.Error != nil { return result.Error }
		return RefreshProductionTask(tx, "video", task.UserID, task.ID)
	})
}

func GetVideoTask(id string) (model.VideoTask, bool, error) {
	db, err := DB()
	if err != nil {
		return model.VideoTask{}, false, err
	}
	var task model.VideoTask
	err = db.First(&task, "id = ?", id).Error
	if err != nil {
		return model.VideoTask{}, false, nil
	}
	return task, true, nil
}

func GetUserVideoTask(userID string, id string) (model.VideoTask, bool, error) {
	db, err := DB()
	if err != nil {
		return model.VideoTask{}, false, err
	}
	var task model.VideoTask
	err = db.First(&task, "user_id = ? AND (id = ? OR upstream_task_id = ? OR upstream_video_id = ?)", userID, id, id, id).Error
	if err != nil {
		return model.VideoTask{}, false, nil
	}
	return task, true, nil
}

func ListUserVideoTasks(userID string, source string, limit int) ([]model.VideoTask, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 100
	}
	var tasks []model.VideoTask
	query := db.Where("user_id = ?", userID)
	if source != "" {
		if source == "video-workbench" {
			query = query.Where("(source = ? OR source = '' OR source IS NULL)", source)
		} else {
			query = query.Where("source = ?", source)
		}
	}
	err = query.
		Where("status IN ?", []string{"queued", "in_progress", "processing", "running"}).
		Order("created_at DESC").
		Limit(limit).
		Find(&tasks).Error
	return tasks, err
}

func DeleteUserVideoTask(userID string, id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Where("user_id = ? AND (id = ? OR upstream_task_id = ? OR upstream_video_id = ?)", userID, id, id, id).Delete(&model.VideoTask{}).Error
}

func ListDueVideoTasks(limit int) ([]model.VideoTask, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 100
	}
	var tasks []model.VideoTask
	err = db.Where("(status IN ? OR billing_status IN ?)", []string{"queued", "in_progress", "processing", "running", "unknown"}, []string{"reserved", "pending_usage", "pending_balance"}).Where("(workflow_ref = '' OR workflow_ref IS NULL)").
		Where("status <> 'unknown' OR gateway_snapshot <> '' OR upstream_task_id <> '' OR upstream_video_id <> ''").
		Order("COALESCE(last_polled_at, '') ASC, created_at ASC").
		Limit(limit).
		Find(&tasks).Error
	return tasks, err
}

func DeleteFinishedVideoTasksBefore(before string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.
		Where("gateway_snapshot = '' OR gateway_snapshot IS NULL").
		Where("completed_at <> ? AND completed_at < ?", "", before).
		Where("status IN ?", []string{"completed", "failed", "cancelled", "canceled"}).
		Delete(&model.VideoTask{}).Error
}
