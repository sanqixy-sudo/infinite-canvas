package model

import "time"

type Channel struct {
	ID string `json:"id" gorm:"primaryKey;size:128"`
	Name string `json:"name"`
	BaseURL string `json:"baseUrl"`
	SubmitPath string `json:"submitPath"`
	QueryPath string `json:"queryPath"`
	Secret string `json:"-"`
	Enabled bool `json:"enabled"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type ChannelInput struct {
	ID string `json:"id"`
	Name string `json:"name"`
	BaseURL string `json:"baseUrl"`
	SubmitPath string `json:"submitPath"`
	QueryPath string `json:"queryPath"`
	APIKey string `json:"apiKey"`
	Enabled bool `json:"enabled"`
}

type ModelConfig struct {
	ModelDefinition
	ChannelID string `json:"channelId"`
	Adapter string `json:"adapter"`
	Enabled bool `json:"enabled"`
	PricingConfirmed bool `json:"pricingConfirmed"`
	UpstreamModel string `json:"upstreamModel,omitempty"`
	Routes []VariantRoute `json:"routes,omitempty"`
}

type VariantRoute struct {
	VariantID string `json:"variantId"`
	ChannelID string `json:"channelId"`
	UpstreamModel string `json:"upstreamModel"`
	Adapter string `json:"adapter"`
}

type ModelRecord struct {
	ID string `gorm:"primaryKey;size:128"`
	ChannelID string `gorm:"index"`
	Enabled bool
	ConfigJSON string
	CreatedAt time.Time
	UpdatedAt time.Time
}

type Task struct {
	ID string `gorm:"primaryKey;size:128"`
	RequestID string `gorm:"uniqueIndex;size:128"`
	PayloadHash string
	RequestJSON string
	ConfigJSON string
	ChannelJSON string
	ChannelID string `gorm:"index"`
	UpstreamID string
	Status string `gorm:"index"`
	BillingStatus string
	VideoURL string
	Error string
	Progress int
	TotalTokens int64
	InputTokens *int64
	OutputTokens *int64
	Units *int64
	PollAttempts int
	NextPollAt time.Time `gorm:"index"`
	CreatedAt time.Time
	UpdatedAt time.Time
}
