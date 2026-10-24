package repository

import (
	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type TeamProjectValidator func(model.TeamProject, model.Team, []model.TeamMember) error

func AppendTeamAudit(tx *gorm.DB, entry *model.TeamAudit) error { return tx.Create(entry).Error }
func appendTeamAudits(tx *gorm.DB, entries []*model.TeamAudit, err error)error{if err!=nil{return err};for _,entry:=range entries{if err:=AppendTeamAudit(tx,entry);err!=nil{return err}};return nil}

// Call inside a transaction, before taking the project owner's user lock.
func ValidateTeamProjectTx(tx *gorm.DB, id string, validate TeamProjectValidator) (model.TeamProject, error) {
	var project model.TeamProject
	if err := tx.Where("id = ? AND revoked_at = ''", id).First(&project).Error; err != nil { return project, err }
	var team model.Team
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND deleted_at = ''", project.TeamID).First(&team).Error; err != nil { return project, err }
	if err := tx.Where("id = ? AND revoked_at = ''", id).First(&project).Error; err != nil { return project, err }
	team, members, err := readTeam(tx, project.TeamID); if err != nil { return project, err }
	return project, validate(project, team, members)
}

func ReadTeamProject(id string, validate TeamProjectValidator) (model.TeamProject, error) {
	db, err := DB(); if err != nil { return model.TeamProject{}, err }; var project model.TeamProject
	err = db.Transaction(func(tx *gorm.DB) error { project, err = ValidateTeamProjectTx(tx, id, validate); return err }); return project, err
}

func TeamProjects(teamID string, q model.Query, validate TeamValidator) ([]model.TeamProject, int64, error) {
	db, err := DB(); if err != nil { return nil, 0, err }; rows := []model.TeamProject{}; var total int64
	err = withTeam(db, teamID, validate, func(tx *gorm.DB) error {
		query := tx.Model(&model.TeamProject{}).Where("team_id = ? AND revoked_at = ''", teamID)
		if err := query.Count(&total).Error; err != nil { return err }; return query.Order("created_at DESC, id").Offset(q.Offset()).Limit(q.PageSize).Find(&rows).Error
	}); return rows, total, err
}

func ShareTeamProject(project *model.TeamProject, revision int64, validate TeamValidator, audit *model.TeamAudit) error {
	db, err := DB(); if err != nil { return err }
	return withTeam(db, project.TeamID, validate, func(tx *gorm.DB) error {
		return withUserStorageLock(tx, project.OwnerUserID, nil, func(tx *gorm.DB) error {
			var plan model.ProductionProject
			if err := tx.Where("user_id = ? AND workspace_id = ?", project.OwnerUserID, project.WorkspaceID).First(&plan).Error; err != nil { return err }
			if plan.Revision != revision { return ErrProductionConflict }
			var existing model.TeamProject
			err := tx.Where("owner_user_id = ? AND workspace_id = ? AND revoked_at = ''", project.OwnerUserID, project.WorkspaceID).First(&existing).Error
			if err == nil { return ErrProductionConflict }; if err != gorm.ErrRecordNotFound { return err }
			project.Title = plan.Title
			if err := tx.Create(project).Error; err != nil { return err }; return AppendTeamAudit(tx, audit)
		})
	})
}

func ChangeSharedTeamProject(id string, editAllowed bool, revokedAt string, validate TeamProjectValidator, audit *model.TeamAudit) error {
	db, err := DB(); if err != nil { return err }
	return db.Transaction(func(tx *gorm.DB) error {
		project, err := ValidateTeamProjectTx(tx, id, validate); if err != nil { return err }; audit.TeamID = project.TeamID
		updates := map[string]any{"edit_allowed": editAllowed}; if revokedAt != "" { updates = map[string]any{"revoked_at": revokedAt} }
		if err := tx.Model(&model.TeamProject{}).Where("id = ?", id).Updates(updates).Error; err != nil { return err }; return AppendTeamAudit(tx, audit)
	})
}

func TeamProjectDocument(id string, validate TeamProjectValidator) (*model.ProductionDocument, error) {
	db, err := DB(); if err != nil { return nil, err }; var doc *model.ProductionDocument
	err = db.Transaction(func(tx *gorm.DB) error {
		project, err := ValidateTeamProjectTx(tx, id, validate); if err != nil { return err }; var plan model.ProductionProject
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).Where("user_id = ? AND workspace_id = ?", project.OwnerUserID, project.WorkspaceID).First(&plan).Error; err != nil { return err }
		doc, err = readProductionDocument(tx, plan); return err
	}); return doc, err
}

func SaveTeamProjectDocument(id string, revision int64, validate TeamProjectValidator, merge func(*model.ProductionDocument) error, audit *model.TeamAudit) (*model.ProductionDocument, error) {
	db, err := DB(); if err != nil { return nil, err }; var doc *model.ProductionDocument
	err = db.Transaction(func(tx *gorm.DB) error {
		project, err := ValidateTeamProjectTx(tx, id, validate); if err != nil { return err }; audit.TeamID = project.TeamID
		return withUserStorageLock(tx, project.OwnerUserID, nil, func(tx *gorm.DB) error {
			var plan model.ProductionProject
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ? AND workspace_id = ?", project.OwnerUserID, project.WorkspaceID).First(&plan).Error; err != nil { return err }
			if plan.Revision != revision { return ErrProductionConflict }
			doc, err = readProductionDocument(tx, plan); if err != nil { return err }; if err := merge(doc); err != nil { return err }
			doc.Revision++
			if err := tx.Model(&plan).Updates(map[string]any{"title": doc.Title, "synopsis": doc.Synopsis, "style_guide": doc.StyleGuide, "revision": doc.Revision, "updated_at": doc.UpdatedAt}).Error; err != nil { return err }
			if err := deleteProductionChildren(tx, plan.ID); err != nil { return err }
			if len(doc.Episodes)>0 { if err := tx.CreateInBatches(&doc.Episodes,50).Error; err != nil { return err } }
			if len(doc.Scenes)>0 { if err := tx.CreateInBatches(&doc.Scenes,50).Error; err != nil { return err } }
			if len(doc.Assets)>0 { if err := tx.CreateInBatches(&doc.Assets,50).Error; err != nil { return err } }
			if len(doc.Shots)>0 { if err := tx.CreateInBatches(&doc.Shots,30).Error; err != nil { return err } }
			if err := tx.Model(&project).Update("title",doc.Title).Error; err != nil { return err }; return AppendTeamAudit(tx,audit)
		})
	}); return doc, err
}

func TeamAssets(teamID string, q model.Query, validate TeamValidator) ([]model.TeamAsset, int64, error) {
	db, err := DB(); if err != nil { return nil,0,err }; rows:=[]model.TeamAsset{}; var total int64
	err=withTeam(db,teamID,validate,func(tx *gorm.DB) error { query:=tx.Model(&model.TeamAsset{}).Where("team_id = ? AND revoked_at = ''",teamID); if err:=query.Count(&total).Error;err!=nil{return err};return query.Order("created_at DESC, id").Offset(q.Offset()).Limit(q.PageSize).Find(&rows).Error });return rows,total,err
}

func ShareTeamAsset(asset *model.TeamAsset, validate TeamValidator, prepare func(model.StorageObject)error, audit *model.TeamAudit) error {
	db,err:=DB();if err!=nil{return err};return withTeam(db,asset.TeamID,validate,func(tx *gorm.DB)error{return withUserStorageLock(tx,asset.OwnerUserID,[]string{asset.ObjectID},func(tx *gorm.DB)error{
		var object model.StorageObject;if err:=tx.Where("id = ? AND created_by = ? AND deleted_at = ''",asset.ObjectID,asset.OwnerUserID).First(&object).Error;err!=nil{return err};if err:=prepare(object);err!=nil{return err}
		var count int64;if err:=tx.Model(&model.TeamAsset{}).Where("team_id = ? AND object_id = ? AND revoked_at = ''",asset.TeamID,asset.ObjectID).Count(&count).Error;err!=nil{return err};if count>0{return ErrProductionConflict}
		if err:=tx.Create(asset).Error;err!=nil{return err};return AppendTeamAudit(tx,audit)
	})})
}

func ReadTeamAsset(id string, validate func(model.TeamAsset,model.Team,[]model.TeamMember)error) (model.TeamAsset,error) {
	db,err:=DB();if err!=nil{return model.TeamAsset{},err};var asset model.TeamAsset
	if err:=db.Where("id = ? AND revoked_at = ''",id).First(&asset).Error;err!=nil{return asset,err}
	err=withTeam(db,asset.TeamID,func(_ model.Team,_ []model.TeamMember)error{return nil},func(tx *gorm.DB)error{if err:=tx.Where("id = ? AND revoked_at = ''",id).First(&asset).Error;err!=nil{return err};team,members,err:=readTeam(tx,asset.TeamID);if err!=nil{return err};return validate(asset,team,members)});return asset,err
}

func RevokeTeamAsset(id,stamp string,validate func(model.TeamAsset,model.Team,[]model.TeamMember)error,audit *model.TeamAudit)error{
	db,err:=DB();if err!=nil{return err};var asset model.TeamAsset;if err:=db.Where("id = ? AND revoked_at = ''",id).First(&asset).Error;err!=nil{return err}
	return withTeam(db,asset.TeamID,func(team model.Team,members []model.TeamMember)error{return validate(asset,team,members)},func(tx *gorm.DB)error{
		if err:=tx.Model(&model.TeamAsset{}).Where("id = ? AND revoked_at = ''",id).Update("revoked_at",stamp).Error;err!=nil{return err};audit.TeamID=asset.TeamID;return AppendTeamAudit(tx,audit)
	})
}

func SetTeamCostPermission(teamID,userID string,allow bool,validate TeamValidator,audit *model.TeamAudit)error{
	db,err:=DB();if err!=nil{return err};return withTeam(db,teamID,validate,func(tx *gorm.DB)error{
		if err:=tx.Model(&model.TeamMember{}).Where("team_id = ? AND user_id = ?",teamID,userID).Update("can_view_costs",allow).Error;err!=nil{return err};return AppendTeamAudit(tx,audit)
	})
}

func TransferTeamOwner(teamID,fromID,toID string,validate TeamValidator,audit *model.TeamAudit)error{
	db,err:=DB();if err!=nil{return err};return withTeam(db,teamID,validate,func(tx *gorm.DB)error{
		if err:=tx.Model(&model.Team{}).Where("id = ? AND owner_id = ?",teamID,fromID).Update("owner_id",toID).Error;err!=nil{return err}
		if err:=tx.Model(&model.TeamMember{}).Where("team_id = ? AND user_id = ?",teamID,fromID).Update("role","admin").Error;err!=nil{return err}
		if err:=tx.Model(&model.TeamMember{}).Where("team_id = ? AND user_id = ?",teamID,toID).Update("role","owner").Error;err!=nil{return err};return AppendTeamAudit(tx,audit)
	})
}

func TeamAudits(teamID string,q model.Query,validate TeamValidator)([]model.TeamAudit,int64,error){
	db,err:=DB();if err!=nil{return nil,0,err};rows:=[]model.TeamAudit{};var total int64;err=withTeam(db,teamID,validate,func(tx *gorm.DB)error{query:=tx.Model(&model.TeamAudit{}).Where("team_id = ?",teamID);if err:=query.Count(&total).Error;err!=nil{return err};return query.Order("created_at DESC, id DESC").Offset(q.Offset()).Limit(q.PageSize).Find(&rows).Error});return rows,total,err
}
