package model

// TaskCenterItem exposes account-owned task facts without request bodies or provider credentials.
type TaskCenterItem struct {
	ID              string   `json:"id"`
	Kind            string   `json:"kind"`
	Title           string   `json:"title"`
	Model           string   `json:"model"`
	Status          string   `json:"status"`
	Progress        int      `json:"progress"`
	Source          string   `json:"source"`
	CanvasID        string   `json:"canvasId"`
	NodeID          string   `json:"nodeId"`
	WorkspaceID     string   `json:"workspaceId"`
	EpisodeID       string   `json:"episodeId"`
	Workflow        bool     `json:"workflow"`
	Gateway         bool     `json:"gateway"`
	Archived        bool     `json:"archived"`
	CanStop         bool     `json:"canStop"`
	Error           string   `json:"error"`
	BillingStatus   string   `json:"billingStatus"`
	ReservedCredits *float64 `json:"reservedCredits"`
	SettledCredits  *float64 `json:"settledCredits"`
	ChargedCredits  *float64 `json:"chargedCredits"`
	RefundedCredits *float64 `json:"refundedCredits"`
	NetCredits      *float64 `json:"netCredits"`
	CreatedAt       string   `json:"createdAt"`
	UpdatedAt       string   `json:"updatedAt"`
}

type TaskCenterList struct {
	Items    []TaskCenterItem `json:"items"`
	Total    int64            `json:"total"`
	Page     int              `json:"page"`
	PageSize int              `json:"pageSize"`
}
