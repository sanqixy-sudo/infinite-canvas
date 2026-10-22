package repository

import (
	"errors"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func userConfigTimestamp() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

func GetUserConfig(userID string) (model.UserConfig, bool, error) {
	db, err := DB()
	if err != nil {
		return model.UserConfig{}, false, err
	}

	var config model.UserConfig
	err = db.First(&config, "user_id = ?", userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.UserConfig{}, false, nil
	}
	if err != nil {
		return model.UserConfig{}, false, err
	}
	return config, true, nil
}

func SaveUserConfig(config model.UserConfig) (model.UserConfig, error) {
	db, err := DB()
	if err != nil {
		return config, err
	}

	config.UpdatedAt = userConfigTimestamp()
	return config, db.Save(&config).Error
}

// PatchUserConfig 在同一用户锁内修改最新配置，避免其他字段被旧快照覆盖。
func PatchUserConfig(userID, timestamp string, patch func(*model.UserConfig) error) (model.UserConfig, error) {
	return PatchUserConfigWithStorage(userID, timestamp, "", func(config *model.UserConfig, _ *model.StorageObject) error { return patch(config) })
}

// PatchUserConfigWithStorage 同时读取当前用户拥有的文件索引，供素材保存校验。
func PatchUserConfigWithStorage(userID, timestamp, storageID string, patch func(*model.UserConfig, *model.StorageObject) error) (model.UserConfig, error) {
	db, err := DB()
	if err != nil { return model.UserConfig{}, err }
	return patchUserConfig(db, userID, timestamp, storageID, patch)
}

func patchUserConfig(db *gorm.DB, userID, timestamp, storageID string, patch func(*model.UserConfig, *model.StorageObject) error) (model.UserConfig, error) {
	var config model.UserConfig
	err := db.Transaction(func(tx *gorm.DB) error {
		var user model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, "id = ?", userID).Error; err != nil { return err }
		err := tx.First(&config, "user_id = ?", userID).Error
		missing := errors.Is(err, gorm.ErrRecordNotFound)
		if err != nil && !missing { return err }
		if missing { config = model.UserConfig{UserID: userID, CreatedAt: timestamp} }
		before := config
		var object *model.StorageObject
		if storageID != "" {
			object = &model.StorageObject{}
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND created_by = ? AND (deleted_at = '' OR deleted_at IS NULL)", storageID, userID).First(object).Error; err != nil { return err }
		}
		if err := patch(&config, object); err != nil { return err }
		config.UserID = userID
		if missing { config.UpdatedAt = timestamp; return tx.Create(&config).Error }
		updates := map[string]any{}
		for column, values := range map[string][2]string{"model_config": {before.ModelConfig, config.ModelConfig}, "storage_provider": {before.StorageProvider, config.StorageProvider}, "image_history": {before.ImageHistory, config.ImageHistory}, "asset_data": {before.AssetData, config.AssetData}} {
			if values[0] != values[1] { updates[column] = values[1] }
		}
		if len(updates) == 0 { return nil }
		config.UpdatedAt = timestamp
		updates["updated_at"] = timestamp
		return tx.Model(&model.UserConfig{}).Where("user_id = ?", userID).Updates(updates).Error
	})
	return config, err
}
