package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"path"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"gorm.io/gorm"
)

func CurrentUserStorageFiles(ctx context.Context, q model.Query) (model.StorageFileList, error) {
	user, err := accountDataUser(ctx)
	if err != nil {
		return model.StorageFileList{}, err
	}
	namedIDs := []string{}
	if keyword := strings.ToLower(strings.TrimSpace(q.Keyword)); keyword != "" {
		config, _, err := repository.GetUserConfig(user.ID)
		if err != nil {
			return model.StorageFileList{}, err
		}
		_, assets, err := accountAssetEnvelope(config.AssetData)
		if err != nil {
			return model.StorageFileList{}, err
		}
		for _, raw := range assets {
			var asset accountAsset
			if json.Unmarshal(raw, &asset) == nil && strings.Contains(strings.ToLower(asset.Title), keyword) {
				if id := storageIDFromMediaValue(asset.Data.StorageKey); id != "" {
					namedIDs = append(namedIDs, id)
				}
			}
		}
	}
	files, total, data, err := repository.UserStorageFiles(user.ID, q, namedIDs...)
	result := model.StorageFileList{Items: []model.StorageFileReferences{}, Total: total}
	if err != nil {
		return result, err
	}
	settings, err := repository.GetSettings()
	if err != nil {
		return result, err
	}
	for _, file := range files {
		result.Items = append(result.Items, storageFileReferences(file, data, settings.Private.Storage))
	}
	return result, nil
}

func CurrentUserStorageFileReferences(ctx context.Context, id string) (model.StorageFileReferences, error) {
	user, err := accountDataUser(ctx)
	if err != nil {
		return model.StorageFileReferences{}, err
	}
	file, data, err := repository.UserStorageFileReferences(user.ID, strings.TrimSpace(id))
	if err != nil {
		return model.StorageFileReferences{}, storageFileLookupError(err)
	}
	settings, err := repository.GetSettings()
	if err != nil {
		return model.StorageFileReferences{}, err
	}
	return storageFileReferences(file, data, settings.Private.Storage), nil
}

func storageFileLookupError(err error) error {
	if errors.Is(err, repository.ErrStorageFileAccessDenied) {
		return ErrStorageAccessDenied
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return safeMessageError{message: "文件不存在或不属于当前账号"}
	}
	return err
}

func mediaValueReferencesFile(value string, object model.StorageObject) bool {
	if storageIDFromMediaValue(value) == object.ID {
		return true
	}
	if object.PublicURL == "" || value == "" {
		return false
	}
	clean := func(value string) string {
		parsed, err := url.Parse(value)
		if err != nil {
			return value
		}
		parsed.RawQuery, parsed.Fragment = "", ""
		return parsed.String()
	}
	return clean(value) == clean(object.PublicURL)
}

func rawReferencesFile(raw string, object model.StorageObject) (bool, error) {
	values, err := storageMediaValues(raw)
	if err != nil {
		return false, err
	}
	for _, value := range values {
		if mediaValueReferencesFile(value, object) {
			return true, nil
		}
	}
	return false, nil
}

func isStorageTaskActive(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "completed", "failed", "cancelled", "canceled", "error", "succeeded", "success":
		return false
	default:
		return true
	}
}

func storageFileReferences(object model.StorageObject, data repository.StorageReferenceData, storage model.PrivateStorageSetting) model.StorageFileReferences {
	providerType := "unknown"
	if object.ProviderID == localStorageProviderID {
		providerType = "local"
	}
	for _, provider := range storage.Providers {
		if provider.ID == object.ProviderID {
			providerType = provider.Type
		}
	}
	if object.Direct {
		providerType = "webdav"
	}
	result := model.StorageFileReferences{File: model.StorageFile{ID: object.ID, StorageKey: "server:" + object.ID, Name: path.Base(object.ObjectKey), MimeType: object.MimeType, Bytes: object.Bytes, CreatedAt: object.CreatedAt, ProviderType: providerType}, Blockers: []model.StorageFileBlocker{}}
	result.File.DeletePending = object.DeletedAt != ""
	seen := map[string]bool{}
	check := func(raw, kind, id, title, owner string) {
		found, err := rawReferencesFile(raw, object)
		if err != nil && (strings.Contains(raw, object.ID) || owner == object.CreatedBy) {
			kind, id, title, found = "unverified", "", "存在无法核实的引用数据，请先修复或重新保存", true
		}
		if !found {
			return
		}
		if owner != "" && owner != object.CreatedBy {
			kind, id, title = "otherAccount", "", "其他账号仍在使用此文件"
		}
		if title == "" {
			title = id
		}
		if key := kind + ":" + id; !seen[key] {
			result.Blockers = append(result.Blockers, model.StorageFileBlocker{Type: kind, ID: id, Title: title})
			seen[key] = true
		}
	}
	_, assets, err := accountAssetEnvelope(data.Config.AssetData)
	if err != nil {
		result.Blockers = append(result.Blockers, model.StorageFileBlocker{Type: "unverified", ID: "", Title: "账号素材数据无法核实"})
	}
	for _, raw := range assets {
		if found, err := rawReferencesFile(string(raw), object); err != nil {
			result.Blockers = append(result.Blockers, model.StorageFileBlocker{Type: "unverified", ID: "", Title: "账号素材数据无法核实"})
		} else if found {
			result.AssetCount++
			var asset struct {
				Title string `json:"title"`
			}
			if json.Unmarshal(raw, &asset) == nil && asset.Title != "" {
				result.File.Name = asset.Title
			}
		}
	}
	for _, project := range data.Projects {
		var metadata struct {
			Title string `json:"title"`
		}
		_ = json.Unmarshal([]byte(project.ProjectData), &metadata)
		check(project.ProjectData, "canvas", project.ID, metadata.Title, project.UserID)
	}
	for _, log := range data.Images {
		check(log.PayloadJSON, "imageHistory", log.ID, "图片生成历史", log.UserID)
	}
	for _, log := range data.Videos {
		check(log.PayloadJSON, "videoHistory", log.ID, "视频生成历史", log.UserID)
	}
	check(data.Config.ImageHistory, "imageHistory", "legacy", "图片生成历史", object.CreatedBy)
	for _, config := range data.OtherConfigs {
		check(config.AssetData, "otherAccount", "", "", config.UserID)
		check(config.ImageHistory, "otherAccount", "", "", config.UserID)
	}
	checkTask := func(task any, id, owner, status string) {
		if !isStorageTaskActive(status) {
			var output any
			switch task := task.(type) {
			case model.CanvasImageTask:
				output = map[string]any{"storageKey": task.StorageKey, "imageUrl": task.ImageURL, "imageUrls": task.ImageURLs}
			case model.CanvasAudioTask:
				output = map[string]any{"storageKey": task.StorageKey, "audioUrl": task.AudioURL}
			case model.VideoTask:
				output = map[string]any{"videoUrl": task.VideoURL}
			}
			raw, _ := json.Marshal(output)
			if owner != object.CreatedBy {
				check(string(raw), "otherAccount", "", "", owner)
			} else if found, _ := rawReferencesFile(string(raw), object); found {
				result.CompletedTaskCount++
			}
			return
		}
		raw, _ := json.Marshal(task)
		check(string(raw), "activeTask", id, "生成任务正在使用此文件", owner)
	}
	for _, task := range data.ImageTasks {
		checkTask(task, task.ID, task.UserID, task.Status)
	}
	for _, task := range data.AudioTasks {
		checkTask(task, task.ID, task.UserID, task.Status)
	}
	for _, task := range data.VideoTasks {
		checkTask(task, task.ID, task.UserID, task.Status)
	}
	for _, asset := range data.Assets {
		raw, _ := json.Marshal(asset)
		check(string(raw), "published", asset.ID, "公共素材："+asset.Title, "")
	}
	for _, prompt := range data.Prompts {
		raw, _ := json.Marshal(prompt)
		check(string(raw), "published", prompt.ID, "提示词："+prompt.Title, "")
	}
	for _, skill := range data.Skills {
		raw, _ := json.Marshal(skill)
		check(string(raw), "published", skill.ID, "技能封面："+skill.Name, skill.OwnerUserID)
	}
	result.CanDelete = len(result.Blockers) == 0
	if !result.CanDelete {
		result.Reason = "文件仍被使用，请先解除列出的引用后再删除"
	} else if result.AssetCount > 0 || result.CompletedTaskCount > 0 {
		result.Reason = "删除文件时需要同时移除对应素材条目及已完成任务的输出链接"
	}
	if result.CanDelete && result.File.DeletePending {
		result.Reason = "上次删除尚未完成，文件仍占用空间，请重试删除"
	}
	return result
}

func DeleteCurrentUserStorageFile(ctx context.Context, id string, removeAssetRecords bool, providerInput *StorageObjectProviderInput) (model.StorageFileDeletion, error) {
	user, err := accountDataUser(ctx)
	if err != nil {
		return model.StorageFileDeletion{}, err
	}
	id = strings.TrimSpace(id)
	if id == "" || len(id) > 128 {
		return model.StorageFileDeletion{}, safeMessageError{message: "文件 ID 无效"}
	}
	settings, err := repository.GetSettings()
	if err != nil {
		return model.StorageFileDeletion{}, err
	}
	storage := normalizePrivateStorageSetting(settings.Private.Storage)
	result, err := repository.DeleteUserStorageFile(user.ID, id, now(), func(object model.StorageObject, data repository.StorageReferenceData) (repository.StorageFileRemoval, error) {
		changes := repository.StorageFileRemoval{AssetData: data.Config.AssetData}
		references := storageFileReferences(object, data, storage)
		if !references.CanDelete {
			return changes, safeMessageError{message: references.Reason}
		}
		if (references.AssetCount > 0 || references.CompletedTaskCount > 0) && !removeAssetRecords {
			return changes, safeMessageError{message: "请明确确认同时移除对应素材条目及已完成任务输出链接"}
		}
		if references.AssetCount > 0 {
			values, assets, err := accountAssetEnvelope(data.Config.AssetData)
			if err != nil {
				return changes, err
			}
			remaining := []json.RawMessage{}
			for _, raw := range assets {
				found, _ := rawReferencesFile(string(raw), object)
				if !found {
					remaining = append(remaining, raw)
				}
			}
			values["assets"], _ = json.Marshal(remaining)
			raw, err := json.Marshal(values)
			if err != nil {
				return changes, err
			}
			changes.AssetData = string(raw)
		}
		for _, task := range data.ImageTasks {
			if task.UserID != user.ID || isStorageTaskActive(task.Status) {
				continue
			}
			changed := false
			if mediaValueReferencesFile(task.ImageURL, object) {
				task.ImageURL, changed = "", true
			}
			if mediaValueReferencesFile(task.StorageKey, object) {
				task.StorageKey, changed = "", true
			}
			urls := []string{}
			for _, value := range task.ImageURLs {
				if mediaValueReferencesFile(value, object) {
					changed = true
				} else {
					urls = append(urls, value)
				}
			}
			task.ImageURLs = urls
			if changed {
				changes.Images = append(changes.Images, task)
			}
		}
		for _, task := range data.AudioTasks {
			if task.UserID != user.ID || isStorageTaskActive(task.Status) {
				continue
			}
			changed := false
			if mediaValueReferencesFile(task.AudioURL, object) {
				task.AudioURL, changed = "", true
			}
			if mediaValueReferencesFile(task.StorageKey, object) {
				task.StorageKey, changed = "", true
			}
			if changed {
				changes.Audio = append(changes.Audio, task)
			}
		}
		for _, task := range data.VideoTasks {
			if task.UserID == user.ID && !isStorageTaskActive(task.Status) && mediaValueReferencesFile(task.VideoURL, object) {
				task.VideoURL = ""
				changes.Videos = append(changes.Videos, task)
			}
		}
		return changes, nil
	}, func(object model.StorageObject, data repository.StorageReferenceData) error {
		providers := append([]model.StorageProvider{localStorageProvider()}, storage.Providers...)
		providers = append(userStorageProvidersForOwner(data.Config.StorageProvider, user.ID), providers...)
		if providerInput != nil && storage.AllowUserProvider {
			providers = append([]model.StorageProvider{normalizeUserStorageProvider(*providerInput, ctx)}, providers...)
		}
		provider, ok := findStorageProviderForObject(object, providers)
		if !ok {
			return safeMessageError{message: "文件原存储配置不存在，请联系管理员恢复配置后重试"}
		}
		if err := deleteStorageObjectData(provider, object.ObjectKey); err != nil {
			return safeMessageError{message: "文件删除失败，空间尚未释放，请稍后重试或联系管理员"}
		}
		return nil
	})
	return result, storageFileLookupError(err)
}
