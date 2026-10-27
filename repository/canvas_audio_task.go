package repository

import (
	"errors"
	"strings"
	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrAudioTaskConflict=errors.New("音频请求标识已用于其他参数，请查询原任务")

func EnsureCancelledAudioRequest(userID,id,stamp string)error{
	db,err:=DB();if err!=nil{return err}
	return withUserStorageLock(db,userID,nil,func(tx *gorm.DB)error{
		var previous model.CanvasAudioTask;err:=tx.Where("id = ?",id).First(&previous).Error
		if err==nil{if previous.UserID!=userID{return ErrAudioTaskConflict};return nil};if !errors.Is(err,gorm.ErrRecordNotFound){return err}
		task:=model.CanvasAudioTask{ID:id,UserID:userID,Source:"canvas",Status:"cancelled",RequestHash:"cancelled-before-submission",CreatedAt:stamp,UpdatedAt:stamp}
		result:=tx.Clauses(clause.OnConflict{DoNothing:true}).Create(&task);if result.Error!=nil{return result.Error};if result.RowsAffected!=1{return ErrAudioTaskConflict};return nil
	})
}

func SaveCanvasAudioTask(task model.CanvasAudioTask, storageIDs ...string) (model.CanvasAudioTask, error) {
	db, err := DB()
	if err != nil {
		return task, err
	}
	err = withUserStorageLock(db, task.UserID, nil, func(tx *gorm.DB) error {
		var previous model.CanvasAudioTask
		err:=tx.Where("id = ?",task.ID).First(&previous).Error
		if err==nil{if previous.UserID!=task.UserID||previous.RequestHash!=task.RequestHash{return ErrAudioTaskConflict};task=previous;return nil};if !errors.Is(err,gorm.ErrRecordNotFound){return err}
		if err:=rejectProductionTaskReplay(tx,task.UserID,task.ID);err!=nil{return err}
		if strings.HasPrefix(task.ID,"production_voice_"){
			var count int64
			if err:=tx.Table("production_shots s").Joins("JOIN production_projects p ON p.id = s.project_id").Where("p.user_id = ? AND p.workspace_id = ? AND s.id = ?",task.UserID,task.SourceID,task.NodeID).Count(&count).Error;err!=nil{return err}
			if count!=1{return ErrStorageFileAccessDenied}
		}
		if err:=validateStorageReferences(tx,storageIDs);err!=nil{return err}
		result:=tx.Clauses(clause.OnConflict{DoNothing:true}).Create(&task);if result.Error!=nil{return result.Error};if result.RowsAffected!=1{return ErrAudioTaskConflict};task.NewlyCreated=true;return captureProductionTask(tx,&task,true)
	})
	return task, err
}

func UpdateCanvasAudioTask(task model.CanvasAudioTask, storageIDs ...string) (model.CanvasAudioTask, error) {
	db, err := DB()
	if err != nil {
		return task, err
	}

	err = withUserStorageLock(db, task.UserID, storageIDs, func(tx *gorm.DB) error {
		if err:=tx.Model(&model.CanvasAudioTask{}).
			Where("user_id = ? AND id = ? AND status <> ?", task.UserID, task.ID, "cancelled").
			Select("*").
			Updates(&task).Error;err!=nil{return err}
		return RefreshProductionTask(tx,"audio",task.UserID,task.ID)
	})
	return task, err
}

func GetUserCanvasAudioTask(userID string, id string) (model.CanvasAudioTask, bool, error) {
	db, err := DB()
	if err != nil {
		return model.CanvasAudioTask{}, false, err
	}
	var task model.CanvasAudioTask
	err = db.First(&task, "user_id = ? AND id = ?", userID, id).Error
	if errors.Is(err,gorm.ErrRecordNotFound){return model.CanvasAudioTask{},false,nil};if err!=nil{return model.CanvasAudioTask{},false,err}
	return task, true, nil
}

func HasActiveCanvasAudioTasks() (bool, error) {
	db, err := DB()
	if err != nil {
		return false, err
	}
	var count int64
	err = db.Model(&model.CanvasAudioTask{}).
		Where("status IN ?", []string{"queued", "processing", "running", "in_progress"}).
		Count(&count).Error
	return count > 0, err
}

func DeleteFinishedCanvasAudioTasksBefore(before string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Where("completed_at <> ? AND completed_at < ?", "", before).
		Where("status IN ?", []string{"completed", "failed", "cancelled"}).
		Delete(&model.CanvasAudioTask{}).Error
}
