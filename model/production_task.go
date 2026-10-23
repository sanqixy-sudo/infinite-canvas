package model

// ProductionTaskRecord stores credential-free facts independently of short-lived task rows.
type ProductionTaskRecord struct {
	ActualUnits *int64 `json:"actualUnits"`
	RecordID string `json:"recordId" gorm:"primaryKey;size:256"`
	ID string `json:"id" gorm:"size:128;index"`
	UserID string `json:"-" gorm:"size:128;index"`
	Kind string `json:"kind"`
	CanvasID string `json:"canvasId"`
	NodeID string `json:"nodeId"`
	Model string `json:"model"`
	Status string `json:"status" gorm:"index"`
	Progress int `json:"progress"`
	DispatchStatus string `json:"dispatchStatus"`
	BillingStatus string `json:"billingStatus"`
	BillingUnit string `json:"billingUnit"`
	Gateway bool `json:"-"`
	RetryOf string `json:"retryOf" gorm:"size:256;index"`
	Attempt int `json:"attempt"`
	ReservedCredits *float64 `json:"reservedCredits" gorm:"type:decimal(20,2)"`
	SettledCredits *float64 `json:"settledCredits" gorm:"type:decimal(20,2)"`
	ChargedCredits *float64 `json:"chargedCredits" gorm:"type:decimal(20,2)"`
	RefundedCredits *float64 `json:"refundedCredits" gorm:"type:decimal(20,2)"`
	NetCredits *float64 `json:"netCredits" gorm:"type:decimal(20,2)"`
	ActualTokens *int64 `json:"actualTokens"`
	ActualInputTokens *int64 `json:"actualInputTokens"`
	ActualOutputTokens *int64 `json:"actualOutputTokens"`
	CreatedAt string `json:"createdAt" gorm:"index"`
	UpdatedAt string `json:"updatedAt"`
	CompletedAt string `json:"completedAt"`
}

// Links are frozen when a task is first submitted. Rebinding/deleting a shot keeps its history.
type ProductionTaskLink struct {
	RecordID string `json:"-" gorm:"primaryKey;size:256"`
	ProjectID string `json:"-" gorm:"primaryKey;size:128"`
	ShotID string `json:"shotId" gorm:"primaryKey;size:128"`
	UserID string `json:"-" gorm:"size:128;index"`
	WorkspaceID string `json:"workspaceId" gorm:"size:128;index"`
	EpisodeID string `json:"episodeId" gorm:"size:128;index"`
	ShotTitle string `json:"shotTitle"`
}

type ProductionTask struct {
	ProductionTaskRecord
	WorkspaceID string `json:"workspaceId"`
	ShotIDs []string `json:"shotIds"`
	EpisodeIDs []string `json:"episodeIds"`
	ShotTitles []string `json:"shotTitles"`
	CanRetry bool `json:"canRetry"`
	RetryReason string `json:"retryReason"`
}

type ProductionCostSummary struct {
	TaskCount int `json:"taskCount"`
	SettledTaskCount int `json:"settledTaskCount"`
	UnknownTaskCount int `json:"unknownTaskCount"`
	PendingTaskCount int `json:"pendingTaskCount"`
	SettledCredits float64 `json:"settledCredits"`
	HeldCredits float64 `json:"heldCredits"`
	ChargedCredits float64 `json:"chargedCredits"`
	RefundedCredits float64 `json:"refundedCredits"`
}

type ProductionShotCost struct {
	ShotID string `json:"shotId"`
	EpisodeID string `json:"episodeId"`
	ShotTitle string `json:"shotTitle"`
	ProductionCostSummary
}

type ProductionTaskList struct {
	Items []ProductionTask `json:"items"`
	Total int64 `json:"total"`
	Page int `json:"page"`
	PageSize int `json:"pageSize"`
	HasMore bool `json:"hasMore"`
	Summary ProductionCostSummary `json:"summary"`
	ShotCosts []ProductionShotCost `json:"shotCosts"`
	HistoryScope string `json:"historyScope"`
	CostScope string `json:"costScope"`
}
