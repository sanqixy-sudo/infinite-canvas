package model

type StorageUsage struct {
	UsedBytes      int64 `json:"usedBytes"`
	LimitBytes     int64 `json:"limitBytes"`
	BaseBytes      int64 `json:"baseBytes"`
	ExtraBytes     int64 `json:"extraBytes"`
	RemainingBytes int64 `json:"remainingBytes"`
	OverLimit      bool  `json:"overLimit"`
}

// StorageUploadReservation 只预留上传中的容量，不保存文件或用户凭据。
type StorageUploadReservation struct {
	ID        string `gorm:"primaryKey"`
	UserID    string `gorm:"index:idx_storage_reservation_user_expiry"`
	Bytes     int64
	ExpiresAt int64 `gorm:"index:idx_storage_reservation_user_expiry"`
}
