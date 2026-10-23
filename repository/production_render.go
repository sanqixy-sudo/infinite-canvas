package repository

import (
	"errors"
	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrProductionRenderConflict = errors.New("render request or revision conflict")
var ErrProductionRenderLimit = errors.New("render queue limit reached")
var ErrProductionRenderStopped = errors.New("render task is no longer running")

func CreateProductionRender(job model.ProductionRenderJob, canvasIDs, storageIDs []string, validate func([]model.CanvasProject, []model.StorageObject) error) (model.ProductionRenderJob, error) {
	db, err := DB(); if err != nil { return job, err }
	err = withUserStorageLock(db, job.UserID, storageIDs, func(tx *gorm.DB) error {
		var existing model.ProductionRenderJob
		err := tx.Where("user_id = ? AND request_id = ?", job.UserID, job.RequestID).First(&existing).Error
		if err == nil { if existing.RequestHash != job.RequestHash { return ErrProductionRenderConflict }; job = existing; return nil }
		if !errors.Is(err, gorm.ErrRecordNotFound) { return err }
		var project model.ProductionProject
		if err := tx.Where("user_id = ? AND workspace_id = ?", job.UserID, job.WorkspaceID).First(&project).Error; err != nil { return err }
		if project.Revision != job.Revision { return ErrProductionRenderConflict }
		var count int64
		if err := tx.Model(&model.ProductionRenderJob{}).Where("user_id = ? AND status IN ?", job.UserID, []string{"queued", "running"}).Count(&count).Error; err != nil { return err }
		if count >= 2 { return ErrProductionRenderLimit }
		var canvases []model.CanvasProject
		if err := tx.Where("user_id = ? AND id IN ? AND deleted_at = ''", job.UserID, canvasIDs).Find(&canvases).Error; err != nil { return err }
		var files []model.StorageObject
		if err := tx.Where("created_by = ? AND id IN ? AND (deleted_at = '' OR deleted_at IS NULL)", job.UserID, storageIDs).Find(&files).Error; err != nil { return err }
		if err := validate(canvases, files); err != nil { return err }
		return tx.Create(&job).Error
	})
	return job, err
}

func ListProductionRenders(userID, workspaceID string) ([]model.ProductionRenderJob, error) {
	db, err := DB(); if err != nil { return nil, err }
	rows := []model.ProductionRenderJob{}
	err = db.Where("user_id = ? AND workspace_id = ?", userID, workspaceID).Order("CASE WHEN status IN ('queued','running') THEN 0 ELSE 1 END, created_at DESC, id DESC").Limit(50).Find(&rows).Error
	return rows, err
}

func GetProductionRender(userID, id string) (model.ProductionRenderJob, error) {
	db, err := DB(); if err != nil { return model.ProductionRenderJob{}, err }
	var job model.ProductionRenderJob
	err = db.Where("user_id = ? AND id = ?", userID, id).First(&job).Error
	return job, err
}

func GetProductionRenderByRequest(userID, requestID string) (*model.ProductionRenderJob, error) {
	db, err := DB(); if err != nil { return nil, err }
	var job model.ProductionRenderJob
	err = db.Where("user_id = ? AND request_id = ?", userID, requestID).First(&job).Error
	if errors.Is(err,gorm.ErrRecordNotFound) { return nil,nil }; if err != nil { return nil,err }; return &job,nil
}

func ActionProductionRender(userID, id, action, stamp string, storageIDs []string) error {
	db, err := DB(); if err != nil { return err }
	return withUserStorageLock(db, userID, storageIDs, func(tx *gorm.DB) error {
		var job model.ProductionRenderJob
		if err := tx.Clauses(clause.Locking{Strength:"UPDATE"}).Where("user_id = ? AND id = ?", userID, id).First(&job).Error; err != nil { return err }
		if action == "cancel" {
			if job.Status != "queued" && job.Status != "running" { return nil }
			return tx.Model(&job).Updates(map[string]any{"status":"cancelled", "updated_at":stamp, "error":"已取消成片任务"}).Error
		}
		if job.Status != "failed" && job.Status != "cancelled" { return ErrProductionRenderStopped }
		var count int64
		if err := tx.Model(&model.ProductionRenderJob{}).Where("user_id = ? AND status IN ?", userID, []string{"queued", "running"}).Count(&count).Error; err != nil { return err }
		if count >= 2 { return ErrProductionRenderLimit }
		return tx.Model(&job).Updates(map[string]any{"status":"queued", "worker_id":"", "progress":0, "error":"", "updated_at":stamp}).Error
	})
}

func CancelProductionRenderRequest(tombstone model.ProductionRenderJob) (model.ProductionRenderJob,error) {
	db,err:=DB();if err!=nil{return tombstone,err}
	err=withUserStorageLock(db,tombstone.UserID,nil,func(tx *gorm.DB)error{
		var current model.ProductionRenderJob
		err:=tx.Clauses(clause.Locking{Strength:"UPDATE"}).Where("user_id = ? AND request_id = ?",tombstone.UserID,tombstone.RequestID).First(&current).Error
		if errors.Is(err,gorm.ErrRecordNotFound){return tx.Create(&tombstone).Error};if err!=nil{return err}
		if current.Status=="queued"||current.Status=="running"{current.Status,current.Error,current.UpdatedAt="cancelled","已取消待确认的成片提交",tombstone.UpdatedAt;if err:=tx.Save(&current).Error;err!=nil{return err}}
		tombstone=current;return nil
	});return tombstone,err
}

func ClaimProductionRender(workerID, stamp string, currentTime, expiresAt int64) (*model.ProductionRenderJob, error) {
	db, err := DB(); if err != nil { return nil, err }
	var claimed *model.ProductionRenderJob
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{DoNothing:true}).Create(&model.ProductionRenderLease{ID:"renderer"}).Error; err != nil { return err }
		lease := tx.Model(&model.ProductionRenderLease{}).Where("id = ? AND expires_at <= ?", "renderer", currentTime).Updates(map[string]any{"worker_id":workerID,"expires_at":expiresAt})
		if lease.Error != nil { return lease.Error }; if lease.RowsAffected == 0 { return nil }
		// Only an expired global lease allows recovery; another healthy replica is never interrupted.
		if err := tx.Model(&model.ProductionRenderJob{}).Where("status = ?", "running").Updates(map[string]any{"status":"failed", "error":"合成服务中断，请检查服务状态后重试", "updated_at":stamp}).Error; err != nil { return err }
		var job model.ProductionRenderJob
		queued := tx.Clauses(clause.Locking{Strength:"UPDATE"}).Where("status = ?", "queued").Order("created_at, id").Limit(1).Find(&job)
		if queued.Error != nil { return queued.Error }
		if queued.RowsAffected == 0 { return tx.Model(&model.ProductionRenderLease{}).Where("id = ? AND worker_id = ?", "renderer", workerID).Updates(map[string]any{"worker_id":"", "expires_at":0}).Error }
		job.Status, job.WorkerID, job.UpdatedAt, job.Attempts = "running", workerID, stamp, job.Attempts+1
		if err := tx.Save(&job).Error; err != nil { return err }; claimed = &job; return nil
	})
	return claimed, err
}

func UpdateProductionRender(job model.ProductionRenderJob, progress int, failure, stamp string) error {
	db, err := DB(); if err != nil { return err }
	values := map[string]any{"progress":progress, "updated_at":stamp}
	if failure != "" { values["status"], values["error"] = "failed", failure }
	result := db.Model(&model.ProductionRenderJob{}).Where("id = ? AND worker_id = ? AND status = ?", job.ID, job.WorkerID, "running").Updates(values)
	if result.Error != nil { return result.Error }; if result.RowsAffected != 1 { return ErrProductionRenderStopped }; return nil
}

func ReleaseProductionRenderLease(workerID string) error {
	db, err := DB(); if err != nil { return err }
	return db.Model(&model.ProductionRenderLease{}).Where("id = ? AND worker_id = ?", "renderer", workerID).Updates(map[string]any{"worker_id":"", "expires_at":0}).Error
}

func RenewProductionRenderLease(workerID string, currentTime, expiresAt int64) error {
	db, err := DB(); if err != nil { return err }
	result := db.Model(&model.ProductionRenderLease{}).Where("id = ? AND worker_id = ? AND expires_at > ?", "renderer", workerID, currentTime).Update("expires_at", expiresAt)
	if result.Error != nil { return result.Error }; if result.RowsAffected != 1 { return ErrProductionRenderStopped }; return nil
}

func CompleteProductionRender(job model.ProductionRenderJob, object model.StorageObject, reservationID string, baseBytes, currentTime int64, stamp string) error {
	db, err := DB(); if err != nil { return err }
	return db.Transaction(func(tx *gorm.DB) error {
		// Same order as cancellation and storage deletion: user lock before job lock.
		var user model.User
		if err := tx.Clauses(clause.Locking{Strength:"UPDATE"}).First(&user,"id = ?",job.UserID).Error; err != nil { return err }
		var lease model.ProductionRenderLease
		if err := tx.Clauses(clause.Locking{Strength:"UPDATE"}).Where("id = ? AND worker_id = ? AND expires_at > ?", "renderer", job.WorkerID, currentTime).First(&lease).Error; err != nil { return ErrProductionRenderStopped }
		var current model.ProductionRenderJob
		if err := tx.Clauses(clause.Locking{Strength:"UPDATE"}).Where("id = ? AND worker_id = ? AND status = ?", job.ID, job.WorkerID, "running").First(&current).Error; err != nil { return ErrProductionRenderStopped }
		var upload model.ProductionRenderUpload
		if err:=tx.Clauses(clause.Locking{Strength:"UPDATE"}).Where("id = ? AND job_id = ? AND state = ?",job.WorkerID,job.ID,"pending").First(&upload).Error;err!=nil{return ErrProductionRenderStopped}
		if upload.ObjectKey!=object.ObjectKey||upload.ProviderID!=object.ProviderID||upload.ReservationID!=reservationID{return ErrProductionRenderStopped}
		if err := commitUserStorageUpload(tx, reservationID, object, baseBytes, currentTime); err != nil { return err }
		if err:=tx.Delete(&upload).Error;err!=nil{return err}
		return tx.Model(&current).Updates(map[string]any{"status":"completed", "progress":100, "output_storage_key":"server:"+object.ID, "output_bytes":object.Bytes, "updated_at":stamp}).Error
	})
}
