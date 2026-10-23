package repository

import (
	"errors"
	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func PrepareProductionRenderUpload(job model.ProductionRenderJob,upload model.ProductionRenderUpload,currentTime int64)error{
	db,err:=DB();if err!=nil{return err}
	return withUserStorageLock(db,job.UserID,nil,func(tx *gorm.DB)error{
		var lease model.ProductionRenderLease
		if err:=tx.Clauses(clause.Locking{Strength:"UPDATE"}).Where("id = ? AND worker_id = ? AND expires_at > ?","renderer",job.WorkerID,currentTime).First(&lease).Error;err!=nil{return ErrProductionRenderStopped}
		var count int64;if err:=tx.Model(&model.ProductionRenderJob{}).Where("id = ? AND worker_id = ? AND status = ?",job.ID,job.WorkerID,"running").Count(&count).Error;err!=nil{return err};if count!=1{return ErrProductionRenderStopped}
		return tx.Create(&upload).Error
	})
}

func DueProductionRenderUploads(currentTime int64)([]model.ProductionRenderUpload,error){db,err:=DB();if err!=nil{return nil,err};rows:=[]model.ProductionRenderUpload{};err=db.Where("next_check_at <= ?",currentTime).Order("next_check_at, id").Limit(25).Find(&rows).Error;return rows,err}

// The owner lock and cleaning state prevent an old worker committing after cleanup starts.
func ClaimProductionRenderCleanup(upload model.ProductionRenderUpload,currentTime,nextCheck int64)(bool,error){
	db,err:=DB();if err!=nil{return false,err};claimed:=false
	err=withUserStorageLock(db,upload.UserID,nil,func(tx *gorm.DB)error{
		var current model.ProductionRenderUpload
		if err:=tx.Clauses(clause.Locking{Strength:"UPDATE"}).Where("id = ? AND next_check_at <= ?",upload.ID,currentTime).First(&current).Error;errors.Is(err,gorm.ErrRecordNotFound){return nil}else if err!=nil{return err}
		var indexed int64;if err:=tx.Model(&model.StorageObject{}).Where("provider_id = ? AND object_key = ?",current.ProviderID,current.ObjectKey).Count(&indexed).Error;err!=nil{return err};if indexed>0{return tx.Delete(&current).Error}
		var active int64
		if err:=tx.Table("production_render_jobs").Joins("JOIN production_render_leases ON production_render_leases.worker_id = production_render_jobs.worker_id").Where("production_render_jobs.id = ? AND production_render_jobs.worker_id = ? AND production_render_jobs.status = 'running' AND production_render_leases.expires_at > ?",current.JobID,current.ID,currentTime).Count(&active).Error;err!=nil{return err}
		if active>0{return tx.Model(&current).Update("next_check_at",nextCheck).Error}
		claimed=true;return tx.Model(&current).Updates(map[string]any{"state":"cleaning","next_check_at":nextCheck}).Error
	});return claimed,err
}

func FinishProductionRenderCleanup(id string)error{db,err:=DB();if err!=nil{return err};return db.Model(&model.ProductionRenderUpload{}).Where("id = ? AND state = ?",id,"cleaning").Update("state","cleaned").Error}
