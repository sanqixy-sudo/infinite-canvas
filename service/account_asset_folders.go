package service

import (
	"context"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

func SaveCurrentUserAssetFolder(ctx context.Context, input model.AssetFolderInput) (AccountAssetData, error) {
	user, err := accountDataUser(ctx)
	if err != nil {
		return AccountAssetData{}, err
	}
	input.ID = strings.TrimSpace(input.ID)
	if len(input.ID) > 128 {
		return AccountAssetData{}, safeMessageError{message: "素材目录 ID 无效"}
	}
	result := AccountAssetData{}
	timestamp := now()
	_, err = repository.PatchUserConfig(user.ID, timestamp, func(config *model.UserConfig) error {
		values, assets, err := accountAssetEnvelope(config.AssetData)
		if err != nil {
			return err
		}
		folders, err := accountAssetFolders(values)
		if err != nil {
			return err
		}
		index := -1
		for i, folder := range folders {
			if folder.ID == input.ID {
				index = i
				break
			}
		}
		if input.ID != "" && index < 0 {
			return safeMessageError{message: "素材目录不存在或不属于当前账号"}
		}
		folder := model.AssetFolder{ID: newID("asset-folder"), CreatedAt: timestamp, UpdatedAt: timestamp}
		if index >= 0 {
			folder = folders[index]
		}
		if input.Name != nil {
			folder.Name = strings.TrimSpace(*input.Name)
		}
		if input.ParentID != nil {
			folder.ParentID = strings.TrimSpace(*input.ParentID)
		}
		if index < 0 {
			folders = append(folders, folder)
		} else {
			if folder.Name != folders[index].Name || folder.ParentID != folders[index].ParentID {
				folder.UpdatedAt = timestamp
			}
			folders[index] = folder
		}
		if err := validateAssetFolderTree(folders); err != nil {
			return err
		}
		if err := setAccountAssetFolders(values, folders); err != nil {
			return err
		}
		return saveAccountAssetEnvelope(config, values, assets, &result)
	})
	return result, err
}

func DeleteCurrentUserAssetFolder(ctx context.Context, id string) (AccountAssetData, error) {
	user, err := accountDataUser(ctx)
	if err != nil {
		return AccountAssetData{}, err
	}
	id = strings.TrimSpace(id)
	if id == "" || len(id) > 128 {
		return AccountAssetData{}, safeMessageError{message: "素材目录 ID 无效"}
	}
	result := AccountAssetData{}
	timestamp := now()
	_, err = repository.PatchUserConfig(user.ID, timestamp, func(config *model.UserConfig) error {
		values, assets, err := accountAssetEnvelope(config.AssetData)
		if err != nil {
			return err
		}
		folders, err := accountAssetFolders(values)
		if err != nil {
			return err
		}
		removed := map[string]bool{id: true}
		for changed := true; changed; {
			changed = false
			for _, folder := range folders {
				if removed[folder.ParentID] && !removed[folder.ID] {
					removed[folder.ID] = true
					changed = true
				}
			}
		}
		remaining := []model.AssetFolder{}
		for _, folder := range folders {
			if !removed[folder.ID] {
				remaining = append(remaining, folder)
			}
		}
		for i, raw := range assets {
			fields := map[string]json.RawMessage{}
			if json.Unmarshal(raw, &fields) != nil {
				continue
			}
			var ids []string
			if field, exists := fields["folderIds"]; exists && json.Unmarshal(field, &ids) != nil {
				return safeMessageError{message: "素材目录归属数据无效，未修改原数据"}
			}
			kept := []string{}
			for _, folderID := range ids {
				if !removed[folderID] {
					kept = append(kept, folderID)
				}
			}
			if len(kept) == len(ids) {
				continue
			}
			fields["folderIds"], _ = json.Marshal(kept)
			fields["updatedAt"], _ = json.Marshal(timestamp)
			assets[i], err = json.Marshal(fields)
			if err != nil {
				return err
			}
		}
		if err := setAccountAssetFolders(values, remaining); err != nil {
			return err
		}
		return saveAccountAssetEnvelope(config, values, assets, &result)
	})
	return result, err
}

func OrganizeCurrentUserAssets(ctx context.Context, input model.AssetOrganizationInput) (AccountAssetData, error) {
	user, err := accountDataUser(ctx)
	if err != nil {
		return AccountAssetData{}, err
	}
	input.IDs, err = normalizeAssetIDs(input.IDs, 200)
	if err != nil {
		return AccountAssetData{}, err
	}
	if len(input.IDs) == 0 {
		return AccountAssetData{}, safeMessageError{message: "请选择需要整理的素材，单次最多 200 个"}
	}
	if input.FolderIDs != nil && (len(input.AddFolderIDs) > 0 || len(input.RemoveFolderIDs) > 0) {
		return AccountAssetData{}, safeMessageError{message: "目录替换不能与添加或移除同时使用"}
	}
	input.AddFolderIDs, err = normalizeAssetIDs(input.AddFolderIDs, 32)
	if err != nil {
		return AccountAssetData{}, err
	}
	input.RemoveFolderIDs, err = normalizeAssetIDs(input.RemoveFolderIDs, 1000)
	if err != nil {
		return AccountAssetData{}, err
	}
	if input.FolderIDs != nil {
		ids, err := normalizeAssetIDs(*input.FolderIDs, 32)
		if err != nil {
			return AccountAssetData{}, err
		}
		input.FolderIDs = &ids
	}
	input.AddTags, err = normalizeAssetTags(input.AddTags)
	if err != nil {
		return AccountAssetData{}, err
	}
	input.RemoveTags, err = normalizeAssetTags(input.RemoveTags)
	if err != nil {
		return AccountAssetData{}, err
	}
	if overlappingAssetValues(input.AddFolderIDs, input.RemoveFolderIDs) || overlappingAssetValues(input.AddTags, input.RemoveTags) {
		return AccountAssetData{}, safeMessageError{message: "同一目录或标签不能同时添加和移除"}
	}
	if input.FolderIDs == nil && len(input.AddFolderIDs)+len(input.RemoveFolderIDs)+len(input.AddTags)+len(input.RemoveTags) == 0 {
		return AccountAssetData{}, safeMessageError{message: "请选择目录或标签整理操作"}
	}
	result := AccountAssetData{}
	timestamp := now()
	_, err = repository.PatchUserConfig(user.ID, timestamp, func(config *model.UserConfig) error {
		values, assets, err := accountAssetEnvelope(config.AssetData)
		if err != nil {
			return err
		}
		folders, err := accountAssetFolders(values)
		if err != nil {
			return err
		}
		references := append(append([]string{}, input.AddFolderIDs...), input.RemoveFolderIDs...)
		if input.FolderIDs != nil {
			references = append(references, (*input.FolderIDs)...)
		}
		if err := requireAssetFolders(references, folders); err != nil {
			return err
		}
		selected, found := map[string]bool{}, map[string]bool{}
		for _, id := range input.IDs {
			selected[id] = true
		}
		for i, raw := range assets {
			var identity accountAssetIdentity
			if json.Unmarshal(raw, &identity) != nil || !selected[identity.ID] {
				continue
			}
			fields := map[string]json.RawMessage{}
			if json.Unmarshal(raw, &fields) != nil {
				return safeMessageError{message: "账号素材格式无效，未修改原数据"}
			}
			var organization struct {
				Tags      []string `json:"tags"`
				FolderIDs []string `json:"folderIds"`
			}
			if json.Unmarshal(raw, &organization) != nil {
				return safeMessageError{message: "账号素材组织数据无效，未修改原数据"}
			}
			if input.FolderIDs != nil || len(input.AddFolderIDs)+len(input.RemoveFolderIDs) > 0 {
				ids := editAssetValues(organization.FolderIDs, input.AddFolderIDs, input.RemoveFolderIDs)
				if input.FolderIDs != nil {
					ids = *input.FolderIDs
				}
				ids, err = normalizeAssetIDs(ids, 32)
				if err != nil {
					return err
				}
				if err := requireAssetFolders(ids, folders); err != nil {
					return err
				}
				fields["folderIds"], _ = json.Marshal(ids)
			}
			if len(input.AddTags)+len(input.RemoveTags) > 0 {
				tags, err := normalizeAssetTags(editAssetValues(organization.Tags, input.AddTags, input.RemoveTags))
				if err != nil {
					return err
				}
				fields["tags"], _ = json.Marshal(tags)
			}
			fields["updatedAt"], _ = json.Marshal(timestamp)
			assets[i], err = json.Marshal(fields)
			if err != nil {
				return err
			}
			found[identity.ID] = true
		}
		if len(found) != len(selected) {
			return safeMessageError{message: "部分素材不存在或不属于当前账号，未修改任何素材"}
		}
		return saveAccountAssetEnvelope(config, values, assets, &result)
	})
	return result, err
}

func accountAssetFolders(values map[string]json.RawMessage) ([]model.AssetFolder, error) {
	folders := []model.AssetFolder{}
	if raw, exists := values["folders"]; exists && json.Unmarshal(raw, &folders) != nil {
		return nil, safeMessageError{message: "账号目录数据无效，未修改原数据"}
	}
	if folders == nil {
		folders = []model.AssetFolder{}
	}
	if err := validateAssetFolderTree(folders); err != nil {
		return nil, err
	}
	return folders, nil
}

func validateAssetFolderTree(folders []model.AssetFolder) error {
	if len(folders) > 1000 {
		return safeMessageError{message: "最多创建 1000 个素材目录"}
	}
	byID, names := map[string]model.AssetFolder{}, map[string]bool{}
	for _, folder := range folders {
		if folder.ID == "" || len(folder.ID) > 128 || strings.TrimSpace(folder.Name) == "" || utf8.RuneCountInString(folder.Name) > 80 || byID[folder.ID].ID != "" {
			return safeMessageError{message: "素材目录 ID 或名称无效，名称最多 80 字"}
		}
		name := folder.ParentID + "\x00" + strings.ToLower(strings.TrimSpace(folder.Name))
		if names[name] {
			return safeMessageError{message: "同一级目录不能重名"}
		}
		names[name], byID[folder.ID] = true, folder
	}
	for _, folder := range folders {
		seen := map[string]bool{}
		for id, depth := folder.ID, 0; id != ""; depth++ {
			if seen[id] {
				return safeMessageError{message: "不能将目录移入自身或子目录"}
			}
			current, exists := byID[id]
			if !exists {
				return safeMessageError{message: "上级目录不存在或不属于当前账号"}
			}
			if depth >= 8 {
				return safeMessageError{message: "素材目录最多支持 8 层"}
			}
			seen[id], id = true, current.ParentID
		}
	}
	return nil
}

func setAccountAssetFolders(values map[string]json.RawMessage, folders []model.AssetFolder) error {
	// 保留目录及顶层 JSON 中未来可能扩展的字段，仅更新已知目录属性。
	var previous []map[string]json.RawMessage
	if raw, exists := values["folders"]; exists && json.Unmarshal(raw, &previous) != nil {
		return safeMessageError{message: "账号目录数据无效，未修改原数据"}
	}
	byID := map[string]map[string]json.RawMessage{}
	for _, fields := range previous {
		var id string
		_ = json.Unmarshal(fields["id"], &id)
		byID[id] = fields
	}
	next := []map[string]json.RawMessage{}
	for _, folder := range folders {
		fields := byID[folder.ID]
		if fields == nil {
			fields = map[string]json.RawMessage{}
		}
		encoded, err := json.Marshal(folder)
		if err != nil {
			return err
		}
		known := map[string]json.RawMessage{}
		if err := json.Unmarshal(encoded, &known); err != nil {
			return err
		}
		for key, value := range known {
			fields[key] = value
		}
		next = append(next, fields)
	}
	encoded, err := json.Marshal(next)
	if err == nil {
		values["folders"] = encoded
	}
	return err
}

func normalizeAssetIDs(values []string, limit int) ([]string, error) {
	if len(values) > limit {
		return nil, safeMessageError{message: "目录数量或本次素材数量超出限制"}
	}
	result, seen := []string{}, map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || len(value) > 128 {
			return nil, safeMessageError{message: "素材或目录 ID 无效"}
		}
		if !seen[value] {
			result = append(result, value)
			seen[value] = true
		}
	}
	return result, nil
}

func normalizeAssetTags(values []string) ([]string, error) {
	if len(values) > 50 {
		return nil, safeMessageError{message: "每个素材最多 50 个标签"}
	}
	result, seen := []string{}, map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if utf8.RuneCountInString(value) > 80 {
			return nil, safeMessageError{message: "素材标签最多 80 字"}
		}
		if !seen[value] {
			result = append(result, value)
			seen[value] = true
		}
	}
	return result, nil
}

func requireAssetFolders(ids []string, folders []model.AssetFolder) error {
	known := map[string]bool{}
	for _, folder := range folders {
		known[folder.ID] = true
	}
	for _, id := range ids {
		if !known[id] {
			return safeMessageError{message: "素材目录不存在或不属于当前账号"}
		}
	}
	return nil
}

func overlappingAssetValues(add, remove []string) bool {
	seen := map[string]bool{}
	for _, value := range add {
		seen[value] = true
	}
	for _, value := range remove {
		if seen[value] {
			return true
		}
	}
	return false
}

func editAssetValues(previous, add, remove []string) []string {
	removed, seen := map[string]bool{}, map[string]bool{}
	for _, value := range remove {
		removed[value] = true
	}
	result := []string{}
	for _, value := range append(append([]string{}, previous...), add...) {
		value = strings.TrimSpace(value)
		if !removed[value] && !seen[value] {
			result = append(result, value)
			seen[value] = true
		}
	}
	return result
}
