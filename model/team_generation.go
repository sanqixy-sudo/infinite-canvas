package model

type TeamGenerationBudget struct {
    ProjectID string `json:"projectId" gorm:"primaryKey;size:128"`
    LimitCredits float64 `json:"limitCredits" gorm:"type:decimal(20,2)"`
    HeldCredits float64 `json:"heldCredits" gorm:"type:decimal(20,2)"`
    SpentCredits float64 `json:"spentCredits" gorm:"type:decimal(20,2)"`
}

type TeamGenerationApproval struct {
    ID string `json:"id" gorm:"primaryKey;size:128"`
    ProjectID string `json:"projectId" gorm:"size:128;index"`
    TeamID string `json:"teamId" gorm:"size:128;index"`
    RequesterID string `json:"requesterId" gorm:"size:128"`
    PayerID string `json:"-" gorm:"size:128"`
    ShotID string `json:"shotId" gorm:"size:128"`
    ShotTitle string `json:"shotTitle"`
    CanvasID string `json:"-"`
    NodeID string `json:"-"`
    Model string `json:"model"`
    Revision string `json:"revision"`
    Prompt string `json:"prompt"`
    Parameters string `json:"-" gorm:"type:text"`
    AssetIDs []string `json:"assetIds" gorm:"serializer:json"`
    RequestHash string `json:"-"`
    PreparedRequest string `json:"-" gorm:"type:text"`
    State string `json:"state" gorm:"size:32;index"`
    Reason string `json:"reason"`
    TaskID string `json:"taskId"`
    ReservedCredits float64 `json:"-" gorm:"type:decimal(20,2)"`
    AccountedHold float64 `json:"-" gorm:"type:decimal(20,2)"`
    ActualCredits *float64 `json:"-" gorm:"type:decimal(20,2)"`
    CreatedAt string `json:"createdAt"`
    UpdatedAt string `json:"updatedAt"`
}
