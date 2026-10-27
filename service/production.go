package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"gorm.io/gorm"
)

const ProductionMaxBodyBytes = 4 << 20

func productionError(message string) error { return safeMessageError{message: message} }

func productionUser(ctx context.Context) (string, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return "", productionError("请先登录")
	}
	return user.ID, nil
}

func CurrentUserProduction(ctx context.Context, workspaceID string) (*model.ProductionDocument, error) {
	userID, err := productionUser(ctx)
	if err != nil { return nil, err }
	if err := productionID(&workspaceID, "项目", true); err != nil { return nil, err }
	doc, err := repository.GetUserProductionDocument(userID, workspaceID)
	if doc != nil { sortProduction(doc) }
	return doc, err
}

func CreateCurrentUserProduction(ctx context.Context, workspaceID, title string) (*model.ProductionDocument, error) {
	userID, err := productionUser(ctx)
	if err != nil { return nil, err }
	if err := productionID(&workspaceID, "项目", true); err != nil { return nil, err }
	if err := productionText(&title, "制作计划名称", 180, true); err != nil { return nil, err }
	stamp := now()
	project := model.ProductionProject{ID: newID("production"), UserID: userID, WorkspaceID: workspaceID, Title: title, Revision: 1, CreatedAt: stamp, UpdatedAt: stamp}
	doc, err := repository.CreateUserProductionDocument(project, func(canvases []model.CanvasProject) error {
		return validateProductionCanvases(model.ProductionDocument{ProductionProject: project}, canvases)
	})
	if doc != nil { sortProduction(doc) }
	return doc, err
}

func SaveCurrentUserProduction(ctx context.Context, doc model.ProductionDocument) (*model.ProductionDocument, error) {
	userID, err := productionUser(ctx)
	if err != nil { return nil, err }
	if err := normalizeProduction(&doc); err != nil { return nil, err }
	if err := validateProductionDelivery(doc); err != nil { return nil, err }
	doc.UserID, doc.UpdatedAt = userID, now()
	canvasIDs := map[string]bool{doc.WorkspaceID: true}
	for _, asset := range doc.Assets {
		for _, ref := range asset.References { canvasIDs[ref.CanvasID] = true }
	}
	for _, shot := range doc.Shots {
		if shot.CanvasID != "" { canvasIDs[shot.CanvasID] = true }
		for _, candidate := range shot.Candidates { canvasIDs[candidate.CanvasID] = true }
	}
	ids := make([]string, 0, len(canvasIDs))
	for id := range canvasIDs { ids = append(ids, id) }
	saved, err := repository.SaveUserProductionDocument(userID, doc, ids, productionDeliveryStorageIDs(doc), func(canvases []model.CanvasProject) error {
		return validateProductionCanvases(doc, canvases)
	})
	if errors.Is(err, repository.ErrProductionConflict) {
		return nil, productionError("制作计划已在其他窗口更新。请先保留当前内容，再重新加载最新版本后保存")
	}
	if errors.Is(err, gorm.ErrRecordNotFound) { return nil, productionError("制作计划不存在或无权访问") }
	return saved, err
}

func DeleteCurrentUserProduction(ctx context.Context, id string, revision int64) error {
	userID, err := productionUser(ctx)
	if err != nil { return err }
	if err := productionID(&id, "制作计划", true); err != nil { return err }
	if revision < 1 || revision >= 1<<53 { return productionError("制作计划版本无效，请重新加载") }
	err = repository.DeleteUserProductionDocument(userID, id, revision)
	if errors.Is(err, repository.ErrProductionTeamShared) { return productionError(err.Error()) }
	if errors.Is(err, repository.ErrProductionConflict) { return productionError("制作计划已在其他窗口更新，请重新加载并确认内容后再删除") }
	if errors.Is(err, gorm.ErrRecordNotFound) { return productionError("制作计划不存在或无权访问") }
	return err
}

// Used before deleting account canvases; browser-only canvases have no account plan.
func CurrentUserProductionReferencesCanvases(ctx context.Context, canvasIDs []string) (bool, error) {
	userID, err := productionUser(ctx)
	if err != nil { return false, err }
	refs, err := repository.ListUserProductionCanvasReferences(userID)
	if err != nil { return false, err }
	selected := make(map[string]bool, len(canvasIDs))
	for _, id := range canvasIDs { selected[strings.TrimSpace(id)] = true }
	for _, id := range refs {
		if id != "" && selected[id] { return true, nil }
	}
	return false, nil
}

func productionText(value *string, label string, max int, required bool) error {
	*value = strings.TrimSpace(*value)
	if (required && *value == "") || utf8.RuneCountInString(*value) > max || strings.ContainsRune(*value, 0) {
		return productionError(label + "不能为空或超过长度限制")
	}
	return nil
}

func productionID(value *string, label string, required bool) error {
	if err := productionText(value, label+"标识", 128, required); err != nil { return err }
	if strings.IndexFunc(*value, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }) >= 0 {
		return productionError(label + "标识无效")
	}
	return nil
}

func normalizeProduction(doc *model.ProductionDocument) error {
	if err := productionID(&doc.ID, "制作计划", true); err != nil { return err }
	if err := productionID(&doc.WorkspaceID, "项目", true); err != nil { return err }
	if doc.Revision < 1 || doc.Revision >= 1<<53 { return productionError("制作计划版本无效，请重新加载") }
	if err := productionText(&doc.Title, "制作计划名称", 180, true); err != nil { return err }
	if err := productionText(&doc.Synopsis, "项目梗概", 20000, false); err != nil { return err }
	if err := productionText(&doc.StyleGuide, "风格说明", 20000, false); err != nil { return err }
	if len(doc.Episodes) > 100 || len(doc.Scenes) > 500 || len(doc.Shots) > 500 || len(doc.Assets) > 200 {
		return productionError("每份制作计划最多 100 集、500 个场次、500 个镜头和 200 个资产")
	}
	seen := map[string]bool{}
	checkID := func(id *string, label string) error {
		if err := productionID(id, label, true); err != nil { return err }
		if seen[*id] { return productionError("制作计划包含重复标识，请检查分集、场次、资产、镜头和候选结果") }
		seen[*id] = true
		return nil
	}
	checkOrder := func(order int) error {
		if order < 0 || order > 100000 { return productionError("排序必须是 0 至 100000 之间的整数") }
		return nil
	}
	episodes := map[string]bool{}
	for i := range doc.Episodes {
		episode := &doc.Episodes[i]
		episode.ProjectID = doc.ID
		if err := checkID(&episode.ID, "分集"); err != nil { return err }
		if err := productionText(&episode.Title, "分集名称", 180, true); err != nil { return err }
		if err := productionText(&episode.Script, "单集剧本", 100000, false); err != nil { return err }
		if err := checkOrder(episode.Order); err != nil { return err }
		episodes[episode.ID] = true
	}
	scenes := map[string]string{}
	for i := range doc.Scenes {
		scene := &doc.Scenes[i]
		scene.ProjectID = doc.ID
		if err := checkID(&scene.ID, "场次"); err != nil { return err }
		if err := productionID(&scene.EpisodeID, "场次所属分集", true); err != nil { return err }
		if !episodes[scene.EpisodeID] { return productionError("场次所属分集不存在") }
		if err := productionText(&scene.Title, "场次名称", 180, true); err != nil { return err }
		if err := productionText(&scene.Description, "场次描述", 20000, false); err != nil { return err }
		if err := checkOrder(scene.Order); err != nil { return err }
		scenes[scene.ID] = scene.EpisodeID
	}
	assets := map[string]*model.ProductionAsset{}
	for i := range doc.Assets {
		asset := &doc.Assets[i]
		asset.ProjectID = doc.ID
		if err := checkID(&asset.ID, "资产"); err != nil { return err }
		if err := productionText(&asset.Title, "资产名称", 180, true); err != nil { return err }
		if err := productionText(&asset.Description, "资产描述", 20000, false); err != nil { return err }
		if err := productionID(&asset.VariantOf, "资产原始版本", false); err != nil { return err }
		switch asset.Kind {
		case "character", "scene", "prop", "voice", "style":
		default: return productionError("资产类型无效")
		}
		if len(asset.References) > 50 { return productionError("每个资产最多引用 50 个画布节点") }
		refs := map[model.ProductionNodeRef]bool{}
		for j := range asset.References {
			ref := &asset.References[j]
			if err := productionID(&ref.CanvasID, "引用画布", true); err != nil { return err }
			if err := productionID(&ref.NodeID, "引用节点", true); err != nil { return err }
			if refs[*ref] { return productionError("资产包含重复节点引用") }
			refs[*ref] = true
		}
		if asset.References == nil { asset.References = []model.ProductionNodeRef{} }
		assets[asset.ID] = asset
	}
	for _, asset := range doc.Assets {
		visited := map[string]bool{asset.ID: true}
		for parentID := asset.VariantOf; parentID != ""; {
			parent, ok := assets[parentID]
			if !ok { return productionError("资产的原始版本不存在") }
			if parent.Kind != asset.Kind { return productionError("资产变体必须与原始版本类型一致") }
			if visited[parentID] { return productionError("资产变体不能引用自己或形成循环") }
			visited[parentID] = true
			parentID = parent.VariantOf
		}
	}
	candidateCount := 0
	for i := range doc.Shots {
		shot := &doc.Shots[i]
		shot.ProjectID = doc.ID
		if err := checkID(&shot.ID, "镜头"); err != nil { return err }
		if err := productionID(&shot.EpisodeID, "镜头所属分集", true); err != nil { return err }
		if err := productionID(&shot.SceneID, "镜头所属场次", false); err != nil { return err }
		if !episodes[shot.EpisodeID] { return productionError("镜头所属分集不存在") }
		if shot.SceneID != "" && scenes[shot.SceneID] != shot.EpisodeID { return productionError("镜头场次必须属于同一分集") }
		if err := productionText(&shot.Title, "镜头名称", 180, true); err != nil { return err }
		if err := productionText(&shot.Description, "镜头画面", 20000, false); err != nil { return err }
		if err := productionText(&shot.Dialogue, "镜头对白", 10000, false); err != nil { return err }
		if err := productionText(&shot.Camera, "景别与运镜", 2000, false); err != nil { return err }
		if err := checkOrder(shot.Order); err != nil { return err }
		if shot.Seconds < 1 || shot.Seconds > 86400 { return productionError("镜头时长必须是 1 至 86400 秒之间的整数") }
		if shot.Status != "draft" && shot.Status != "ready" { return productionError("镜头状态无效") }
		if len(shot.AssetIDs) > len(assets) { return productionError("镜头引用的资产数量无效") }
		shotAssets := map[string]bool{}
		for j := range shot.AssetIDs {
			id := &shot.AssetIDs[j]
			if err := productionID(id, "镜头资产", true); err != nil { return err }
			if assets[*id] == nil || shotAssets[*id] { return productionError("镜头引用了不存在或重复的资产") }
			shotAssets[*id] = true
		}
		for _, id := range []*string{&shot.CanvasID, &shot.TextNodeID, &shot.ImageNodeID, &shot.VideoNodeID} {
			if err := productionID(id, "镜头画布绑定", false); err != nil { return err }
		}
		if shot.CanvasID == "" && (shot.TextNodeID != "" || shot.ImageNodeID != "" || shot.VideoNodeID != "") {
			return productionError("镜头绑定节点时必须指定所属画布")
		}
		if shot.AssetIDs == nil { shot.AssetIDs = []string{} }
		if len(shot.Candidates) > 20 { return productionError("每个镜头最多保留 20 个候选结果") }
		candidateCount += len(shot.Candidates)
		if candidateCount > 1000 { return productionError("每份制作计划最多保留 1000 个候选结果") }
		candidateKinds := map[string]string{}
		candidateNodes := map[model.ProductionNodeRef]bool{}
		for j := range shot.Candidates {
			candidate := &shot.Candidates[j]
			if err := checkID(&candidate.ID, "候选结果"); err != nil { return err }
			if err := productionText(&candidate.Title, "候选结果名称", 180, true); err != nil { return err }
			if candidate.Kind != "image" && candidate.Kind != "video" { return productionError("候选结果只支持图片或视频") }
			if err := productionID(&candidate.CanvasID, "候选结果画布", true); err != nil { return err }
			if err := productionID(&candidate.NodeID, "候选结果节点", true); err != nil { return err }
			if err := productionText(&candidate.StorageKey, "候选文件标识", 1024, false); err != nil { return err }
			if candidate.StorageKey != "" {
				if candidate.Content != "" { return productionError("候选结果已有文件标识时不能同时保存内容链接") }
			} else if !validProductionCandidateURL(candidate.Content) {
				return productionError("候选结果需要有效的 HTTP 或 HTTPS 文件链接，最长 4096 字节；请先将本地文件保存到账号")
			}
			ref := model.ProductionNodeRef{CanvasID: candidate.CanvasID, NodeID: candidate.NodeID}
			if candidateNodes[ref] { return productionError("同一镜头不能重复保存同一个候选节点") }
			candidateNodes[ref] = true
			candidateKinds[candidate.ID] = candidate.Kind
		}
		for kind, selected := range map[string]*string{"image": &shot.SelectedImageCandidateID, "video": &shot.SelectedVideoCandidateID} {
			if err := productionID(selected, "采用结果", false); err != nil { return err }
			if *selected != "" && candidateKinds[*selected] != kind { return productionError("采用结果必须是本镜头中对应类型的候选图片或视频") }
		}
		if shot.Candidates == nil { shot.Candidates = []model.ProductionCandidate{} }
	}
	if doc.Episodes == nil { doc.Episodes = []model.ProductionEpisode{} }
	if doc.Scenes == nil { doc.Scenes = []model.ProductionScene{} }
	if doc.Assets == nil { doc.Assets = []model.ProductionAsset{} }
	if doc.Shots == nil { doc.Shots = []model.ProductionShot{} }
	encoded, err := json.Marshal(doc)
	if err != nil || len(encoded) > ProductionMaxBodyBytes { return productionError("制作计划内容超过 4 MiB，请精简剧本或拆分项目") }
	sortProduction(doc)
	return nil
}

func sortProduction(doc *model.ProductionDocument) {
	for i := range doc.Shots {
		if doc.Shots[i].Candidates == nil { doc.Shots[i].Candidates = []model.ProductionCandidate{} }
	}
	sort.SliceStable(doc.Episodes, func(i, j int) bool {
		if doc.Episodes[i].Order == doc.Episodes[j].Order { return doc.Episodes[i].ID < doc.Episodes[j].ID }
		return doc.Episodes[i].Order < doc.Episodes[j].Order
	})
	sort.SliceStable(doc.Scenes, func(i, j int) bool {
		if doc.Scenes[i].Order == doc.Scenes[j].Order { return doc.Scenes[i].ID < doc.Scenes[j].ID }
		return doc.Scenes[i].Order < doc.Scenes[j].Order
	})
	sort.SliceStable(doc.Shots, func(i, j int) bool {
		if doc.Shots[i].Order == doc.Shots[j].Order { return doc.Shots[i].ID < doc.Shots[j].ID }
		return doc.Shots[i].Order < doc.Shots[j].Order
	})
	sort.SliceStable(doc.Assets, func(i, j int) bool { return doc.Assets[i].ID < doc.Assets[j].ID })
}

func validateProductionCanvases(doc model.ProductionDocument, records []model.CanvasProject) error {
	type node struct {
		ID string `json:"id"`
		Type string `json:"type"`
		Metadata struct {
			Status string `json:"status"`
			StorageKey string `json:"storageKey"`
			Content string `json:"content"`
		} `json:"metadata"`
	}
	type canvas struct { ID string `json:"id"`; WorkspaceID string `json:"workspaceId"`; Nodes []node `json:"nodes"` }
	nodes := map[string]map[string]node{}
	for _, record := range records {
		var data canvas
		if json.Unmarshal([]byte(record.ProjectData), &data) != nil || data.ID != record.ID {
			return productionError("账号画布数据无效，请重新保存画布后重试")
		}
		if (record.ID == doc.WorkspaceID && data.WorkspaceID != "") || (record.ID != doc.WorkspaceID && data.WorkspaceID != doc.WorkspaceID) {
			return productionError("制作计划只能引用本项目内的画布")
		}
		nodes[record.ID] = map[string]node{}
		for _, item := range data.Nodes { nodes[record.ID][item.ID] = item }
	}
	if nodes[doc.WorkspaceID] == nil { return productionError("请先将项目主画布保存到当前账号，再创建或保存制作计划") }
	for _, asset := range doc.Assets {
		for _, ref := range asset.References {
			switch nodes[ref.CanvasID][ref.NodeID].Type {
			case "text", "image", "panorama", "video", "audio":
			default: return productionError("资产引用的节点不存在、不可引用或尚未保存到账号")
			}
		}
	}
	for _, shot := range doc.Shots {
		if shot.CanvasID != "" {
			if nodes[shot.CanvasID] == nil { return productionError("镜头绑定画布不存在或尚未保存到当前账号") }
			for kind, id := range map[string]string{"text": shot.TextNodeID, "image": shot.ImageNodeID, "video": shot.VideoNodeID} {
				if id != "" && nodes[shot.CanvasID][id].Type != kind { return productionError("镜头绑定节点不存在或类型不符，请重新选择文字、图片或视频节点") }
			}
		}
		for _, candidate := range shot.Candidates {
			item, exists := nodes[candidate.CanvasID][candidate.NodeID]
			if !exists || item.Type != candidate.Kind { return productionError("候选结果节点不存在或类型不符，请重新保存候选结果") }
			if item.Metadata.Status == "loading" || item.Metadata.Status == "stopping" || item.Metadata.Status == "error" { return productionError("候选结果尚未完成或生成失败，请选择已完成的图片或视频") }
			if candidate.StorageKey != "" {
				if item.Metadata.StorageKey != candidate.StorageKey { return productionError("候选结果的文件已变化，请重新保存候选结果") }
			} else if item.Metadata.StorageKey != "" || item.Metadata.Content != candidate.Content {
				return productionError("候选结果的文件已变化，请重新保存候选结果")
			}
		}
	}
	return nil
}

func validProductionCandidateURL(value string) bool {
	if len(value) == 0 || len(value) > 4096 || strings.IndexFunc(value, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }) >= 0 { return false }
	parsed, err := url.Parse(value)
	return err == nil && (strings.EqualFold(parsed.Scheme, "http") || strings.EqualFold(parsed.Scheme, "https")) && parsed.Hostname() != ""
}
