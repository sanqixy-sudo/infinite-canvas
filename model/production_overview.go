package model

// Read-only projections; these are not database tables.
type ProductionOverview struct {
	ProductionProject
	EpisodeCount      int64 `json:"episodeCount"`
	ShotCount         int64 `json:"shotCount"`
	AssetCount        int64 `json:"assetCount"`
	SelectedShotCount int64 `json:"selectedShotCount"`
	RenderCount       int64 `json:"renderCount"`
}

type ProductionOverviewList struct {
	Items    []ProductionOverview `json:"items"`
	Total    int64                `json:"total"`
	Page     int                  `json:"page"`
	PageSize int                  `json:"pageSize"`
}

type ProductionDeliveryItem struct {
	ProductionRenderJob
	ProjectTitle  string `json:"projectTitle"`
	FileAvailable bool   `json:"fileAvailable"`
}

type ProductionDeliveryList struct {
	Items    []ProductionDeliveryItem `json:"items"`
	Total    int64                    `json:"total"`
	Page     int                      `json:"page"`
	PageSize int                      `json:"pageSize"`
}
