package model

// AssetFolder 是账号素材 JSON 内的逻辑目录，不对应物理文件路径或数据库表。
type AssetFolder struct {
	ID string `json:"id"`
	Name string `json:"name"`
	ParentID string `json:"parentId"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type AssetFolderInput struct {
	ID string `json:"id,omitempty"`
	Name *string `json:"name,omitempty"`
	ParentID *string `json:"parentId,omitempty"`
}

type AssetOrganizationInput struct {
	IDs []string `json:"ids"`
	FolderIDs *[]string `json:"folderIds,omitempty"`
	AddFolderIDs []string `json:"addFolderIds,omitempty"`
	RemoveFolderIDs []string `json:"removeFolderIds,omitempty"`
	AddTags []string `json:"addTags,omitempty"`
	RemoveTags []string `json:"removeTags,omitempty"`
}
