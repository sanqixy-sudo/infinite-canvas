package repository

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrProductionTaskReplay = errors.New("任务标识已存在历史记录，请查看原任务；再次生成需新建任务")
var ErrProductionLedgerReadOnly = errors.New("已关联镜头成本的扣退流水不可修改或删除")

func productionRecordID(userID, kind, id string) string {
	digest := sha256.Sum256([]byte(userID + "\x00" + kind + "\x00" + id))
	return kind + ":" + hex.EncodeToString(digest[:])
}

func rejectProductionTaskReplay(tx *gorm.DB, userID, id string) error {
	var count int64
	if err := tx.Model(&model.ProductionTaskRecord{}).Where("user_id = ? AND id = ?", userID, id).Count(&count).Error; err != nil { return err }
	if count > 0 { return ErrProductionTaskReplay }
	return nil
}

func productionCredit(value float64) *float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 { return nil }
	value = math.Round(value * 100) / 100
	return &value
}

func productionTaskRecord(task any) (model.ProductionTaskRecord, bool) {
	r := model.ProductionTaskRecord{BillingStatus: "unknown", BillingUnit: "recorded_charge", DispatchStatus: "submitted", Attempt: 1}
	switch t := task.(type) {
	case *model.CanvasAudioTask:
		if t.Source!="canvas" || !strings.HasPrefix(t.ID,"production_voice_"){return r,false}
		r.ID,r.UserID,r.Kind,r.CanvasID,r.NodeID=t.ID,t.UserID,"audio",t.SourceID,t.NodeID
		r.Model,r.Status,r.Progress,r.CreatedAt,r.UpdatedAt,r.CompletedAt=t.Model,t.Status,t.Progress,t.CreatedAt,t.UpdatedAt,t.CompletedAt
		if t.Status=="queued"{r.DispatchStatus="waiting"}
	case *model.CanvasImageTask:
		if t.Source != "canvas" { return r, false }
		r.ID, r.UserID, r.Kind, r.CanvasID, r.NodeID = t.ID, t.UserID, "image", t.SourceID, t.NodeID
		r.Model, r.Status, r.Progress, r.CreatedAt, r.UpdatedAt, r.CompletedAt = t.Model, t.Status, t.Progress, t.CreatedAt, t.UpdatedAt, t.CompletedAt
		if t.Status == "queued" { r.DispatchStatus = "waiting" }
	case *model.VideoTask:
		if t.Source != "canvas" { return r, false }
		r.ID, r.UserID, r.Kind, r.CanvasID, r.NodeID = t.ID, t.UserID, "video", t.CanvasID, t.SourceID
		r.Model, r.Status, r.Progress, r.CreatedAt, r.UpdatedAt, r.CompletedAt = t.Model, t.Status, t.Progress, t.CreatedAt, t.UpdatedAt, t.CompletedAt
		r.RetryOf, r.Attempt = t.RetryOf, max(1, t.Attempt)
		r.Gateway = t.GatewaySnapshot != ""
		if r.Gateway {
			r.BillingUnit, r.BillingStatus = t.BillingUnit, t.BillingStatus;if r.BillingUnit==""{r.BillingUnit="token"}
			r.ReservedCredits = productionCredit(t.ReservedCredits)
			if t.UpstreamTaskID == "" { r.DispatchStatus = "waiting" }
			if t.BillingStatus == "settled" || t.BillingStatus == "released" { r.SettledCredits = productionCredit(t.SettledCredits) }
			if t.BillingStatus == "settled" || t.BillingStatus == "pending_balance" {
				r.ActualUnits=t.ActualUnits
				if r.BillingUnit=="token" {
					if t.ActualTokens >= 0 { v := t.ActualTokens; r.ActualTokens = &v }
					if t.ActualInputTokens != nil && *t.ActualInputTokens >= 0 { r.ActualInputTokens = t.ActualInputTokens }
					if t.ActualOutputTokens != nil && *t.ActualOutputTokens >= 0 { r.ActualOutputTokens = t.ActualOutputTokens }
				}
			}
		}
	default: return r, false
	}
	if r.CanvasID == "" || r.NodeID == "" { return r, false }
	r.RecordID = productionRecordID(r.UserID, r.Kind, r.ID)
	if r.Status == "submitting" { r.DispatchStatus = "submitting" }
	if r.Status == "unknown" { r.DispatchStatus = "unknown" }
	if r.Status == "completed" || r.Status == "failed" || r.Status == "cancelled" { r.DispatchStatus = "finished" }
	return r, true
}

// Called inside the task write transaction. Never reads or stores credentials or request bodies.
func captureProductionTask(tx *gorm.DB, task any, bind bool) error {
	r, ok := productionTaskRecord(task)
	if !ok { return nil }
	var existing model.ProductionTaskRecord
	err := tx.First(&existing, "record_id = ? AND user_id = ?", r.RecordID, r.UserID).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) { return err }
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if !bind { return nil }
		var links []model.ProductionTaskLink
		nodeColumn := "s.image_node_id"
		if r.Kind == "video" { nodeColumn = "s.video_node_id" }
		query:=tx.Table("production_shots s").Select("s.project_id, s.id AS shot_id, p.user_id, p.workspace_id, s.episode_id, s.title AS shot_title").Joins("JOIN production_projects p ON p.id = s.project_id")
		if r.Kind=="audio"{query=query.Where("p.user_id = ? AND p.workspace_id = ? AND s.id = ?",r.UserID,r.CanvasID,r.NodeID)}else{query=query.Where("p.user_id = ? AND s.canvas_id = ? AND " + nodeColumn + " = ?", r.UserID, r.CanvasID, r.NodeID)}
		err=query.Scan(&links).Error
		if err != nil || len(links) == 0 { return err }
		for i := range links { links[i].RecordID = r.RecordID }
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&links).Error; err != nil { return err }
	} else { r.CreatedAt = existing.CreatedAt }
	if err := fillProductionLedger(tx, &r); err != nil { return err }
	return tx.Save(&r).Error
}

func fillProductionLedger(tx *gorm.DB, record *model.ProductionTaskRecord) error {
	var logs []model.CreditLog
	ledgerID := record.ID
	if !record.Gateway { ledgerID = record.Kind + ":" + record.ID }
	if err := tx.Select("type, amount").Where("user_id = ? AND related_id = ? AND type IN ?", record.UserID, ledgerID, []model.CreditLogType{model.CreditLogTypeAIConsume, model.CreditLogTypeAIRefund}).Find(&logs).Error; err != nil { return err }
	if len(logs) == 0 { return nil }
	charged, refunded := 0.0, 0.0
	for _, log := range logs {
		if math.IsNaN(log.Amount) || math.IsInf(log.Amount, 0) { return nil }
		if log.Type == model.CreditLogTypeAIConsume && log.Amount <= 0 { charged -= log.Amount }
		if log.Type == model.CreditLogTypeAIRefund && log.Amount >= 0 { refunded += log.Amount }
	}
	record.ChargedCredits, record.RefundedCredits, record.NetCredits = productionCredit(charged), productionCredit(refunded), productionCredit(charged - refunded)
	if !record.Gateway {
		record.BillingStatus = "charged"
		if record.Status == "completed" || record.Status == "failed" || record.Status == "cancelled" {
			record.SettledCredits = record.NetCredits
			record.BillingStatus = "settled"
			if charged > 0 && record.NetCredits != nil && *record.NetCredits == 0 { record.BillingStatus = "released" }
		}
	}
	return nil
}

func productionLedgerRecords(tx *gorm.DB, userID, taskID string) *gorm.DB {
	query := tx.Where("user_id = ?", userID)
	if kind, id, ok := strings.Cut(taskID, ":"); ok && (kind == "image" || kind == "video" || kind == "audio") { query = query.Where("kind = ? AND id = ? AND gateway = ?", kind, id, false) } else { query = query.Where("id = ? AND gateway = ?", taskID, true) }
	return query
}

func rejectProductionLedgerEdit(tx *gorm.DB, log model.CreditLog) error {
	if log.RelatedID == "" { return nil }
	var count int64
	if err := productionLedgerRecords(tx, log.UserID, log.RelatedID).Model(&model.ProductionTaskRecord{}).Count(&count).Error; err != nil { return err }
	if count > 0 { return ErrProductionLedgerReadOnly }; return nil
}

func refreshProductionLedger(tx *gorm.DB, userID, taskID string) error {
	if taskID == "" { return nil }
	var records []model.ProductionTaskRecord
	if err := productionLedgerRecords(tx, userID, taskID).Find(&records).Error; err != nil { return err }
	for _, record := range records {
		if err := fillProductionLedger(tx, &record); err != nil { return err }
		if err := tx.Model(&record).Select("charged_credits", "refunded_credits", "net_credits", "settled_credits", "billing_status").Updates(&record).Error; err != nil { return err }
	}
	return nil
}

func ListProductionTaskHistory(userID, workspaceID, episodeID string) ([]model.ProductionTaskRecord, []model.ProductionTaskLink, error) {
	db, err := DB(); if err != nil { return nil, nil, err }
	var links []model.ProductionTaskLink
	query := db.Where("user_id = ? AND workspace_id = ?", userID, workspaceID)
	if episodeID != "" { query = query.Where("episode_id = ?", episodeID) }
	if err := query.Order("episode_id, shot_id").Find(&links).Error; err != nil { return nil, nil, err }
	var records []model.ProductionTaskRecord
	scope := db.Model(&model.ProductionTaskLink{}).Select("record_id").Where("user_id = ? AND workspace_id = ?", userID, workspaceID)
	if episodeID != "" { scope = scope.Where("episode_id = ?", episodeID) }
	err = db.Where("user_id = ? AND record_id IN (?)", userID, scope).Order("created_at DESC, record_id DESC").Find(&records).Error
	return records, links, err
}

func GetProductionTaskHistory(userID, workspaceID, recordID string) (model.ProductionTaskRecord, []model.ProductionTaskLink, error) {
	db, err := DB(); if err != nil { return model.ProductionTaskRecord{}, nil, err }
	var record model.ProductionTaskRecord
	var links []model.ProductionTaskLink
	err = db.Where("user_id = ? AND workspace_id = ? AND record_id = ?", userID, workspaceID, recordID).Find(&links).Error
	if err != nil { return record, nil, err }; if len(links) == 0 { return record, nil, gorm.ErrRecordNotFound }
	err = db.Where("user_id = ? AND record_id = ?", userID, recordID).First(&record).Error
	return record, links, err
}

func HasPendingProductionRetry(userID, recordID string) (bool, error) {
	db, err := DB(); if err != nil { return false, err }
	var count int64
	err = db.Model(&model.ProductionTaskRecord{}).Where("user_id = ? AND retry_of = ?", userID, recordID).Count(&count).Error
	return count > 0, err
}

func ListProductionRetryParents(userID, workspaceID string) ([]string, error) {
	db, err := DB(); if err != nil { return nil, err }
	var parents []string
	scope := db.Model(&model.ProductionTaskLink{}).Select("record_id").Where("user_id = ? AND workspace_id = ?", userID, workspaceID)
	err = db.Model(&model.ProductionTaskRecord{}).Where("user_id = ? AND retry_of <> '' AND retry_of IN (?)", userID, scope).Distinct().Pluck("retry_of", &parents).Error
	return parents, err
}

func RefreshProductionTask(tx *gorm.DB, kind, userID, id string) error {
	if kind=="audio"{var task model.CanvasAudioTask;if err:=tx.Where("user_id = ? AND id = ?",userID,id).First(&task).Error;err!=nil{return err};return captureProductionTask(tx,&task,false)}
	if kind == "image" {
		var task model.CanvasImageTask
		if err := tx.Where("user_id = ? AND id = ?", userID, id).First(&task).Error; err != nil { return err }
		return captureProductionTask(tx, &task, false)
	}
	if kind == "video" {
		var task model.VideoTask
		if err := tx.Where("user_id = ? AND id = ?", userID, id).First(&task).Error; err != nil { return err }
		return captureProductionTask(tx, &task, false)
	}
	return nil
}

// Called once during service startup. Ordinary synchronous image execution cannot be replayed safely.
func MarkInterruptedProductionTasks(stamp string) error {
	db, err := DB(); if err != nil { return err }
	return db.Transaction(func(tx *gorm.DB) error {
		var audios []model.CanvasAudioTask
		if err:=tx.Where("id LIKE ? AND (workflow_ref = '' OR workflow_ref IS NULL) AND status IN ?","production_voice_%",[]string{"queued","processing","running","in_progress"}).Find(&audios).Error;err!=nil{return err}
		for _,task:=range audios{if !strings.HasPrefix(task.ID,"production_voice_"){continue};if err:=tx.Model(&task).Updates(map[string]any{"status":"unknown","updated_at":stamp}).Error;err!=nil{return err};task.Status,task.UpdatedAt="unknown",stamp;if err:=captureProductionTask(tx,&task,false);err!=nil{return err}}
		var images []model.CanvasImageTask
		if err := tx.Where("(workflow_ref = '' OR workflow_ref IS NULL) AND status IN ?", []string{"queued", "processing", "running", "in_progress"}).Find(&images).Error; err != nil { return err }
		for _, task := range images {
			if err := tx.Model(&task).Updates(map[string]any{"status": "unknown", "updated_at": stamp}).Error; err != nil { return err }
			task.Status, task.UpdatedAt = "unknown", stamp
			if err := captureProductionTask(tx, &task, false); err != nil { return err }
		}
		var videos []model.VideoTask
		if err := tx.Where("status = 'submitting' AND (gateway_snapshot = '' OR gateway_snapshot IS NULL)").Find(&videos).Error; err != nil { return err }
		for _, task := range videos {
			if err := tx.Model(&task).Updates(map[string]any{"status": "unknown", "updated_at": stamp}).Error; err != nil { return err }
			task.Status, task.UpdatedAt = "unknown", stamp
			if err := captureProductionTask(tx, &task, false); err != nil { return err }
		}
		return nil
	})
}
