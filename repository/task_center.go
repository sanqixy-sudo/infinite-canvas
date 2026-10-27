package repository

import (
	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
)

// Every UNION branch is independently scoped. History only fills missing live tasks.
func taskCenterQuery(db *gorm.DB, userID string, q model.Query, status string) *gorm.DB {
	query := db.Table(`(?) AS tasks`, db.Raw(`
SELECT id, 'image' AS kind, '' AS title, model, status, progress, source, source_id AS canvas_id, node_id,
'' AS workspace_id, '' AS episode_id, CASE WHEN workflow_ref <> '' THEN 1 ELSE 0 END AS workflow,
0 AS gateway, 0 AS archived, error, 'unknown' AS billing_status, NULL AS reserved_credits, NULL AS settled_credits, created_at, updated_at
FROM canvas_image_tasks WHERE user_id = ?
UNION ALL
SELECT id, 'audio', '', model, status, progress, source, source_id, node_id, '', '',
CASE WHEN workflow_ref <> '' THEN 1 ELSE 0 END, 0, 0, error, 'unknown', NULL, NULL, created_at, updated_at
FROM canvas_audio_tasks WHERE user_id = ?
UNION ALL
SELECT id, 'video', '', model, status, progress, source, canvas_id, source_id, '', '',
CASE WHEN workflow_ref <> '' THEN 1 ELSE 0 END, CASE WHEN gateway_snapshot <> '' THEN 1 ELSE 0 END, 0, error,
CASE WHEN gateway_snapshot <> '' THEN billing_status ELSE 'unknown' END,
CASE WHEN gateway_snapshot <> '' THEN reserved_credits ELSE NULL END,
CASE WHEN gateway_snapshot <> '' AND billing_status IN ('settled','released') THEN settled_credits ELSE NULL END, created_at, updated_at
FROM video_tasks WHERE user_id = ?
UNION ALL
SELECT id, 'render', episode_title, '', status, progress, 'production', '', '', workspace_id, episode_id,
0, 0, 0, error, 'no_charge', NULL, 0, created_at, updated_at
FROM production_render_jobs WHERE user_id = ?
UNION ALL
SELECT h.id, h.kind, '', h.model, h.status, h.progress, 'canvas', h.canvas_id, h.node_id, '', '',
0, CASE WHEN h.gateway THEN 1 ELSE 0 END, 1, '', h.billing_status, h.reserved_credits, h.settled_credits, h.created_at, h.updated_at
FROM production_task_records h WHERE h.user_id = ? AND
((h.kind = 'image' AND NOT EXISTS (SELECT 1 FROM canvas_image_tasks t WHERE t.user_id = h.user_id AND t.id = h.id)) OR
 (h.kind = 'audio' AND NOT EXISTS (SELECT 1 FROM canvas_audio_tasks t WHERE t.user_id = h.user_id AND t.id = h.id)) OR
 (h.kind = 'video' AND NOT EXISTS (SELECT 1 FROM video_tasks t WHERE t.user_id = h.user_id AND t.id = h.id)))
`, userID, userID, userID, userID, userID))
	if q.Type != "" {
		query = query.Where("kind = ?", q.Type)
	}
	if q.Keyword != "" {
		query = query.Where("(LOWER(model) LIKE LOWER(?) OR LOWER(id) LIKE LOWER(?) OR LOWER(title) LIKE LOWER(?))", "%"+q.Keyword+"%", "%"+q.Keyword+"%", "%"+q.Keyword+"%")
	}
	switch status {
	case "active":
		query = query.Where("status IN ?", []string{"queued", "submitting", "processing", "running", "in_progress"})
	case "attention":
		query = query.Where("status IN ? OR billing_status IN ?", []string{"failed", "unknown"}, []string{"pending_usage", "pending_balance"})
	case "completed", "failed", "cancelled", "unknown":
		query = query.Where("status = ?", status)
	}
	return query
}

func ListUserTaskCenter(userID string, q model.Query, status string) (*model.TaskCenterList, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	result := &model.TaskCenterList{Items: []model.TaskCenterItem{}, Page: q.Page, PageSize: q.PageSize}
	if err := taskCenterQuery(db, userID, q, status).Count(&result.Total).Error; err != nil {
		return nil, err
	}
	if err := taskCenterQuery(db, userID, q, status).Order("created_at DESC, kind ASC, id DESC").Offset(q.Offset()).Limit(q.PageSize).Scan(&result.Items).Error; err != nil {
		return nil, err
	}
	for i := range result.Items {
		item := &result.Items[i]
		if item.Kind != "render" {
			record := model.ProductionTaskRecord{ID: item.ID, UserID: userID, Kind: item.Kind, Gateway: item.Gateway, Status: item.Status, BillingStatus: item.BillingStatus, SettledCredits: item.SettledCredits}
			if err := fillProductionLedger(db, &record); err != nil {
				return nil, err
			}
			item.ChargedCredits, item.RefundedCredits, item.NetCredits, item.SettledCredits, item.BillingStatus = record.ChargedCredits, record.RefundedCredits, record.NetCredits, record.SettledCredits, record.BillingStatus
			var link model.ProductionTaskLink
			if err := db.Table("production_task_links l").Select("l.workspace_id, l.episode_id, l.shot_title").Joins("JOIN production_task_records r ON r.record_id = l.record_id AND r.user_id = l.user_id").Where("l.user_id = ? AND r.kind = ? AND r.id = ?", userID, item.Kind, item.ID).Order("l.workspace_id, l.episode_id, l.shot_id").Limit(1).Scan(&link).Error; err != nil {
				return nil, err
			}
			item.WorkspaceID, item.EpisodeID, item.Title = link.WorkspaceID, link.EpisodeID, link.ShotTitle
		}
		// A stale history link must not lead to someone else's or a deleted project.
		if item.CanvasID != "" {
			var count int64
			if err := db.Model(&model.CanvasProject{}).Where("user_id = ? AND id = ? AND deleted_at = ''", userID, item.CanvasID).Count(&count).Error; err != nil {
				return nil, err
			}
			if count == 0 {
				item.CanvasID, item.NodeID = "", ""
			}
		}
		if item.WorkspaceID != "" {
			var count int64
			if err := db.Model(&model.ProductionProject{}).Where("user_id = ? AND workspace_id = ?", userID, item.WorkspaceID).Count(&count).Error; err != nil {
				return nil, err
			}
			if count == 0 {
				item.WorkspaceID, item.EpisodeID = "", ""
			}
		}
	}
	return result, nil
}
