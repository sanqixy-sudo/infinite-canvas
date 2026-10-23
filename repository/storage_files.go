package repository

import (
	"errors"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrStorageReferenceMissing = errors.New("引用的账号文件已被删除或不可用，请移除相关引用或重新上传")
var ErrStorageFileAccessDenied = errors.New("storage file access denied")

func withUserStorageLock(db *gorm.DB, userID string, ids []string, write func(*gorm.DB) error) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var user model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, "id = ?", userID).Error; err != nil {
			return err
		}
		if err := validateStorageReferences(tx, ids); err != nil {
			return err
		}
		return write(tx)
	})
}

func withStorageReferences(db *gorm.DB, ids []string, write func(*gorm.DB) error) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if err := validateStorageReferences(tx, ids); err != nil {
			return err
		}
		return write(tx)
	})
}

func StorageIDsForPublicURLs(urls []string) ([]string, error) {
	if len(urls) == 0 {
		return nil, nil
	}
	db, err := DB()
	if err != nil {
		return nil, err
	}
	ids := []string{}
	err = db.Model(&model.StorageObject{}).Where("public_url IN ?", uniqueTrimmedValues(urls...)).Pluck("id", &ids).Error
	return ids, err
}

func validateStorageReferences(tx *gorm.DB, ids []string) error {
	ids = uniqueTrimmedValues(ids...)
	if len(ids) == 0 {
		return nil
	}
	var objects []model.StorageObject
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).Where("id IN ? AND (deleted_at = '' OR deleted_at IS NULL)", ids).Order("id").Find(&objects).Error; err != nil {
		return err
	}
	if len(objects) != len(ids) {
		return ErrStorageReferenceMissing
	}
	return nil
}

type StorageReferenceData struct {
	Config       model.UserConfig
	Projects     []model.CanvasProject
	Images       []model.ImageGenerationLog
	Videos       []model.VideoGenerationLog
	ImageTasks   []model.CanvasImageTask
	AudioTasks   []model.CanvasAudioTask
	VideoTasks   []model.VideoTask
	ProductionRenders []model.ProductionRenderJob
	ProductionReviews []model.ProductionReview
	TeamAssets []model.TeamAsset
	ProductionDelivery []ProductionDeliveryReference
	Assets       []model.Asset
	Prompts      []model.Prompt
	Skills       []model.AgentSkill
	OtherConfigs []model.UserConfig
}

type ProductionDeliveryReference struct {
	ID string
	UserID string
	Delivery *model.ProductionDeliveryEdit `gorm:"serializer:json"`
}

type StorageFileRemoval struct {
	AssetData string
	Images    []model.CanvasImageTask
	Audio     []model.CanvasAudioTask
	Videos    []model.VideoTask
}

func storageReferenceData(tx *gorm.DB, userID string) (StorageReferenceData, error) {
	data := StorageReferenceData{}
	if err := tx.First(&data.Config, "user_id = ?", userID).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return data, err
	}
	for _, query := range []struct {
		value  any
		filter string
		args   []any
	}{
		{&data.Projects, "deleted_at = ''", nil},
		{&data.Images, "deleted_at = ''", nil},
		{&data.Videos, "deleted_at = ''", nil},
		{&data.ImageTasks, "1 = 1", nil},
		{&data.AudioTasks, "1 = 1", nil},
		{&data.VideoTasks, "1 = 1", nil},
		{&data.ProductionRenders, "status IN ?", []any{[]string{"queued", "running"}}},
		{&data.ProductionReviews, "revoked_at = ''", nil},
		{&data.TeamAssets, "revoked_at = ''", nil},
		{&data.Assets, "1 = 1", nil},
		{&data.Prompts, "1 = 1", nil},
		{&data.Skills, "1 = 1", nil},
	} {
		if err := tx.Where(query.filter, query.args...).Find(query.value).Error; err != nil {
			return data, err
		}
	}
	if err := tx.Select("user_id", "asset_data", "image_history").Where("user_id <> ?", userID).Find(&data.OtherConfigs).Error; err != nil {
		return data, err
	}
	if err:=tx.Table("production_episodes").Select("production_episodes.id, production_projects.user_id, production_episodes.delivery").Joins("JOIN production_projects ON production_projects.id = production_episodes.project_id").Where("production_episodes.delivery IS NOT NULL").Find(&data.ProductionDelivery).Error;err!=nil{return data,err}
	return data, nil
}

func UserStorageFiles(userID string, q model.Query, namedStorageIDs ...string) ([]model.StorageObject, int64, StorageReferenceData, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, StorageReferenceData{}, err
	}
	q.Normalize()
	var files []model.StorageObject
	var total int64
	var data StorageReferenceData
	err = withUserStorageLock(db, userID, nil, func(tx *gorm.DB) error {
		query := tx.Model(&model.StorageObject{}).Where("created_by = ? AND (delete_completed_at = '' OR delete_completed_at IS NULL)", userID)
		if keyword := strings.TrimSpace(q.Keyword); keyword != "" {
			query = query.Where("object_key LIKE ? OR id LIKE ? OR mime_type LIKE ? OR id IN ?", "%"+keyword+"%", "%"+keyword+"%", "%"+keyword+"%", namedStorageIDs)
		}
		if q.Type == "image" || q.Type == "video" || q.Type == "audio" {
			query = query.Where("mime_type LIKE ?", q.Type+"/%")
		}
		if q.Type == "other" {
			query = query.Where("mime_type NOT LIKE 'image/%' AND mime_type NOT LIKE 'video/%' AND mime_type NOT LIKE 'audio/%'")
		}
		if err := query.Count(&total).Error; err != nil {
			return err
		}
		if err := query.Order("created_at DESC, id DESC").Offset(q.Offset()).Limit(q.PageSize).Find(&files).Error; err != nil {
			return err
		}
		data, err = storageReferenceData(tx, userID)
		return err
	})
	return files, total, data, err
}

func UserStorageFileReferences(userID, id string) (model.StorageObject, StorageReferenceData, error) {
	db, err := DB()
	if err != nil {
		return model.StorageObject{}, StorageReferenceData{}, err
	}
	var object model.StorageObject
	var data StorageReferenceData
	err = withUserStorageLock(db, userID, nil, func(tx *gorm.DB) error {
		if err := tx.First(&object, "id = ? AND created_by = ? AND (delete_completed_at = '' OR delete_completed_at IS NULL)", id, userID).Error; err != nil {
			return err
		}
		data, err = storageReferenceData(tx, userID)
		return err
	})
	return object, data, err
}

// DeleteUserStorageFile keeps the quota index until physical deletion succeeds.
func DeleteUserStorageFile(userID, id, timestamp string, prepare func(model.StorageObject, StorageReferenceData) (StorageFileRemoval, error), remove func(model.StorageObject, StorageReferenceData) error) (model.StorageFileDeletion, error) {
	db, err := DB()
	if err != nil {
		return model.StorageFileDeletion{}, err
	}
	result := model.StorageFileDeletion{DeletedID: id}
	var pending model.StorageObject
	var snapshot StorageReferenceData
	found := false
	err = withUserStorageLock(db, userID, nil, func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&pending, "id = ?", id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		if pending.CreatedBy != userID {
			return ErrStorageFileAccessDenied
		}
		if pending.DeleteCompletedAt != "" {
			return nil
		}
		snapshot, err = storageReferenceData(tx, userID)
		if err != nil {
			return err
		}
		if _, err := prepare(pending, snapshot); err != nil {
			return err
		}
		found = true
		return tx.Model(&model.StorageObject{}).Where("id = ?", id).Update("deleted_at", timestamp).Error
	})
	if err != nil || !found {
		return result, err
	}
	// A committed marker prevents new references while the external delete runs.
	// The quota index remains on failures and can be safely retried.
	if err := remove(pending, snapshot); err != nil {
		return result, err
	}
	err = withUserStorageLock(db, userID, nil, func(tx *gorm.DB) error {
		var object model.StorageObject
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&object, "id = ?", id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		if object.CreatedBy != userID {
			return ErrStorageFileAccessDenied
		}
		if object.DeleteCompletedAt != "" {
			return nil
		}
		data, err := storageReferenceData(tx, userID)
		if err != nil {
			return err
		}
		changes, err := prepare(object, data)
		if err != nil {
			return err
		}
		if changes.AssetData != data.Config.AssetData {
			if err := tx.Model(&model.UserConfig{}).Where("user_id = ?", userID).Updates(map[string]any{"asset_data": changes.AssetData, "updated_at": timestamp}).Error; err != nil {
				return err
			}
		}
		for _, task := range changes.Images {
			if err := tx.Model(&model.CanvasImageTask{}).Where("id = ? AND user_id = ?", task.ID, userID).Select("image_url", "image_urls", "storage_key").Updates(&task).Error; err != nil {
				return err
			}
		}
		for _, task := range changes.Audio {
			if err := tx.Model(&model.CanvasAudioTask{}).Where("id = ? AND user_id = ?", task.ID, userID).Updates(map[string]any{"audio_url": task.AudioURL, "storage_key": task.StorageKey}).Error; err != nil {
				return err
			}
		}
		for _, task := range changes.Videos {
			if err := tx.Model(&model.VideoTask{}).Where("id = ? AND user_id = ?", task.ID, userID).Update("video_url", task.VideoURL).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&model.StorageObject{}).Where("id = ? AND created_by = ?", id, userID).Update("delete_completed_at", timestamp).Error; err != nil {
			return err
		}
		result.FreedBytes = max(object.Bytes, 0)
		return nil
	})
	if err != nil {
		result.FreedBytes = 0
	}
	return result, err
}
