package repository

import (
	"errors"
	"math"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrGatewayBalance = errors.New("算力不足或存在待补扣任务，请先充值")
var ErrGatewayConflict = errors.New("任务标识已被不同请求使用")

// Reservation, ledger and task are committed together. A retry never reserves twice.
func ReserveGatewayTask(task model.VideoTask, entry model.CreditLog) (model.VideoTask, bool, error) {
	db, err := DB(); if err != nil { return task,false,err }
	created := false
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := reserveTeamGenerationBudget(tx, &task); err != nil { return err }
		var user model.User
		if err := tx.Clauses(clause.Locking{Strength:"UPDATE"}).First(&user,"id = ?",task.UserID).Error; err != nil { return err }
		var existing model.VideoTask
		lookup := tx.First(&existing,"id = ?",task.ID).Error
		if lookup == nil {
			if existing.UserID != task.UserID || existing.GatewayRequestHash != task.GatewayRequestHash { return ErrGatewayConflict }
			task = existing; return nil
		}
		if !errors.Is(lookup,gorm.ErrRecordNotFound) { return lookup }
		if err := rejectProductionTaskReplay(tx, task.UserID, task.ID); err != nil { return err }
		if user.Status != model.UserStatusActive { return errors.New("账号不可用") }
		if task.RetryOf != "" {
			var original model.ProductionTaskRecord
			if err := tx.Where("record_id = ? AND user_id = ?", task.RetryOf, task.UserID).First(&original).Error; err != nil { return err }
			if !original.Gateway || original.Status != "failed" || (original.BillingStatus != "settled" && original.BillingStatus != "released") { return ErrGatewayConflict }
			var active int64
			if err := tx.Model(&model.ProductionTaskRecord{}).Where("user_id = ? AND retry_of = ?", task.UserID, task.RetryOf).Count(&active).Error; err != nil { return err }
			if active > 0 { return ErrGatewayConflict }
			var bound int64
			if err := tx.Table("production_task_links l").Joins("JOIN production_shots s ON s.project_id = l.project_id AND s.id = l.shot_id").Joins("JOIN production_projects p ON p.id = s.project_id AND p.user_id = l.user_id").Where("l.user_id = ? AND l.record_id = ? AND s.canvas_id = ? AND s.video_node_id = ?", task.UserID, task.RetryOf, task.CanvasID, task.SourceID).Count(&bound).Error; err != nil { return err }
			if bound == 0 { return ErrGatewayConflict }
		}
		var outstanding int64
		if err := tx.Model(&model.VideoTask{}).Where("user_id = ? AND billing_status = ?",task.UserID,"pending_balance").Count(&outstanding).Error; err != nil { return err }
		if outstanding > 0 { return ErrGatewayBalance }
		if task.ReservedCredits > 0 {
			debit := tx.Model(&model.User{}).Where("id = ? AND credits >= ?",task.UserID,task.ReservedCredits).Updates(map[string]any{"credits":gorm.Expr("ROUND(credits - CAST(? AS DECIMAL(20,2)), 2)",task.ReservedCredits),"updated_at":task.CreatedAt})
			if debit.Error != nil { return debit.Error }; if debit.RowsAffected != 1 { return ErrGatewayBalance }
		}
		if err := tx.First(&user,"id = ?",task.UserID).Error; err != nil { return err }
		entry.Balance = user.Credits
		if err := tx.Create(&entry).Error; err != nil { return err }
		if err := tx.Create(&task).Error; err != nil { return err }
		if err := bindTeamGenerationCanvas(tx, task); err != nil { return err }
		if err := captureProductionTask(tx, &task, true); err != nil { return err }
		created = true; return nil
	})
	return task,created,err
}

// Caller provides an authoritative result and final amount. nil amount only updates progress.
func ApplyGatewayTaskResult(task model.VideoTask, amount *float64, entry model.CreditLog) error {
	db, err := DB(); if err != nil { return err }
	return db.Transaction(func(tx *gorm.DB) error {
		var initial model.VideoTask
		if err := tx.First(&initial,"id = ?",task.ID).Error; err != nil { return err }
		if err := lockTeamGenerationSettlement(tx, initial); err != nil { return err }
		var payer model.User
		if err := tx.Clauses(clause.Locking{Strength:"UPDATE"}).First(&payer,"id = ?",initial.UserID).Error; err != nil { return err }
		var current model.VideoTask
		if err := tx.Clauses(clause.Locking{Strength:"UPDATE"}).First(&current,"id = ?",task.ID).Error; err != nil { return err }
		if current.BillingStatus == "settled" || current.BillingStatus == "released" { return nil }
		if current.ActualTokens > 0 && task.ActualTokens == 0 { return nil }
		if current.ActualUnits != nil && task.ActualUnits == nil { return nil }
		if amount != nil {
			delta := float64(int64(math.Round(*amount*100))-int64(math.Round(current.ReservedCredits*100)))/100
			balance := tx.Model(&model.User{}).Where("id = ?",current.UserID)
			if delta > 0 { balance = balance.Where("credits >= ?",delta) }
			applied := true
			if delta != 0 {
				result := balance.Updates(map[string]any{"credits":gorm.Expr("ROUND(credits - CAST(? AS DECIMAL(20,2)), 2)",delta),"updated_at":task.UpdatedAt})
				if result.Error != nil { return result.Error }; applied = result.RowsAffected == 1
			}
			if !applied {
				task.BillingStatus = "pending_balance"
			} else {
				var user model.User; if err := tx.First(&user,"id = ?",current.UserID).Error; err != nil { return err }
				task.SettledCredits = *amount
				entry.Amount = -delta; entry.Balance = user.Credits
				if delta < 0 { entry.Type = model.CreditLogTypeAIRefund } else { entry.Type = model.CreditLogTypeAIConsume }
				if err := tx.Create(&entry).Error; err != nil { return err }
			}
		}
		task.TeamApprovalID = current.TeamApprovalID
		if err := settleTeamGenerationBudget(tx, &task, amount); err != nil { return err }
		if err := tx.Model(&model.VideoTask{}).Where("id = ?",task.ID).Select("upstream_task_id","status","progress","video_url","error","error_detail","last_response","actual_tokens","actual_input_tokens","actual_output_tokens","actual_units","billing_status","settled_credits","completed_at","updated_at","last_polled_at").Updates(&task).Error; err != nil { return err }
		return captureProductionTask(tx, &task, false)
	})
}

func TouchGatewayTask(id, stamp string) error {
	db,err:=DB();if err!=nil{return err}
	return db.Model(&model.VideoTask{}).Where("id = ?",id).Update("last_polled_at",stamp).Error
}
