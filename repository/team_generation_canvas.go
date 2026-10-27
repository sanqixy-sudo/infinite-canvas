package repository

import (
    "encoding/json"
    "errors"
    "strconv"
    "time"

    gm "github.com/tigerowo/infinite-canvas/gateway/model"
    "github.com/tigerowo/infinite-canvas/model"
    "gorm.io/gorm"
)

var ErrTeamCanvasTask = errors.New("镜头视频节点不存在、类型已变化或仍有任务运行，请先打开画布确认")

type canvasJSON map[string]json.RawMessage

func canvasJSONString(value json.RawMessage) string { var text string; _ = json.Unmarshal(value, &text); return text }
func canvasJSONSet(value canvasJSON, key string, content any) { value[key], _ = json.Marshal(content) }

// Runs inside the reservation transaction while the payer's user row is locked.
// Only execution metadata changes; existing media, prompts and layout remain intact.
func bindTeamGenerationCanvas(tx *gorm.DB, task model.VideoTask) error {
    if task.TeamApprovalID == "" { return nil }
    var project model.CanvasProject
    if err := tx.Where("user_id = ? AND id = ? AND deleted_at = ''", task.UserID, task.CanvasID).First(&project).Error; err != nil { return ErrTeamCanvasTask }
    var document canvasJSON; var nodes []canvasJSON
    if json.Unmarshal([]byte(project.ProjectData), &document) != nil || json.Unmarshal(document["nodes"], &nodes) != nil { return ErrTeamCanvasTask }
    index := -1
    for i, node := range nodes { if canvasJSONString(node["id"]) == task.SourceID { if index != -1 { return ErrTeamCanvasTask }; index = i } }
    if index == -1 || canvasJSONString(nodes[index]["type"]) != "video" { return ErrTeamCanvasTask }
    metadata := canvasJSON{}
    if raw := nodes[index]["metadata"]; len(raw) > 0 && string(raw) != "null" { if json.Unmarshal(raw, &metadata) != nil { return ErrTeamCanvasTask } }
    if state := canvasJSONString(metadata["status"]); state == "loading" || state == "stopping" {
        id := canvasJSONString(metadata["videoTaskId"]); var previous model.VideoTask
        if err := tx.Where("id = ? AND user_id = ?", id, task.UserID).First(&previous).Error; err != nil { return ErrTeamCanvasTask }
        if previous.Status != "completed" && previous.Status != "succeeded" && previous.Status != "failed" && previous.Status != "cancelled" && previous.Status != "canceled" { return ErrTeamCanvasTask }
    }
    for _, key := range []string{"videoTaskVideoId", "videoTaskTranslation", "workflowRef", "actualTokens", "actualInputTokens", "actualOutputTokens", "settledCredits", "tokenMode", "errorDetails", "accountSaveError"} { delete(metadata, key) }
    stamp := time.Now().UTC()
    if previous, err := time.Parse(time.RFC3339Nano, project.UpdatedAt); err == nil && !stamp.After(previous) { stamp = previous.Add(time.Millisecond) }
    values := map[string]any{"teamApprovalId": task.TeamApprovalID, "clientTaskId": task.TeamApprovalID, "taskBackend": "account", "videoTaskId": task.ID, "videoTaskStatus": task.Status, "status": "loading", "model": task.Model, "channelId": "model-gateway", "billingStatus": task.BillingStatus, "reservedCredits": task.ReservedCredits, "startedAt": stamp.UnixMilli(), "progress": 0}
    var request gm.Request
    if json.Unmarshal([]byte(task.RequestBody), &request) != nil { return ErrTeamCanvasTask }
    if request.Parameters.Duration > 0 { values["size"], values["seconds"], values["vquality"] = request.Parameters.Ratio, strconv.Itoa(request.Parameters.Duration), request.Parameters.Resolution }
    if request.Parameters.GenerateAudio != nil { values["generateAudio"] = strconv.FormatBool(*request.Parameters.GenerateAudio) } else { delete(metadata, "generateAudio") }
    for key, value := range values { canvasJSONSet(metadata, key, value) }
    canvasJSONSet(nodes[index], "metadata", metadata); canvasJSONSet(document, "nodes", nodes)
    project.UpdatedAt = stamp.Format("2006-01-02T15:04:05.000Z"); canvasJSONSet(document, "updatedAt", project.UpdatedAt)
    data, err := json.Marshal(document); if err != nil { return err }; project.ProjectData = string(data)
    return tx.Model(&model.CanvasProject{}).Where("user_id = ? AND id = ? AND deleted_at = ''", task.UserID, task.CanvasID).Updates(map[string]any{"project_data": project.ProjectData, "updated_at": project.UpdatedAt}).Error
}

// A delayed browser save must not detach an active approval task. Only copy its
// execution fields; accept the browser's latest text, existing media and layout.
func preserveTeamCanvasTasks(tx *gorm.DB, current model.CanvasProject, next *model.CanvasProject) error {
    var oldDocument, document canvasJSON; var previous, nodes []canvasJSON
    if json.Unmarshal([]byte(current.ProjectData), &oldDocument) != nil || json.Unmarshal(oldDocument["nodes"], &previous) != nil { return nil }
    if json.Unmarshal([]byte(next.ProjectData), &document) != nil || json.Unmarshal(document["nodes"], &nodes) != nil { return ErrTeamCanvasTask }
    changed := false
    for _, old := range previous {
        var metadata canvasJSON
        if json.Unmarshal(old["metadata"], &metadata) != nil || canvasJSONString(metadata["teamApprovalId"]) == "" { continue }
        id := canvasJSONString(metadata["videoTaskId"]); var task model.VideoTask
        err := tx.Where("id = ? AND user_id = ? AND team_approval_id <> ''", id, current.UserID).First(&task).Error
        if errors.Is(err, gorm.ErrRecordNotFound) { continue }; if err != nil { return err }
        if task.Status == "completed" || task.Status == "succeeded" || task.Status == "failed" || task.Status == "cancelled" || task.Status == "canceled" { continue }
        found := false
        for _, node := range nodes {
            if canvasJSONString(node["id"]) != canvasJSONString(old["id"]) { continue }
            if found || canvasJSONString(node["type"]) != "video" { return ErrTeamCanvasTask }; found = true
            incoming := canvasJSON{}
            if raw := node["metadata"]; len(raw) > 0 && string(raw) != "null" { if json.Unmarshal(raw, &incoming) != nil { return ErrTeamCanvasTask } }
            if canvasJSONString(incoming["videoTaskId"]) == id { continue }
            for _, key := range []string{"teamApprovalId", "clientTaskId", "taskBackend", "videoTaskId", "videoTaskStatus", "videoTaskVideoId", "videoTaskTranslation", "workflowRef", "status", "model", "channelId", "size", "seconds", "vquality", "generateAudio", "billingStatus", "reservedCredits", "settledCredits", "tokenMode", "actualTokens", "actualInputTokens", "actualOutputTokens", "startedAt", "progress", "errorDetails", "accountSaveError"} {
                if value, exists := metadata[key]; exists { incoming[key] = value } else { delete(incoming, key) }
            }
            canvasJSONSet(node, "metadata", incoming); changed = true
        }
        if !found { return ErrTeamCanvasTask }
    }
    if !changed { return nil }; canvasJSONSet(document, "nodes", nodes)
    data, err := json.Marshal(document); if err != nil { return err }; next.ProjectData = string(data); return nil
}
