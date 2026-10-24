package model

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
)

// Credentials may rotate without changing the physical destination of an upload.
func ProductionRenderProviderIdentity(provider StorageProvider, localRoot string) string {
	raw, _ := json.Marshal([]string{provider.ID, provider.Type, provider.Endpoint, provider.Bucket, localRoot})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// ProductionRenderJob keeps the saved-plan snapshot private; only its owner can list jobs.
type ProductionRenderJob struct {
	ID               string `json:"id" gorm:"primaryKey;size:128"`
	UserID           string `json:"-" gorm:"size:128;uniqueIndex:idx_render_user_request,priority:1;index"`
	RequestID        string `json:"requestId" gorm:"size:128;uniqueIndex:idx_render_user_request,priority:2"`
	RequestHash      string `json:"-" gorm:"size:64"`
	WorkspaceID      string `json:"workspaceId" gorm:"size:128;index"`
	EpisodeID        string `json:"episodeId" gorm:"size:128"`
	EpisodeTitle     string `json:"episodeTitle" gorm:"size:180"`
	Revision         int64  `json:"revision"`
	Status           string `json:"status" gorm:"size:20;index"`
	Progress         int    `json:"progress"`
	Seconds          int    `json:"seconds"`
	ShotCount        int    `json:"shotCount"`
	Attempts         int    `json:"attempts"`
	Error            string `json:"error"`
	SnapshotJSON     string `json:"-" gorm:"type:text"`
	ProviderID       string `json:"-"`
	WorkerID         string `json:"-" gorm:"size:128"`
	OutputStorageKey string `json:"outputStorageKey"`
	OutputBytes      int64  `json:"outputBytes"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
}

// One database lease serializes rendering across API replicas.
type ProductionRenderLease struct {
	ID        string `gorm:"primaryKey;size:20"`
	WorkerID  string `gorm:"size:128"`
	ExpiresAt int64
}

// Upload intent precedes physical writes. Uncommitted intents remain retryable cleanup tombstones.
type ProductionRenderUpload struct {
	ID               string `gorm:"primaryKey;size:128"`
	JobID            string `gorm:"size:128;index"`
	UserID           string `gorm:"size:128;index"`
	ProviderID       string
	ProviderIdentity string `gorm:"size:64"`
	ObjectKey        string
	ReservationID    string
	State            string `gorm:"size:20"`
	NextCheckAt      int64  `gorm:"index"`
}
