package model

// Team groups explicitly shared production plans, assets and review versions.
type Team struct {
	ID string `json:"id" gorm:"primaryKey;size:128"`
	Name string `json:"name" gorm:"size:180"`
	OwnerID string `json:"ownerId" gorm:"size:128;index"`
	CreatedAt string `json:"createdAt"`
	DeletedAt string `json:"-"`
}

type TeamMember struct {
	TeamID string `json:"-" gorm:"primaryKey;size:128"`
	UserID string `json:"userId" gorm:"primaryKey;size:128;index"`
	Role string `json:"role" gorm:"size:20"`
	CanViewCosts bool `json:"canViewCosts"`
	JoinedAt string `json:"joinedAt"`
	DisplayName string `json:"displayName" gorm:"->;-:migration"`
}

// TeamProject grants collaboration on one explicitly shared production plan.
type TeamProject struct {
	ID string `json:"id" gorm:"primaryKey;size:128"`
	TeamID string `json:"teamId" gorm:"size:128;index"`
	OwnerUserID string `json:"ownerUserId" gorm:"size:128;index"`
	WorkspaceID string `json:"-" gorm:"size:128;index"`
	Title string `json:"title" gorm:"size:180"`
	EditAllowed bool `json:"editAllowed"`
	CreatedAt string `json:"createdAt"`
	RevokedAt string `json:"-"`
}

type TeamAsset struct {
	ID string `json:"id" gorm:"primaryKey;size:128"`
	TeamID string `json:"teamId" gorm:"size:128;index"`
	OwnerUserID string `json:"ownerUserId" gorm:"size:128;index"`
	ObjectID string `json:"-" gorm:"size:128;index"`
	Title string `json:"title" gorm:"size:180"`
	Kind string `json:"kind" gorm:"size:20"`
	CreatedAt string `json:"createdAt"`
	RevokedAt string `json:"-"`
}

type TeamAudit struct {
	ID string `json:"id" gorm:"primaryKey;size:128"`
	TeamID string `json:"teamId" gorm:"size:128;index"`
	ActorID string `json:"actorId" gorm:"size:128"`
	Action string `json:"action" gorm:"size:80"`
	TargetID string `json:"targetId" gorm:"size:128"`
	Summary string `json:"summary" gorm:"size:500"`
	CreatedAt string `json:"createdAt" gorm:"index"`
}

type TeamInvite struct {
	ID string `json:"id" gorm:"primaryKey;size:128"`
	TeamID string `json:"-" gorm:"size:128;index"`
	CodeHash string `json:"-" gorm:"size:64;uniqueIndex"`
	CreatedBy string `json:"createdBy" gorm:"size:128"`
	ExpiresAt string `json:"expiresAt"`
	UsedAt string `json:"usedAt"`
	RevokedAt string `json:"revokedAt"`
	CreatedAt string `json:"createdAt"`
}

type ProductionReview struct {
	ID string `json:"id" gorm:"primaryKey;size:128"`
	TeamID string `json:"teamId" gorm:"size:128;index"`
	PublisherID string `json:"publisherId" gorm:"size:128;index"`
	WorkspaceID string `json:"-" gorm:"size:128"`
	Title string `json:"title" gorm:"size:180"`
	SourceRevision int64 `json:"sourceRevision"`
	Snapshot string `json:"-" gorm:"type:text"`
	MediaObjectIDs []string `json:"-" gorm:"serializer:json"`
	CreatedAt string `json:"createdAt"`
	RevokedAt string `json:"-"`
}

type ProductionReviewComment struct {
	ID string `json:"id" gorm:"primaryKey;size:128"`
	ReviewID string `json:"reviewId" gorm:"size:128;index"`
	ShotID string `json:"shotId" gorm:"size:128;index"`
	AuthorID string `json:"authorId" gorm:"size:128"`
	Body string `json:"body" gorm:"size:2000"`
	CreatedAt string `json:"createdAt"`
	AuthorName string `json:"authorName" gorm:"->;-:migration"`
}
