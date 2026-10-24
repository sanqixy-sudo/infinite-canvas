package repository

import (
    "errors"
    "math"
    "github.com/tigerowo/infinite-canvas/model"
    "gorm.io/gorm"
    "gorm.io/gorm/clause"
)

var ErrTeamBudget = errors.New("项目审批预算不足、尚未设置，或审批状态已变化")

// Approval history remains relevant after a share is revoked or a task row expires.
func ListProductionTeamApprovalTasks(userID, workspaceID string) ([]string, error) {
    db, err := DB(); if err != nil { return nil, err }
    var ids []string
    err = db.Table("team_generation_approvals a").Joins("JOIN team_projects p ON p.id = a.project_id").Where("a.payer_id = ? AND p.owner_user_id = ? AND p.workspace_id = ? AND a.task_id <> ''", userID, userID, workspaceID).Pluck("a.task_id", &ids).Error
    return ids, err
}

func TeamGenerationList(projectID string,q model.Query,validate TeamProjectValidator)(model.TeamGenerationBudget,[]model.TeamGenerationApproval,int64,error){
    db,err:=DB();var budget model.TeamGenerationBudget;rows:=[]model.TeamGenerationApproval{};var total int64;if err!=nil{return budget,rows,total,err}
    err=db.Transaction(func(tx *gorm.DB)error{if _,err:=ValidateTeamProjectTx(tx,projectID,validate);err!=nil{return err};if err:=tx.Where("project_id = ?",projectID).Find(&budget).Error;err!=nil{return err};query:=tx.Model(&model.TeamGenerationApproval{}).Where("project_id = ?",projectID);if err:=query.Count(&total).Error;err!=nil{return err};return query.Order("created_at DESC, id DESC").Offset(q.Offset()).Limit(q.PageSize).Find(&rows).Error});return budget,rows,total,err
}

func SetTeamGenerationBudget(projectID string,limit float64,validate TeamProjectValidator,audit *model.TeamAudit)error{
    db,err:=DB();if err!=nil{return err};return db.Transaction(func(tx *gorm.DB)error{project,err:=ValidateTeamProjectTx(tx,projectID,validate);if err!=nil{return err};var current model.TeamGenerationBudget;if err:=tx.Where("project_id = ?",projectID).Find(&current).Error;err!=nil{return err};if limit<current.HeldCredits+current.SpentCredits{return ErrTeamBudget};current.ProjectID,current.LimitCredits=projectID,limit;if err:=tx.Save(&current).Error;err!=nil{return err};audit.TeamID=project.TeamID;return AppendTeamAudit(tx,audit)})
}

func CreateTeamGenerationApproval(row *model.TeamGenerationApproval,revision int64,validate TeamProjectValidator,audit *model.TeamAudit)error{
    db,err:=DB();if err!=nil{return err};return db.Transaction(func(tx *gorm.DB)error{
        project,err:=ValidateTeamProjectTx(tx,row.ProjectID,validate);if err!=nil{return err};var existing model.TeamGenerationApproval
        if err:=tx.Where("id = ?",row.ID).First(&existing).Error;err==nil{if existing.RequestHash!=row.RequestHash{return ErrGatewayConflict};*row=existing;return nil}else if !errors.Is(err,gorm.ErrRecordNotFound){return err}
        var payer model.User;if err:=tx.Clauses(clause.Locking{Strength:"UPDATE"}).Where("id = ?",project.OwnerUserID).First(&payer).Error;err!=nil{return err}
        var plan model.ProductionProject;if err:=tx.Where("user_id = ? AND workspace_id = ? AND revision = ?",project.OwnerUserID,project.WorkspaceID,revision).First(&plan).Error;err!=nil{return err}
        var shot model.ProductionShot;if err:=tx.Where("project_id = ? AND id = ?",plan.ID,row.ShotID).First(&shot).Error;err!=nil{return err}
        if shot.CanvasID!=row.CanvasID||shot.VideoNodeID!=row.NodeID{return ErrProductionConflict}
        if err:=tx.Create(row).Error;err!=nil{return err};audit.TeamID=project.TeamID;return AppendTeamAudit(tx,audit)
    })
}

func UpdateTeamGenerationApproval(projectID,id string,validate TeamProjectValidator,update func(*model.TeamGenerationApproval)error,audit *model.TeamAudit)(model.TeamGenerationApproval,error){
    db,err:=DB();var row model.TeamGenerationApproval;if err!=nil{return row,err};err=db.Transaction(func(tx *gorm.DB)error{project,err:=ValidateTeamProjectTx(tx,projectID,validate);if err!=nil{return err};if err:=tx.Where("id = ? AND project_id = ?",id,projectID).First(&row).Error;err!=nil{return err};if err:=update(&row);err!=nil{return err};if err:=tx.Save(&row).Error;err!=nil{return err};if audit!=nil{audit.TeamID=project.TeamID;return AppendTeamAudit(tx,audit)};return nil});return row,err
}

// The team lock precedes the payer wallet lock in both reservation and settlement.
func reserveTeamGenerationBudget(tx *gorm.DB,task *model.VideoTask)error{
    if task.TeamApprovalID==""{return nil};var row model.TeamGenerationApproval;if err:=tx.Where("id = ?",task.TeamApprovalID).First(&row).Error;err!=nil{return err}
    project,err:=ValidateTeamProjectTx(tx,row.ProjectID,func(p model.TeamProject,t model.Team,members []model.TeamMember)error{payer,requester:=false,false;for _,m:=range members{payer=payer||m.UserID==task.UserID;requester=requester||m.UserID==row.RequesterID};if !payer||!requester||p.OwnerUserID!=task.UserID||row.PayerID!=task.UserID{return ErrTeamBudget};return nil});if err!=nil{return err}
    if err:=tx.Where("id = ?",row.ID).First(&row).Error;err!=nil{return err}
    if row.TaskID==task.ID{return nil};if row.State!="pending"||row.TaskID!=""||row.PreparedRequest!=task.RequestBody||row.CanvasID!=task.CanvasID||row.NodeID!=task.SourceID{return ErrTeamBudget}
    var payer model.User;if err:=tx.Clauses(clause.Locking{Strength:"UPDATE"}).Where("id = ?",task.UserID).First(&payer).Error;err!=nil{return err}
    var bound int64;if err:=tx.Table("production_shots s").Joins("JOIN production_projects p ON p.id = s.project_id").Where("p.user_id = ? AND p.workspace_id = ? AND s.id = ? AND s.canvas_id = ? AND s.video_node_id = ?",task.UserID,project.WorkspaceID,row.ShotID,task.CanvasID,task.SourceID).Count(&bound).Error;err!=nil{return err};if bound!=1{return ErrTeamBudget}
    for _,id:=range row.AssetIDs{var asset model.TeamAsset;if err:=tx.Where("id = ? AND team_id = ? AND revoked_at = ''",id,project.TeamID).First(&asset).Error;err!=nil{return err};var member int64;if err:=tx.Model(&model.TeamMember{}).Where("team_id = ? AND user_id = ?",project.TeamID,asset.OwnerUserID).Count(&member).Error;err!=nil{return err};if member!=1{return ErrTeamBudget}}
    result:=tx.Model(&model.TeamGenerationBudget{}).Where("project_id = ? AND limit_credits - held_credits - spent_credits >= ?",row.ProjectID,task.ReservedCredits).Update("held_credits",gorm.Expr("ROUND(held_credits + ?, 2)",task.ReservedCredits));if result.Error!=nil{return result.Error};if result.RowsAffected!=1{return ErrTeamBudget}
    row.State,row.TaskID,row.ReservedCredits,row.AccountedHold,row.UpdatedAt="running",task.ID,task.ReservedCredits,task.ReservedCredits,task.CreatedAt;if err:=tx.Save(&row).Error;err!=nil{return err}
    return AppendTeamAudit(tx,&model.TeamAudit{ID:task.ID+":approve",TeamID:project.TeamID,ActorID:task.UserID,Action:"generation.approve",TargetID:row.ID,Summary:"批准镜头生成并预扣项目拥有者算力",CreatedAt:task.CreatedAt})
}

func lockTeamGenerationSettlement(tx *gorm.DB,task model.VideoTask)error{
    if task.TeamApprovalID==""{return nil};var row model.TeamGenerationApproval;if err:=tx.Where("id = ?",task.TeamApprovalID).First(&row).Error;err!=nil{return err};var team model.Team
    // Revocation never discards charges already incurred.
    return tx.Clauses(clause.Locking{Strength:"UPDATE"}).Where("id = ?",row.TeamID).First(&team).Error
}

func settleTeamGenerationBudget(tx *gorm.DB,task *model.VideoTask,amount *float64)error{
    if task.TeamApprovalID==""{return nil};var row model.TeamGenerationApproval;if err:=tx.Where("id = ?",task.TeamApprovalID).First(&row).Error;err!=nil{return err};if row.State=="settled"||row.State=="released"{return nil}
    hold,spent:=row.AccountedHold,0.0
    if amount!=nil {actual:=math.Round(*amount*100)/100;row.ActualCredits=&actual;if task.BillingStatus=="settled"||task.BillingStatus=="released"{hold=0;spent=actual;row.State=task.BillingStatus}else{hold=actual;row.State="pending_balance"}}
    if err:=tx.Model(&model.TeamGenerationBudget{}).Where("project_id = ?",row.ProjectID).Updates(map[string]any{"held_credits":gorm.Expr("ROUND(held_credits + ?, 2)",hold-row.AccountedHold),"spent_credits":gorm.Expr("ROUND(spent_credits + ?, 2)",spent)}).Error;err!=nil{return err}
    row.AccountedHold,row.UpdatedAt=hold,task.UpdatedAt;return tx.Save(&row).Error
}
