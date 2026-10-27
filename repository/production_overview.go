package repository

import (
	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
	"strings"
)

func ListUserProductionOverview(userID string, q model.Query) (model.ProductionOverviewList, error) {
	db, err := DB()
	if err != nil {
		return model.ProductionOverviewList{}, err
	}
	return listUserProductionOverview(db, userID, q)
}

func listUserProductionOverview(db *gorm.DB, userID string, q model.Query) (model.ProductionOverviewList, error) {
	result := model.ProductionOverviewList{Items: []model.ProductionOverview{}, Page: q.Page, PageSize: q.PageSize}
	query := db.Model(&model.ProductionProject{}).Where("user_id = ?", userID)
	if q.Keyword != "" {
		query = query.Where("LOWER(title) LIKE ?", "%"+strings.ToLower(q.Keyword)+"%")
	}
	if err := query.Count(&result.Total).Error; err != nil {
		return result, err
	}
	projects := []model.ProductionProject{}
	if err := query.Order("updated_at DESC, id DESC").Offset(q.Offset()).Limit(q.PageSize).Find(&projects).Error; err != nil {
		return result, err
	}
	if len(projects) == 0 {
		return result, nil
	}
	ids, workspaces := []string{}, []string{}
	for _, project := range projects {
		ids = append(ids, project.ID)
		workspaces = append(workspaces, project.WorkspaceID)
	}
	type count struct {
		ProjectID string
		Total     int64
	}
	counts := make([]map[string]int64, 4)
	for i, table := range []any{&model.ProductionEpisode{}, &model.ProductionShot{}, &model.ProductionAsset{}, &model.ProductionShot{}} {
		rows := []count{}
		query := db.Model(table).Select("project_id, COUNT(*) AS total").Where("project_id IN ?", ids)
		if i == 3 {
			query = query.Where("selected_image_candidate_id <> '' OR selected_video_candidate_id <> ''")
		}
		if err := query.Group("project_id").Scan(&rows).Error; err != nil {
			return result, err
		}
		counts[i] = map[string]int64{}
		for _, row := range rows {
			counts[i][row.ProjectID] = row.Total
		}
	}
	var renders []struct {
		WorkspaceID string
		Total       int64
	}
	if err := db.Model(&model.ProductionRenderJob{}).Select("workspace_id, COUNT(*) AS total").Where("user_id = ? AND workspace_id IN ? AND status = ?", userID, workspaces, "completed").Group("workspace_id").Scan(&renders).Error; err != nil {
		return result, err
	}
	renderCounts := map[string]int64{}
	for _, row := range renders {
		renderCounts[row.WorkspaceID] = row.Total
	}
	for _, project := range projects {
		result.Items = append(result.Items, model.ProductionOverview{ProductionProject: project, EpisodeCount: counts[0][project.ID], ShotCount: counts[1][project.ID], AssetCount: counts[2][project.ID], SelectedShotCount: counts[3][project.ID], RenderCount: renderCounts[project.WorkspaceID]})
	}
	return result, nil
}

func ListUserProductionDeliveries(userID string, q model.Query, workspaceID string) (model.ProductionDeliveryList, error) {
	db, err := DB()
	if err != nil {
		return model.ProductionDeliveryList{}, err
	}
	return listUserProductionDeliveries(db, userID, q, workspaceID)
}

func listUserProductionDeliveries(db *gorm.DB, userID string, q model.Query, workspaceID string) (model.ProductionDeliveryList, error) {
	result := model.ProductionDeliveryList{Items: []model.ProductionDeliveryItem{}, Page: q.Page, PageSize: q.PageSize}
	query := db.Model(&model.ProductionRenderJob{}).Where("user_id = ? AND workspace_id <> ''", userID)
	if workspaceID != "" {
		query = query.Where("workspace_id = ?", workspaceID)
	}
	if q.Type != "" {
		query = query.Where("status = ?", q.Type)
	}
	if q.Keyword != "" {
		query = query.Where("LOWER(episode_title) LIKE ?", "%"+strings.ToLower(q.Keyword)+"%")
	}
	if err := query.Count(&result.Total).Error; err != nil {
		return result, err
	}
	jobs := []model.ProductionRenderJob{}
	if err := query.Order("created_at DESC, id DESC").Offset(q.Offset()).Limit(q.PageSize).Find(&jobs).Error; err != nil {
		return result, err
	}
	if len(jobs) == 0 {
		return result, nil
	}
	workspaces, fileIDs := []string{}, []string{}
	for _, job := range jobs {
		workspaces = append(workspaces, job.WorkspaceID)
		if strings.HasPrefix(job.OutputStorageKey, "server:") {
			fileIDs = append(fileIDs, strings.TrimPrefix(job.OutputStorageKey, "server:"))
		}
	}
	var projects []model.ProductionProject
	if err := db.Select("workspace_id", "title").Where("user_id = ? AND workspace_id IN ?", userID, workspaces).Find(&projects).Error; err != nil {
		return result, err
	}
	titles := map[string]string{}
	for _, project := range projects {
		titles[project.WorkspaceID] = project.Title
	}
	files := []model.StorageObject{}
	if len(fileIDs) > 0 {
		if err := db.Select("id").Where("created_by = ? AND id IN ? AND (deleted_at = '' OR deleted_at IS NULL) AND mime_type LIKE ?", userID, fileIDs, "video/%").Find(&files).Error; err != nil {
			return result, err
		}
	}
	available := map[string]bool{}
	for _, file := range files {
		available["server:"+file.ID] = true
	}
	for _, job := range jobs {
		result.Items = append(result.Items, model.ProductionDeliveryItem{ProductionRenderJob: job, ProjectTitle: titles[job.WorkspaceID], FileAvailable: available[job.OutputStorageKey]})
	}
	return result, nil
}
