package model

type VideoTask struct {
    TeamApprovalID string `json:"-" gorm:"size:128;index"`
	BillingUnit string `json:"billingUnit,omitempty"`
	ActualUnits *int64 `json:"actualUnits,omitempty"`
	SubmissionHash string `json:"-"`
	RetryOf string `json:"retryOf,omitempty" gorm:"size:256;index"`
	Attempt int `json:"attempt"`
	GatewaySnapshot string `json:"-" gorm:"type:text"`
	GatewayRequestHash string `json:"-"`
	BillingStatus string `json:"billingStatus,omitempty" gorm:"index"`
	ReservedCredits float64 `json:"reservedCredits" gorm:"type:decimal(20,2)"`
	SettledCredits float64 `json:"settledCredits" gorm:"type:decimal(20,2)"`
	ActualTokens int64 `json:"actualTokens"`
	ActualInputTokens *int64 `json:"actualInputTokens"`
	ActualOutputTokens *int64 `json:"actualOutputTokens"`
	ID                           string  `json:"id" gorm:"primaryKey"`
	UserID                       string  `json:"userId" gorm:"index"`
	UserDisplayName              string  `json:"userDisplayName"`
	Model                        string  `json:"model" gorm:"index"`
	ChannelID                    string  `json:"channelId" gorm:"index"`
	UserChannelID                string  `json:"userChannelId" gorm:"index"`
	ChannelName                  string  `json:"channelName"`
	WorkflowRef                  string  `json:"workflowRef,omitempty" gorm:"type:text"`
	Source                       string  `json:"source" gorm:"index"`
	SourceID                     string  `json:"source_id" gorm:"index"`
	CanvasID                     string  `json:"canvasId" gorm:"index"`
	UpstreamTaskID               string  `json:"upstreamTaskId" gorm:"index"`
	UpstreamVideoID              string  `json:"upstreamVideoId" gorm:"index"`
	Status                       string  `json:"status" gorm:"index:idx_video_tasks_status_created_at,priority:1"`
	Progress                     int     `json:"progress"`
	Seconds                      string  `json:"seconds"`
	Size                         string  `json:"size"`
	VideoURL                     string  `json:"videoUrl" gorm:"type:text"`
	Error                        string  `json:"error" gorm:"type:text"`
	ErrorDetail                  string  `json:"errorDetail" gorm:"type:text"`
	RequestBody                  string  `json:"requestBody" gorm:"type:text"`
	ParameterTranslationSnapshot string  `json:"-" gorm:"type:text"`
	ResponseBody                 string  `json:"responseBody" gorm:"type:text"`
	LastResponse                 string  `json:"lastResponse" gorm:"type:text"`
	Credits                      float64 `json:"credits" gorm:"type:decimal(20,2)"`
	CreatedAt                    string  `json:"createdAt" gorm:"index;index:idx_video_tasks_status_created_at,priority:2"`
	UpdatedAt                    string  `json:"updatedAt" gorm:"index"`
	StartedAt                    string  `json:"startedAt"`
	CompletedAt                  string  `json:"completedAt"`
	LastPolledAt                 string  `json:"lastPolledAt" gorm:"index"`
}
