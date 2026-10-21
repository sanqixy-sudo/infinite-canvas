package repository

import (
	"github.com/tigerowo/infinite-canvas/model"
)

// SaveStorageObject 保存存储对象记录。
func SaveStorageObject(object model.StorageObject) (model.StorageObject, error) {
	db, err := DB()
	if err != nil {
		return model.StorageObject{}, err
	}
	return object, db.Save(&object).Error
}

// GetStorageObject 根据 ID 获取存储对象。
func GetStorageObject(id string) (model.StorageObject, error) {
	db, err := DB()
	if err != nil {
		return model.StorageObject{}, err
	}
	var object model.StorageObject
	err = db.First(&object, "id = ?", id).Error
	return object, err
}

func CountStorageObjectsForProvider(providerID string) (int64, error) {
	db, err := DB()
	if err != nil {
		return 0, err
	}
	var count int64
	err = db.Model(&model.StorageObject{}).Where("provider_id = ?", providerID).Count(&count).Error
	return count, err
}

func StorageBytesForProvider(providerID string) (int64, error) {
	db, err := DB()
	if err != nil {
		return 0, err
	}
	var bytes int64
	err = db.Model(&model.StorageObject{}).Where("provider_id = ?", providerID).Select("COALESCE(SUM(bytes), 0)").Scan(&bytes).Error
	return bytes, err
}

// DeleteStorageObjectRecord 删除存储对象记录（软删除）。
func DeleteStorageObjectRecord(id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Delete(&model.StorageObject{}, "id = ?", id).Error
}
