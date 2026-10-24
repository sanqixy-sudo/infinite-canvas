package repository

import (
	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func TeamReviews(teamID string, q model.Query, validate TeamValidator) ([]model.ProductionReview, int64, error) {
	db, err := DB(); if err != nil { return nil, 0, err }; rows := []model.ProductionReview{}; var total int64; q.Normalize()
	err = withTeam(db, teamID, validate, func(tx *gorm.DB) error {
		query := tx.Model(&model.ProductionReview{}).Where("team_id = ? AND revoked_at = ''", teamID)
		if err := query.Count(&total).Error; err != nil { return err }
		return query.Omit("snapshot", "media_object_ids").Order("created_at DESC, id").Offset(q.Offset()).Limit(q.PageSize).Find(&rows).Error
	})
	return rows, total, err
}

// Publisher snapshots are generated from the saved document inside the ownership lock.
func CreateProductionReview(teamID, userID, workspaceID string, validate TeamValidator, build func(model.ProductionDocument, []model.StorageObject) (model.ProductionReview, error), audits ...*model.TeamAudit) (model.ProductionReview, error) {
	db, err := DB(); if err != nil { return model.ProductionReview{}, err }; var review model.ProductionReview
	err = withTeam(db, teamID, validate, func(tx *gorm.DB) error {
		return withUserStorageLock(tx, userID, nil, func(tx *gorm.DB) error {
			var project model.ProductionProject
			if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).Where("user_id = ? AND workspace_id = ?", userID, workspaceID).First(&project).Error; err != nil { return err }
			doc, err := readProductionDocument(tx, project); if err != nil { return err }
			objects := []model.StorageObject{}
			// Only selected result keys are loaded; account file indexes never leave this call.
			keys := []string{}
			for _, shot := range doc.Shots { for _, candidate := range shot.Candidates { if candidate.ID == shot.SelectedImageCandidateID || candidate.ID == shot.SelectedVideoCandidateID { keys = append(keys, candidate.StorageKey) } } }
			ids := []string{}
			for _, key := range keys { if len(key) > 7 && key[:7] == "server:" { ids = append(ids, key[7:]) } }
			if len(ids) > 0 { if err := tx.Where("id IN ? AND created_by = ? AND deleted_at = ''", ids, userID).Find(&objects).Error; err != nil { return err } }
			review, err = build(*doc, objects); if err != nil { return err }
			for _,audit:=range audits{audit.TeamID=review.TeamID;audit.TargetID=review.ID};return appendTeamAudits(tx,audits,tx.Create(&review).Error)
		})
	})
	return review, err
}

func withReview(db *gorm.DB, id string, validate func(model.ProductionReview, model.Team, []model.TeamMember) error, write func(*gorm.DB, model.ProductionReview) error) error {
	var review model.ProductionReview
	if err := db.Where("id = ? AND revoked_at = ''", id).First(&review).Error; err != nil { return err }
	return withTeam(db, review.TeamID, func(_ model.Team, _ []model.TeamMember) error { return nil }, func(tx *gorm.DB) error {
		if err := tx.Where("id = ? AND revoked_at = ''", id).First(&review).Error; err != nil { return err }
		team, members, err := readTeam(tx, review.TeamID); if err != nil { return err }
		if err := validate(review, team, members); err != nil { return err }
		return write(tx, review)
	})
}

func ReadProductionReview(id string, validate func(model.ProductionReview, model.Team, []model.TeamMember) error) (model.ProductionReview, error) {
	db, err := DB(); if err != nil { return model.ProductionReview{}, err }; var result model.ProductionReview
	err = withReview(db, id, validate, func(_ *gorm.DB, review model.ProductionReview) error { result = review; return nil })
	return result, err
}

func RevokeProductionReview(id, stamp string, validate func(model.ProductionReview, model.Team, []model.TeamMember) error, audits ...*model.TeamAudit) error {
	db, err := DB(); if err != nil { return err }
	return withReview(db, id, validate, func(tx *gorm.DB, review model.ProductionReview) error { for _,audit:=range audits{audit.TeamID=review.TeamID};return appendTeamAudits(tx,audits,tx.Model(&model.ProductionReview{}).Where("id = ?", id).Update("revoked_at", stamp).Error) })
}

func ReviewComments(id, shotID string, q model.Query, validate func(model.ProductionReview, model.Team, []model.TeamMember) error) ([]model.ProductionReviewComment, int64, error) {
	db, err := DB(); if err != nil { return nil, 0, err }; rows := []model.ProductionReviewComment{}; var total int64; q.Normalize()
	err = withReview(db, id, validate, func(tx *gorm.DB, _ model.ProductionReview) error {
		query := tx.Model(&model.ProductionReviewComment{}).Where("review_id = ? AND shot_id = ?", id, shotID)
		if err := query.Count(&total).Error; err != nil { return err }
		return query.Select("production_review_comments.*, COALESCE(NULLIF(users.display_name, ''), users.username, '') AS author_name").Joins("LEFT JOIN users ON users.id = production_review_comments.author_id").Order("production_review_comments.created_at DESC, production_review_comments.id").Offset(q.Offset()).Limit(q.PageSize).Find(&rows).Error
	})
	return rows, total, err
}

func CreateReviewComment(comment model.ProductionReviewComment, validate func(model.ProductionReview, model.Team, []model.TeamMember) error, audits ...*model.TeamAudit) error {
	db, err := DB(); if err != nil { return err }
	return withReview(db, comment.ReviewID, validate, func(tx *gorm.DB, review model.ProductionReview) error {for _,audit:=range audits{audit.TeamID=review.TeamID};return appendTeamAudits(tx,audits,tx.Create(&comment).Error) })
}

func DeleteReviewComment(reviewID, commentID string, validate func(model.ProductionReview, model.Team, []model.TeamMember, model.ProductionReviewComment) error, audits ...*model.TeamAudit) error {
	db, err := DB(); if err != nil { return err }
	return withReview(db, reviewID, func(_ model.ProductionReview, _ model.Team, _ []model.TeamMember) error { return nil }, func(tx *gorm.DB, review model.ProductionReview) error {
		var comment model.ProductionReviewComment
		if err := tx.Where("id = ? AND review_id = ?", commentID, reviewID).First(&comment).Error; err != nil { return err }
		team, members, err := readTeam(tx, review.TeamID); if err != nil { return err }
		if err := validate(review, team, members, comment); err != nil { return err }
		for _,audit:=range audits{audit.TeamID=review.TeamID};return appendTeamAudits(tx,audits,tx.Delete(&comment).Error)
	})
}
