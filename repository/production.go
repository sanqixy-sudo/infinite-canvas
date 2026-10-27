package repository

import (
	"errors"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrProductionConflict = errors.New("production revision conflict")
var ErrProductionCanvasReferenced = errors.New("canvas is referenced by production")
var ErrProductionTeamShared = errors.New("请先在团队空间撤销此制作计划的共享，再删除个人制作计划")

func readProductionDocument(tx *gorm.DB, project model.ProductionProject) (*model.ProductionDocument, error) {
	doc := &model.ProductionDocument{
		ProductionProject: project,
		Episodes: []model.ProductionEpisode{}, Scenes: []model.ProductionScene{},
		Assets: []model.ProductionAsset{}, Shots: []model.ProductionShot{},
	}
	for _, target := range []any{&doc.Episodes, &doc.Scenes, &doc.Assets, &doc.Shots} {
		if err := tx.Where("project_id = ?", project.ID).Find(target).Error; err != nil {
			return nil, err
		}
	}
	return doc, nil
}

func GetUserProductionDocument(userID, workspaceID string) (*model.ProductionDocument, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var doc *model.ProductionDocument
	err = db.Transaction(func(tx *gorm.DB) error {
		var project model.ProductionProject
		err := tx.Clauses(clause.Locking{Strength: "SHARE"}).Where("user_id = ? AND workspace_id = ?", userID, workspaceID).First(&project).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		doc, err = readProductionDocument(tx, project)
		return err
	})
	return doc, err
}

func CreateUserProductionDocument(project model.ProductionProject, validate func([]model.CanvasProject) error) (*model.ProductionDocument, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var doc *model.ProductionDocument
	err = withUserStorageLock(db, project.UserID, nil, func(tx *gorm.DB) error {
		var canvases []model.CanvasProject
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).Where("user_id = ? AND id = ? AND deleted_at = ''", project.UserID, project.WorkspaceID).Find(&canvases).Error; err != nil {
			return err
		}
		if err := validate(canvases); err != nil {
			return err
		}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&project).Error; err != nil {
			return err
		}
		var saved model.ProductionProject
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).Where("user_id = ? AND workspace_id = ?", project.UserID, project.WorkspaceID).First(&saved).Error; err != nil {
			return err
		}
		doc, err = readProductionDocument(tx, saved)
		return err
	})
	return doc, err
}

// The callback validates the canvas snapshots read inside this save transaction.
func SaveUserProductionDocument(userID string, doc model.ProductionDocument, canvasIDs, audioIDs []string, validate func([]model.CanvasProject) error) (*model.ProductionDocument, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	err = withUserStorageLock(db, userID, audioIDs, func(tx *gorm.DB) error {
		if len(audioIDs)>0 { var count int64;if err:=tx.Model(&model.StorageObject{}).Where("id IN ? AND created_by = ? AND mime_type LIKE ? AND bytes > 0 AND bytes <= ?",audioIDs,userID,"audio/%",64<<20).Count(&count).Error;err!=nil{return err};if count!=int64(len(audioIDs)){return ErrStorageReferenceMissing} }
		var current model.ProductionProject
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ? AND workspace_id = ?", doc.ID, userID, doc.WorkspaceID).First(&current).Error; err != nil {
			return err
		}
		if current.Revision != doc.Revision {
			return ErrProductionConflict
		}
		var canvases []model.CanvasProject
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).Where("user_id = ? AND id IN ? AND deleted_at = ''", userID, canvasIDs).Find(&canvases).Error; err != nil {
			return err
		}
		if err := validate(canvases); err != nil {
			return err
		}
		result := tx.Model(&model.ProductionProject{}).Where("id = ? AND user_id = ? AND revision = ?", doc.ID, userID, doc.Revision).Updates(map[string]any{
			"title": doc.Title, "synopsis": doc.Synopsis, "style_guide": doc.StyleGuide,
			"revision": doc.Revision + 1, "updated_at": doc.UpdatedAt,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrProductionConflict
		}
		if err := deleteProductionChildren(tx, doc.ID); err != nil { return err }
		if len(doc.Episodes) > 0 {
			if err := tx.CreateInBatches(&doc.Episodes, 50).Error; err != nil { return err }
		}
		if len(doc.Scenes) > 0 {
			if err := tx.CreateInBatches(&doc.Scenes, 50).Error; err != nil { return err }
		}
		if len(doc.Assets) > 0 {
			if err := tx.CreateInBatches(&doc.Assets, 50).Error; err != nil { return err }
		}
		if len(doc.Shots) > 0 {
			if err := tx.CreateInBatches(&doc.Shots, 30).Error; err != nil { return err }
		}
		doc.UserID, doc.CreatedAt, doc.Revision = userID, current.CreatedAt, doc.Revision+1
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &doc, nil
}

func DeleteUserProductionDocument(userID, id string, revision int64) error {
	db, err := DB()
	if err != nil { return err }
	return withUserStorageLock(db, userID, nil, func(tx *gorm.DB) error {
		var project model.ProductionProject
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ?", id, userID).First(&project).Error; err != nil { return err }
		if project.Revision != revision { return ErrProductionConflict }
		var shared int64
		if err:=tx.Model(&model.TeamProject{}).Where("owner_user_id = ? AND workspace_id = ? AND revoked_at = ''",userID,project.WorkspaceID).Count(&shared).Error;err!=nil{return err}
		if shared>0{return ErrProductionTeamShared}
		if err := deleteProductionChildren(tx, project.ID); err != nil { return err }
		result := tx.Where("id = ? AND user_id = ? AND revision = ?", id, userID, revision).Delete(&model.ProductionProject{})
		if result.Error != nil { return result.Error }
		if result.RowsAffected != 1 { return ErrProductionConflict }
		return nil
	})
}

func deleteProductionChildren(tx *gorm.DB, id string) error {
	for _, target := range []any{&model.ProductionEpisode{}, &model.ProductionScene{}, &model.ProductionAsset{}, &model.ProductionShot{}} {
		if err := tx.Where("project_id = ?", id).Delete(target).Error; err != nil { return err }
	}
	return nil
}

func ListUserProductionCanvasReferences(userID string) ([]string, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	return listUserProductionCanvasReferences(db, userID)
}

func listUserProductionCanvasReferences(db *gorm.DB, userID string) ([]string, error) {
	var projects []model.ProductionProject
	if err := db.Where("user_id = ?", userID).Select("id", "workspace_id").Find(&projects).Error; err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(projects))
	canvases := make([]string, 0, len(projects))
	for _, project := range projects {
		ids = append(ids, project.ID)
		canvases = append(canvases, project.WorkspaceID)
	}
	if len(ids) == 0 {
		return canvases, nil
	}
	var shots []model.ProductionShot
	if err := db.Where("project_id IN ?", ids).Select([]string{"canvas_id", "candidates"}).Find(&shots).Error; err != nil {
		return nil, err
	}
	for _, shot := range shots {
		if shot.CanvasID != "" { canvases = append(canvases, shot.CanvasID) }
		for _, candidate := range shot.Candidates { canvases = append(canvases, candidate.CanvasID) }
	}
	var assets []model.ProductionAsset
	if err := db.Where("project_id IN ?", ids).Select("node_references").Find(&assets).Error; err != nil {
		return nil, err
	}
	for _, asset := range assets {
		for _, ref := range asset.References {
			canvases = append(canvases, ref.CanvasID)
		}
	}
	return canvases, nil
}
