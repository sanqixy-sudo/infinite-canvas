package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

type UserConfigPayload struct {
	ModelConfig      json.RawMessage       `json:"modelConfig,omitempty"`
	StorageProvider  *UserStorageProviders `json:"storageProvider,omitempty"`
	ImageHistory     json.RawMessage       `json:"imageHistory,omitempty"`
	AssetData        json.RawMessage       `json:"assetData,omitempty"`
	SyncCapabilities map[string]bool       `json:"syncCapabilities,omitempty"`
}

type StorageObjectProviderInput struct {
	Enabled         *bool  `json:"enabled,omitempty"`
	Name            string `json:"name"`
	Type            string `json:"type"`
	Endpoint        string `json:"endpoint"`
	Region          string `json:"region"`
	Bucket          string `json:"bucket"`
	AccessKeyID     string `json:"accessKeyId"`
	SecretAccessKey string `json:"secretAccessKey"`
	PublicBaseURL   string `json:"publicBaseUrl"`
	PathPrefix      string `json:"pathPrefix"`
	Username        string `json:"username"`
	Password        string `json:"password"`
}

type UserStorageProviders struct {
	S3     *StorageObjectProviderInput `json:"s3,omitempty"`
	WebDAV *StorageObjectProviderInput `json:"webdav,omitempty"`
}

var ErrPersonalModelChannelDisabled = safeMessageError{message: "仅支持平台云端模型"}

var privateModelConfigKeys = []string{"localChannels", "workflowChannels", "channelTranslations", "apiKey", "baseUrl", "publicChannels"}

func SelectUserLocalModelChannelForModel(userID string, modelName string, channelID string) (model.ModelChannel, error) {
	return model.ModelChannel{}, ErrPersonalModelChannelDisabled
}

func publicUserModelConfig(raw string) json.RawMessage {
	var config map[string]json.RawMessage
	if json.Unmarshal([]byte(raw), &config) != nil || config == nil {
		return nil
	}
	for _, key := range privateModelConfigKeys {
		delete(config, key)
	}
	for _, key := range []string{"imageWorkflowRef", "videoWorkflowRef", "audioWorkflowRef"} {
		var ref WorkflowRef
		if json.Unmarshal(config[key], &ref) == nil && ref.Scope != "system" {
			delete(config, key)
		}
	}
	config["channelMode"] = json.RawMessage(`"remote"`)
	result, _ := json.Marshal(config)
	return result
}

func CurrentUserConfig(ctx context.Context) (UserConfigPayload, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return UserConfigPayload{}, errors.New("请先登录")
	}
	config, ok, err := repository.GetUserConfig(user.ID)
	if err != nil {
		return UserConfigPayload{}, err
	}
	result := UserConfigPayload{
		SyncCapabilities: map[string]bool{
			"userData":  true,
			"workflows": true,
			"assets":    true,
		},
	}
	if !ok {
		return result, nil
	}
	if strings.TrimSpace(config.ModelConfig) != "" {
		result.ModelConfig = publicUserModelConfig(config.ModelConfig)
	}
	if strings.TrimSpace(config.StorageProvider) != "" {
		providers := readUserStorageProviders(config.StorageProvider)
		var syncFlags struct {
			SyncStorageConfig       bool `json:"syncStorageConfig"`
			SyncWebDAVStorageConfig bool `json:"syncWebDAVStorageConfig"`
		}
		_ = json.Unmarshal(result.ModelConfig, &syncFlags)
		if !syncFlags.SyncStorageConfig {
			providers.S3 = nil
		}
		if !syncFlags.SyncWebDAVStorageConfig {
			providers.WebDAV = nil
		}
		if providers.S3 != nil || providers.WebDAV != nil {
			result.StorageProvider = &providers
		}
	}
	if strings.TrimSpace(config.ImageHistory) != "" {
		result.ImageHistory = json.RawMessage(config.ImageHistory)
	}
	if strings.TrimSpace(config.AssetData) != "" {
		result.AssetData = json.RawMessage(config.AssetData)
	}
	return result, nil
}

func readUserStorageProviders(raw string) UserStorageProviders {
	var providers UserStorageProviders
	if strings.TrimSpace(raw) != "" {
		_ = json.Unmarshal([]byte(raw), &providers)
	}
	return providers
}

func SaveCurrentUserModelConfig(ctx context.Context, raw json.RawMessage) (UserConfigPayload, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return UserConfigPayload{}, errors.New("请先登录")
	}
	var incoming map[string]json.RawMessage
	if json.Unmarshal(raw, &incoming) != nil || incoming == nil {
		return UserConfigPayload{}, errors.New("模型配置格式错误")
	}
	for _, key := range []string{"imageWorkflowRef", "videoWorkflowRef", "audioWorkflowRef"} {
		var ref WorkflowRef
		if value, exists := incoming[key]; exists && string(value) != "null" && (json.Unmarshal(value, &ref) != nil || ref.Scope != "system") {
			return UserConfigPayload{}, ErrPersonalModelChannelDisabled
		}
	}
	for _, key := range privateModelConfigKeys {
		if _, supplied := incoming[key]; supplied {
			return UserConfigPayload{}, ErrPersonalModelChannelDisabled
		}
	}
	_, err := repository.PatchUserConfig(user.ID, now(), func(config *model.UserConfig) error {
		saved, err := userModelPreferenceMap(config.ModelConfig)
		if err != nil { return err }
		for _, key := range privateModelConfigKeys { if value, exists := saved[key]; exists { incoming[key] = value } }
		incoming["channelMode"] = json.RawMessage(`"remote"`)
		incoming["autoSaveAssetsToCloud"], _ = json.Marshal(storagePreferencesFromMap(saved).AutoSaveAssetsToCloud)
		value, err := json.Marshal(incoming)
		if err == nil { config.ModelConfig = string(value) }
		return err
	})
	if err != nil {
		return UserConfigPayload{}, err
	}
	return CurrentUserConfig(ctx)
}

func CurrentUserImageHistory(ctx context.Context) (json.RawMessage, error) {
	config, err := currentUserConfig(ctx)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(config.ImageHistory) == "" {
		return json.RawMessage(`{"logs":[],"categories":[]}`), nil
	}
	return json.RawMessage(config.ImageHistory), nil
}

func SaveCurrentUserImageHistory(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
	config, err := saveCurrentUserConfigField(ctx, func(config *model.UserConfig) {
		config.ImageHistory = string(raw)
	})
	if err != nil {
		return nil, err
	}
	return json.RawMessage(config.ImageHistory), nil
}

func CurrentUserAssetData(ctx context.Context) (json.RawMessage, error) {
	config, err := currentUserConfig(ctx)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(config.AssetData) == "" {
		return json.RawMessage(`{"assets":[]}`), nil
	}
	return json.RawMessage(config.AssetData), nil
}

func SaveCurrentUserAssetData(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
	return nil, safeMessageError{message: "素材列表批量覆盖已停用，请使用单条素材接口"}
}

func currentUserConfig(ctx context.Context) (model.UserConfig, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return model.UserConfig{}, errors.New("请先登录")
	}
	config, _, err := repository.GetUserConfig(user.ID)
	if err != nil {
		return model.UserConfig{}, err
	}
	if config.UserID == "" {
		config.UserID = user.ID
	}
	return config, nil
}

func saveCurrentUserConfigField(ctx context.Context, patch func(config *model.UserConfig)) (model.UserConfig, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return model.UserConfig{}, errors.New("请先登录")
	}
	return repository.PatchUserConfig(user.ID, now(), func(config *model.UserConfig) error { patch(config); return nil })
}
