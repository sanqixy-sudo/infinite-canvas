package service

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

type UserStoragePreferences struct {
	AutoSaveAssetsToCloud bool `json:"autoSaveAssetsToCloud"`
}

func CurrentUserStoragePreferences(ctx context.Context) (UserStoragePreferences, error) {
	user, err := accountDataUser(ctx)
	if err != nil { return UserStoragePreferences{}, err }
	config, _, err := repository.GetUserConfig(user.ID)
	if err != nil { return UserStoragePreferences{}, err }
	values, err := userModelPreferenceMap(config.ModelConfig)
	if err != nil { return UserStoragePreferences{}, err }
	return storagePreferencesFromMap(values), nil
}

func SaveCurrentUserStoragePreferences(ctx context.Context, autoSave bool) (UserStoragePreferences, error) {
	user, err := accountDataUser(ctx)
	if err != nil { return UserStoragePreferences{}, err }
	_, err = repository.PatchUserConfig(user.ID, now(), func(config *model.UserConfig) error {
		values, err := userModelPreferenceMap(config.ModelConfig)
		if err != nil { return err }
		values["autoSaveAssetsToCloud"], _ = json.Marshal(autoSave)
		raw, err := json.Marshal(values)
		if err == nil { config.ModelConfig = string(raw) }
		return err
	})
	return UserStoragePreferences{AutoSaveAssetsToCloud: autoSave}, err
}

func userModelPreferenceMap(raw string) (map[string]json.RawMessage, error) {
	values := map[string]json.RawMessage{}
	if strings.TrimSpace(raw) != "" && json.Unmarshal([]byte(raw), &values) != nil { return nil, safeMessageError{message: "账号偏好数据无效，未修改原数据"} }
	if values == nil { values = map[string]json.RawMessage{} }
	return values, nil
}

func storagePreferencesFromMap(values map[string]json.RawMessage) UserStoragePreferences {
	var result UserStoragePreferences
	_ = json.Unmarshal(values["autoSaveAssetsToCloud"], &result.AutoSaveAssetsToCloud)
	return result
}

func accountDataUser(ctx context.Context) (model.AuthUser, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" || user.Role == model.UserRoleGuest { return model.AuthUser{}, safeMessageError{message: "请先登录"} }
	return user, nil
}
