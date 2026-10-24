package model

// ProductionProject owns a short-drama plan independently of its canvas JSON.
type ProductionProject struct {
	ID          string `json:"id" gorm:"primaryKey;size:128"`
	UserID      string `json:"-" gorm:"not null;size:128;uniqueIndex:idx_production_user_workspace,priority:1"`
	WorkspaceID string `json:"workspaceId" gorm:"not null;size:128;uniqueIndex:idx_production_user_workspace,priority:2"`
	Title       string `json:"title" gorm:"size:180"`
	Synopsis    string `json:"synopsis"`
	StyleGuide  string `json:"styleGuide"`
	Revision    int64  `json:"revision" gorm:"not null"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

type ProductionNodeRef struct {
	CanvasID string `json:"canvasId"`
	NodeID   string `json:"nodeId"`
}

type ProductionEpisode struct {
	ProjectID string `json:"-" gorm:"primaryKey;size:128"`
	ID        string `json:"id" gorm:"primaryKey;size:128"`
	Title     string `json:"title" gorm:"size:180"`
	Script    string `json:"script"`
	Order     int    `json:"order"`
	Delivery *ProductionDeliveryEdit `json:"delivery,omitempty" gorm:"serializer:json"`
}

type ProductionAudioTrack struct {
	ID string `json:"id"`
	ShotID string `json:"shotId"`
	StorageKey string `json:"storageKey"`
	Label string `json:"label"`
	StartSeconds float64 `json:"startSeconds"`
	TrimStartSeconds float64 `json:"trimStartSeconds"`
	DurationSeconds float64 `json:"durationSeconds"`
	Gain float64 `json:"gain"`
}

type ProductionSubtitle struct {
	ID string `json:"id"`
	ShotID string `json:"shotId"`
	StartSeconds float64 `json:"startSeconds"`
	EndSeconds float64 `json:"endSeconds"`
	Text string `json:"text"`
}

type ProductionDeliveryEdit struct {
	OriginalGain float64 `json:"originalGain"`
	BurnSubtitles bool `json:"burnSubtitles"`
	AudioTracks []ProductionAudioTrack `json:"audioTracks"`
	Subtitles []ProductionSubtitle `json:"subtitles"`
}

type ProductionScene struct {
	ProjectID   string `json:"-" gorm:"primaryKey;size:128"`
	ID          string `json:"id" gorm:"primaryKey;size:128"`
	EpisodeID   string `json:"episodeId" gorm:"size:128"`
	Title       string `json:"title" gorm:"size:180"`
	Description string `json:"description"`
	Order       int    `json:"order"`
}

type ProductionAsset struct {
	ProjectID   string              `json:"-" gorm:"primaryKey;size:128"`
	ID          string              `json:"id" gorm:"primaryKey;size:128"`
	Kind        string              `json:"kind" gorm:"size:20"`
	Title       string              `json:"title" gorm:"size:180"`
	Description string              `json:"description"`
	VariantOf   string              `json:"variantOf" gorm:"size:128"`
	References  []ProductionNodeRef `json:"references" gorm:"column:node_references;serializer:json"`
}

type ProductionCandidate struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Kind       string `json:"kind"`
	CanvasID   string `json:"canvasId"`
	NodeID     string `json:"nodeId"`
	StorageKey string `json:"storageKey"`
	Content    string `json:"content"`
}

type ProductionShot struct {
	ProjectID   string   `json:"-" gorm:"primaryKey;size:128"`
	ID          string   `json:"id" gorm:"primaryKey;size:128"`
	EpisodeID   string   `json:"episodeId" gorm:"size:128"`
	SceneID     string   `json:"sceneId" gorm:"size:128"`
	Order       int      `json:"order"`
	Title       string   `json:"title" gorm:"size:180"`
	Description string   `json:"description"`
	Dialogue    string   `json:"dialogue"`
	Camera      string   `json:"camera"`
	Seconds     int      `json:"seconds"`
	AssetIDs    []string `json:"assetIds" gorm:"serializer:json"`
	CanvasID    string   `json:"canvasId" gorm:"size:128;index"`
	TextNodeID  string   `json:"textNodeId" gorm:"size:128"`
	ImageNodeID string   `json:"imageNodeId" gorm:"size:128"`
	VideoNodeID string   `json:"videoNodeId" gorm:"size:128"`
	Status      string   `json:"status" gorm:"size:20"`
	Candidates               []ProductionCandidate `json:"candidates" gorm:"serializer:json"`
	SelectedImageCandidateID string                `json:"selectedImageCandidateId" gorm:"size:128"`
	SelectedVideoCandidateID string                `json:"selectedVideoCandidateId" gorm:"size:128"`
}

type ProductionDocument struct {
	ProductionProject
	Episodes []ProductionEpisode `json:"episodes"`
	Scenes   []ProductionScene   `json:"scenes"`
	Assets   []ProductionAsset   `json:"assets"`
	Shots    []ProductionShot    `json:"shots"`
}
