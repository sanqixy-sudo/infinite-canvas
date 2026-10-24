package model

type StorageFile struct {
	ID            string `json:"id"`
	StorageKey    string `json:"storageKey"`
	Name          string `json:"name"`
	MimeType      string `json:"mimeType"`
	Bytes         int64  `json:"bytes"`
	CreatedAt     string `json:"createdAt"`
	ProviderType  string `json:"providerType"`
	DeletePending bool   `json:"deletePending"`
}

type StorageFileBlocker struct {
	Type  string `json:"type"`
	ID    string `json:"id"`
	Title string `json:"title"`
}

type StorageFileReferences struct {
	File               StorageFile          `json:"file"`
	AssetCount         int                  `json:"assetCount"`
	CompletedTaskCount int                  `json:"completedTaskCount"`
	Blockers           []StorageFileBlocker `json:"blockers"`
	CanDelete          bool                 `json:"canDelete"`
	Reason             string               `json:"reason"`
}

type StorageFileList struct {
	Items []StorageFileReferences `json:"items"`
	Total int64                   `json:"total"`
}

type StorageFileDeletion struct {
	DeletedID  string `json:"deletedId"`
	FreedBytes int64  `json:"freedBytes"`
}
