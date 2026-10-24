package repository

import "github.com/tigerowo/infinite-canvas/model"

// Read only tasks belonging to the account plan's current shot bindings.
func ListProductionShotTasks(userID, projectID string, limit int) ([]model.CanvasImageTask, []model.VideoTask, error) {
	db, err := DB()
	if err != nil { return nil, nil, err }
	var images []model.CanvasImageTask
	var videos []model.VideoTask
	imageScope := `EXISTS (SELECT 1 FROM production_shots s JOIN production_projects p ON p.id = s.project_id WHERE p.id = ? AND p.user_id = ? AND s.canvas_id = canvas_image_tasks.source_id AND s.image_node_id = canvas_image_tasks.node_id)`
	videoScope := `EXISTS (SELECT 1 FROM production_shots s JOIN production_projects p ON p.id = s.project_id WHERE p.id = ? AND p.user_id = ? AND s.video_node_id = video_tasks.source_id AND s.canvas_id = video_tasks.canvas_id AND s.canvas_id <> '')`
	err = db.Select("id, source_id, node_id, model, status, progress, created_at").Where("user_id = ? AND source = ?", userID, "canvas").Where(imageScope, projectID, userID).Order("created_at DESC, id DESC").Limit(limit).Find(&images).Error
	if err != nil { return nil, nil, err }
	err = db.Select("id, source_id, canvas_id, model, status, progress, created_at, billing_status, reserved_credits, settled_credits, actual_tokens, actual_input_tokens, actual_output_tokens, CASE WHEN gateway_snapshot IS NOT NULL AND gateway_snapshot <> '' THEN 'gateway' ELSE '' END AS gateway_snapshot").Where("user_id = ? AND source = ?", userID, "canvas").Where(videoScope, projectID, userID).Order("created_at DESC, id DESC").Limit(limit).Find(&videos).Error
	return images, videos, err
}
