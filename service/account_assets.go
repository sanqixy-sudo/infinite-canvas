package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"gorm.io/gorm"
)

type AccountAssetData struct {
	Assets []json.RawMessage `json:"assets"`
	Folders []model.AssetFolder `json:"folders"`
}

type accountAssetIdentity struct {
	ID        string `json:"id"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
	Data      struct {
		StorageKey string `json:"storageKey"`
	} `json:"data"`
}

type accountAsset struct {
	ID        string                     `json:"id"`
	Kind      string                     `json:"kind"`
	Title     string                     `json:"title"`
	CoverURL  string                     `json:"coverUrl"`
	Tags      []string                   `json:"tags"`
	FolderIDs []string                   `json:"folderIds"`
	Category  string                     `json:"category,omitempty"`
	Source    string                     `json:"source,omitempty"`
	CreatedAt string                     `json:"createdAt"`
	UpdatedAt string                     `json:"updatedAt"`
	Metadata  map[string]json.RawMessage `json:"metadata,omitempty"`
	Data      accountAssetContent        `json:"data"`
}

type accountAssetContent struct {
	Content    string  `json:"content,omitempty"`
	DataURL    string  `json:"dataUrl,omitempty"`
	URL        string  `json:"url,omitempty"`
	StorageKey string  `json:"storageKey,omitempty"`
	Width      int     `json:"width,omitempty"`
	Height     int     `json:"height,omitempty"`
	Bytes      int64   `json:"bytes,omitempty"`
	MimeType   string  `json:"mimeType,omitempty"`
	DurationMS float64 `json:"durationMs,omitempty"`
}

func SaveCurrentUserAssetItem(ctx context.Context, raw json.RawMessage) (AccountAssetData, error) {
	user, err := accountDataUser(ctx)
	if err != nil {
		return AccountAssetData{}, err
	}
	var asset accountAsset
	if json.Unmarshal(raw, &asset) != nil {
		return AccountAssetData{}, safeMessageError{message: "素材格式无效"}
	}
	asset.ID, asset.Title = strings.TrimSpace(asset.ID), strings.TrimSpace(asset.Title)
	if asset.ID == "" || len(asset.ID) > 128 || asset.Title == "" || utf8.RuneCountInString(asset.Title) > 200 {
		return AccountAssetData{}, safeMessageError{message: "素材 ID、名称或标签无效"}
	}
	storageID := ""
	if asset.Kind == "text" {
		if strings.TrimSpace(asset.Data.Content) == "" || utf8.RuneCountInString(asset.Data.Content) > 200000 {
			return AccountAssetData{}, safeMessageError{message: "文本素材内容不能为空且不能超过 200000 字"}
		}
	} else {
		if asset.Kind != "image" && asset.Kind != "video" && asset.Kind != "audio" {
			return AccountAssetData{}, safeMessageError{message: "不支持的素材类型"}
		}
		if !strings.HasPrefix(asset.Data.StorageKey, "server:") || strings.HasPrefix(asset.Data.StorageKey, "server:webdav:") {
			return AccountAssetData{}, safeMessageError{message: "请先将素材文件保存到账号存储，不能保存浏览器文件或未归档链接"}
		}
		storageID = strings.TrimPrefix(asset.Data.StorageKey, "server:")
		if storageID == "" {
			return AccountAssetData{}, safeMessageError{message: "素材文件标识无效"}
		}
	}
	result := AccountAssetData{}
	_, err = repository.PatchUserConfigWithStorage(user.ID, now(), storageID, func(config *model.UserConfig, object *model.StorageObject) error {
		asset, err := normalizeAccountAsset(asset, object, now())
		if err != nil {
			return err
		}
		values, assets, err := accountAssetEnvelope(config.AssetData)
		if err != nil {
			return err
		}
		folders, err := accountAssetFolders(values)
		if err != nil { return err }
		if asset.Data.StorageKey != "" {
			for _, savedRaw := range assets {
				var saved accountAssetIdentity
				if json.Unmarshal(savedRaw, &saved) == nil && saved.ID != asset.ID && saved.Data.StorageKey == asset.Data.StorageKey {
					result.Assets = assets
					result.Folders = folders
					return nil
				}
			}
		}
		for i, savedRaw := range assets {
			var saved accountAssetIdentity
			if json.Unmarshal(savedRaw, &saved) != nil {
				continue
			}
			if saved.ID != asset.ID {
				continue
			}
			// 已有素材的组织字段以最新数据库为准，只由 organize 修改。
			var organization struct { Tags []string `json:"tags"`; FolderIDs []string `json:"folderIds"` }
			if json.Unmarshal(savedRaw, &organization) != nil { return safeMessageError{message: "账号素材组织数据无效，未修改原数据"} }
			asset.Tags, asset.FolderIDs = organization.Tags, organization.FolderIDs
			if asset.Tags == nil { asset.Tags = []string{} }
			if asset.FolderIDs == nil { asset.FolderIDs = []string{} }
			if saved.CreatedAt != "" {
				asset.CreatedAt = saved.CreatedAt
			}
			asset.UpdatedAt = saved.UpdatedAt
			encoded, err := json.Marshal(asset)
			if err != nil {
				return err
			}
			if !bytes.Equal(encoded, savedRaw) {
				asset.UpdatedAt = now()
				encoded, err = json.Marshal(asset)
			}
			if err != nil {
				return err
			}
			assets[i] = encoded
			return saveAccountAssetEnvelope(config, values, assets, &result)
		}
		asset.Tags, err = normalizeAssetTags(asset.Tags)
		if err != nil { return err }
		asset.FolderIDs, err = normalizeAssetIDs(asset.FolderIDs, 32)
		if err != nil { return err }
		if err := requireAssetFolders(asset.FolderIDs, folders); err != nil { return err }
		encoded, err := json.Marshal(asset)
		if err != nil {
			return err
		}
		return saveAccountAssetEnvelope(config, values, append([]json.RawMessage{encoded}, assets...), &result)
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = safeMessageError{message: "素材文件不存在或不属于当前账号"}
	}
	return result, err
}

func DeleteCurrentUserAssetItem(ctx context.Context, id string) (AccountAssetData, error) {
	user, err := accountDataUser(ctx)
	if err != nil {
		return AccountAssetData{}, err
	}
	id = strings.TrimSpace(id)
	if id == "" || len(id) > 128 {
		return AccountAssetData{}, safeMessageError{message: "素材 ID 无效"}
	}
	result := AccountAssetData{}
	_, err = repository.PatchUserConfig(user.ID, now(), func(config *model.UserConfig) error {
		values, assets, err := accountAssetEnvelope(config.AssetData)
		if err != nil {
			return err
		}
		remaining := []json.RawMessage{}
		for _, raw := range assets {
			var saved struct {
				ID string `json:"id"`
			}
			if json.Unmarshal(raw, &saved) != nil || saved.ID != id {
				remaining = append(remaining, raw)
			}
		}
		return saveAccountAssetEnvelope(config, values, remaining, &result)
	})
	return result, err
}

func normalizeAccountAsset(asset accountAsset, object *model.StorageObject, timestamp string) (accountAsset, error) {
	asset.CreatedAt, asset.UpdatedAt = timestamp, timestamp
	if asset.Tags == nil {
		asset.Tags = []string{}
	}
	asset.CoverURL = ""
	if asset.Kind == "text" {
		asset.Data = accountAssetContent{Content: asset.Data.Content}
		return asset, nil
	}
	if object == nil || object.Bytes < 0 {
		return asset, safeMessageError{message: "素材文件索引无效"}
	}
	mime := strings.ToLower(strings.TrimSpace(strings.Split(object.MimeType, ";")[0]))
	kind, _, _ := strings.Cut(mime, "/")
	if kind != "image" && kind != "video" && kind != "audio" {
		return asset, safeMessageError{message: "归档文件不是支持的图片、视频或音频"}
	}
	if asset.Data.Width < 0 || asset.Data.Width > 100000 || asset.Data.Height < 0 || asset.Data.Height > 100000 || asset.Data.DurationMS < 0 || asset.Data.DurationMS > 1e12 {
		return asset, safeMessageError{message: "素材尺寸或时长无效"}
	}
	width, height := asset.Data.Width, asset.Data.Height
	if object.Width > 0 {
		width = object.Width
	}
	if object.Height > 0 {
		height = object.Height
	}
	asset.Kind = kind
	asset.Data = accountAssetContent{StorageKey: "server:" + object.ID, Bytes: object.Bytes, MimeType: mime, Width: width, Height: height, DurationMS: asset.Data.DurationMS}
	contentURL := "/api/files/" + url.PathEscape(object.ID) + "/content"
	if kind == "image" {
		asset.Data.DataURL, asset.CoverURL = contentURL, contentURL
	} else {
		asset.Data.URL = contentURL
	}
	return asset, nil
}

func accountAssetEnvelope(raw string) (map[string]json.RawMessage, []json.RawMessage, error) {
	values := map[string]json.RawMessage{}
	if strings.TrimSpace(raw) != "" && json.Unmarshal([]byte(raw), &values) != nil {
		return nil, nil, safeMessageError{message: "账号素材数据无效，未修改原数据"}
	}
	if values == nil {
		values = map[string]json.RawMessage{}
	}
	assets := []json.RawMessage{}
	if value, exists := values["assets"]; exists && json.Unmarshal(value, &assets) != nil {
		return nil, nil, safeMessageError{message: "账号素材列表格式无效，未修改原数据"}
	}
	if assets == nil {
		assets = []json.RawMessage{}
	}
	return values, assets, nil
}

func saveAccountAssetEnvelope(config *model.UserConfig, values map[string]json.RawMessage, assets []json.RawMessage, result *AccountAssetData) error {
	folders, err := accountAssetFolders(values)
	if err != nil { return err }
	values["assets"], _ = json.Marshal(assets)
	if _, exists := values["folders"]; !exists { values["folders"] = json.RawMessage(`[]`) }
	raw, err := json.Marshal(values)
	if err == nil {
		config.AssetData = string(raw)
		result.Assets = assets
		result.Folders = folders
	}
	return err
}
