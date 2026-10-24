package repository

import (
	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type TeamValidator func(model.Team, []model.TeamMember) error

func readTeam(tx *gorm.DB, id string) (model.Team, []model.TeamMember, error) {
	var team model.Team
	if err := tx.Where("id = ? AND deleted_at = ''", id).First(&team).Error; err != nil { return team, nil, err }
	members := []model.TeamMember{}
	err := tx.Table("team_members").Select("team_members.*, COALESCE(NULLIF(users.display_name, ''), users.username, '') AS display_name").Joins("LEFT JOIN users ON users.id = team_members.user_id").Where("team_members.team_id = ?", id).Order("team_members.joined_at, team_members.user_id").Find(&members).Error
	return team, members, err
}

func withTeam(tx *gorm.DB, id string, validate TeamValidator, write func(*gorm.DB) error) error {
	return tx.Transaction(func(tx *gorm.DB) error {
		var locked model.Team
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND deleted_at = ''", id).First(&locked).Error; err != nil { return err }
		team, members, err := readTeam(tx, id)
		if err != nil { return err }
		if err := validate(team, members); err != nil { return err }
		return write(tx)
	})
}

func UserTeams(userID string, q model.Query) ([]model.Team, int64, error) {
	db, err := DB(); if err != nil { return nil, 0, err }
	q.Normalize(); rows := []model.Team{}; var total int64
	query := db.Model(&model.Team{}).Joins("JOIN team_members ON team_members.team_id = teams.id").Where("team_members.user_id = ? AND teams.deleted_at = ''", userID)
	if err := query.Count(&total).Error; err != nil { return nil, 0, err }
	err = query.Select("teams.*").Order("teams.created_at DESC, teams.id").Offset(q.Offset()).Limit(q.PageSize).Find(&rows).Error
	return rows, total, err
}

func CreateTeam(team model.Team, owner model.TeamMember, audits ...*model.TeamAudit) error {
	db, err := DB(); if err != nil { return err }
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&team).Error; err != nil { return err }
		return appendTeamAudits(tx,audits,tx.Create(&owner).Error)
	})
}

func GetTeam(id string) (model.Team, []model.TeamMember, error) {
	db, err := DB(); if err != nil { return model.Team{}, nil, err }
	return readTeam(db, id)
}

func UpdateTeam(id string, validate TeamValidator, name, deletedAt string, audits ...*model.TeamAudit) error {
	db, err := DB(); if err != nil { return err }
	return withTeam(db, id, validate, func(tx *gorm.DB) error {
		if deletedAt != "" {
			for _, target:=range []any{&model.TeamProject{},&model.TeamAsset{}} { if err:=tx.Model(target).Where("team_id = ? AND revoked_at = ''",id).Update("revoked_at",deletedAt).Error;err!=nil{return err} }
			if err := tx.Model(&model.ProductionReview{}).Where("team_id = ? AND revoked_at = ''", id).Update("revoked_at", deletedAt).Error; err != nil { return err }
			if err := tx.Model(&model.TeamInvite{}).Where("team_id = ? AND revoked_at = ''", id).Update("revoked_at", deletedAt).Error; err != nil { return err }
			return appendTeamAudits(tx,audits,tx.Model(&model.Team{}).Where("id = ?", id).Update("deleted_at", deletedAt).Error)
		}
		return appendTeamAudits(tx,audits,tx.Model(&model.Team{}).Where("id = ?", id).Update("name", name).Error)
	})
}

func ChangeTeamMember(teamID, userID, role, stamp string, validate TeamValidator, audits ...*model.TeamAudit) error {
	db, err := DB(); if err != nil { return err }
	return withTeam(db, teamID, validate, func(tx *gorm.DB) error {
		query := tx.Model(&model.TeamMember{}).Where("team_id = ? AND user_id = ?", teamID, userID)
		if role != "" { return appendTeamAudits(tx,audits,query.Update("role", role).Error) }
		if err := query.Delete(&model.TeamMember{}).Error; err != nil { return err }
		for _, target:=range []any{&model.TeamProject{},&model.TeamAsset{}} { if err:=tx.Model(target).Where("team_id = ? AND owner_user_id = ? AND revoked_at = ''",teamID,userID).Update("revoked_at",stamp).Error;err!=nil{return err} }
		if err := tx.Model(&model.TeamInvite{}).Where("team_id = ? AND created_by = ? AND revoked_at = ''", teamID, userID).Update("revoked_at", stamp).Error; err != nil { return err }
		return appendTeamAudits(tx,audits,tx.Model(&model.ProductionReview{}).Where("team_id = ? AND publisher_id = ? AND revoked_at = ''", teamID, userID).Update("revoked_at", stamp).Error)
	})
}

func TeamInvites(id string, validate TeamValidator) ([]model.TeamInvite, error) {
	db, err := DB(); if err != nil { return nil, err }; rows := []model.TeamInvite{}
	err = withTeam(db, id, validate, func(tx *gorm.DB) error { return tx.Where("team_id = ?", id).Order("created_at DESC").Limit(50).Find(&rows).Error })
	return rows, err
}

func CreateTeamInvite(invite model.TeamInvite, validate TeamValidator, audits ...*model.TeamAudit) error {
	db, err := DB(); if err != nil { return err }
	return withTeam(db, invite.TeamID, validate, func(tx *gorm.DB) error { return appendTeamAudits(tx,audits,tx.Create(&invite).Error) })
}

func RevokeTeamInvite(teamID, inviteID, stamp string, validate TeamValidator, audits ...*model.TeamAudit) error {
	db, err := DB(); if err != nil { return err }
	return withTeam(db, teamID, validate, func(tx *gorm.DB) error {
		result := tx.Model(&model.TeamInvite{}).Where("team_id = ? AND id = ?", teamID, inviteID).Update("revoked_at", stamp)
		if result.Error != nil { return result.Error }; if result.RowsAffected != 1 { return gorm.ErrRecordNotFound }; return appendTeamAudits(tx,audits,nil)
	})
}

func JoinTeam(hash, userID, stamp string, validate func(model.TeamInvite, []model.TeamMember) error, audits ...*model.TeamAudit) (string, error) {
	db, err := DB(); if err != nil { return "", err }
	var invite model.TeamInvite
	if err := db.Where("code_hash = ?", hash).First(&invite).Error; err != nil { return "", err }
	err = withTeam(db, invite.TeamID, func(_ model.Team, members []model.TeamMember) error {
		return nil
	}, func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", invite.ID).First(&invite).Error; err != nil { return err }
		_, members, err := readTeam(tx, invite.TeamID); if err != nil { return err }
		if err := validate(invite, members); err != nil { return err }
		for _, member := range members { if member.UserID == userID { return nil } }
		if err := tx.Create(&model.TeamMember{TeamID: invite.TeamID, UserID: userID, Role: "member", JoinedAt: stamp}).Error; err != nil { return err }
		for _,audit:=range audits{audit.TeamID=invite.TeamID};return appendTeamAudits(tx,audits,tx.Model(&invite).Update("used_at", stamp).Error)
	})
	return invite.TeamID, err
}
