package repository

import (
	"encoding/json"
	"errors"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Rendering locks this same row before registering an upload or its resulting file.
func lockPrivateSettings(tx *gorm.DB) (model.PrivateSetting, error) {
	row := model.Setting{Key: model.SettingKeyPrivate, Value: json.RawMessage(`{}`)}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
		return model.PrivateSetting{}, err
	}
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(map[string]any{"key": model.SettingKeyPrivate}).First(&row).Error; err != nil {
		return model.PrivateSetting{}, err
	}
	var settings model.PrivateSetting
	err := json.Unmarshal(row.Value, &settings)
	return settings, err
}

func protectStorageDestinations(tx *gorm.DB, saved, incoming model.PrivateStorageSetting) error {
	for _, old := range saved.Providers {
		unchanged := false
		for _, next := range incoming.Providers {
			if model.ProductionRenderProviderIdentity(old, "") == model.ProductionRenderProviderIdentity(next, "") {
				unchanged = true
				break
			}
		}
		if unchanged {
			continue
		}
		var files, uploads int64
		if err := tx.Model(&model.StorageObject{}).Where("provider_id = ? AND (delete_completed_at = '' OR delete_completed_at IS NULL)", old.ID).Count(&files).Error; err != nil {
			return err
		}
		// A tombstone for a previous destination must not block restoring that destination.
		if err := tx.Model(&model.ProductionRenderUpload{}).Where("provider_id = ? AND provider_identity = ? AND state IN ?", old.ID, model.ProductionRenderProviderIdentity(old, ""), []string{"pending", "cleaning"}).Count(&uploads).Error; err != nil {
			return err
		}
		if files > 0 || uploads > 0 {
			return errors.New("该存储仍有文件或未完成的成片上传，请保留地址和存储桶；可以停用上传或更新凭据")
		}
	}
	return nil
}

// GetSettings 返回 public 和 private 两行配置。
func GetSettings() (model.Settings, error) {
	db, err := DB()
	if err != nil {
		return model.Settings{}, err
	}
	var items []model.Setting
	if err := db.Find(&items).Error; err != nil {
		return model.Settings{}, err
	}
	result := model.Settings{}
	for _, item := range items {
		if item.Key == model.SettingKeyPrivate {
			_ = json.Unmarshal(item.Value, &result.Private)
		} else if item.Key == model.SettingKeyPublic {
			_ = json.Unmarshal(item.Value, &result.Public)
		}
	}
	return result, nil
}

// SaveSettings 保存 public 和 private 两行配置。
func SaveSettings(settings model.Settings, now string) (model.Settings, error) {
	db, err := DB()
	if err != nil {
		return settings, err
	}
	publicValue, _ := json.Marshal(settings.Public)
	privateValue, _ := json.Marshal(settings.Private)
	items := []model.Setting{
		{Key: model.SettingKeyPublic, Value: publicValue, CreatedAt: now, UpdatedAt: now},
		{Key: model.SettingKeyPrivate, Value: privateValue, CreatedAt: now, UpdatedAt: now},
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		saved, err := lockPrivateSettings(tx)
		if err != nil {
			return err
		}
		if err := protectStorageDestinations(tx, saved.Storage, settings.Private.Storage); err != nil {
			return err
		}
		return tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "key"}},
			DoUpdates: clause.AssignmentColumns([]string{"value", "updated_at"}),
		}).Create(&items).Error
	})
	return settings, err
}
