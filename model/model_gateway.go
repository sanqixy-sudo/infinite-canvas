package model

import gatewaymodel "github.com/tigerowo/infinite-canvas/gateway/model"

type GatewayPriceTier struct {
	VariantID string `json:"variantId,omitempty"`
	Resolution string `json:"resolution"`
	WithoutVideoCreditsPerMillion float64 `json:"withoutVideoCreditsPerMillion"`
	WithVideoCreditsPerMillion float64 `json:"withVideoCreditsPerMillion"`
	WithoutVideoInputCreditsPerMillion float64 `json:"withoutVideoInputCreditsPerMillion"`
	WithoutVideoOutputCreditsPerMillion float64 `json:"withoutVideoOutputCreditsPerMillion"`
	WithVideoInputCreditsPerMillion float64 `json:"withVideoInputCreditsPerMillion"`
	WithVideoOutputCreditsPerMillion float64 `json:"withVideoOutputCreditsPerMillion"`
	WithoutVideoCredits float64 `json:"withoutVideoCredits"`
	WithVideoCredits float64 `json:"withVideoCredits"`
}

type GatewayPolicy struct {
	Model string `json:"model"`
	Enabled bool `json:"enabled"`
	Mode string `json:"mode"`
	Multiplier float64 `json:"multiplier"`
	CreditsPerYuan float64 `json:"creditsPerYuan"`
	WithoutVideoCreditsPerMillion float64 `json:"withoutVideoCreditsPerMillion"`
	WithVideoCreditsPerMillion float64 `json:"withVideoCreditsPerMillion"`
	Tiers []GatewayPriceTier `json:"tiers"`
	DisplayName string `json:"displayName"`
	Badge string `json:"badge"`
	Remark string `json:"remark"`
}

type GatewaySettings struct {
	Enabled bool `json:"enabled"`
	BaseURL string `json:"baseUrl"`
	APIKey string `json:"apiKey"`
	HasAPIKey bool `json:"hasApiKey"`
	MediaBaseURL string `json:"mediaBaseUrl"`
	Catalog []gatewaymodel.ModelDefinition `json:"catalog"`
	Models []GatewayPolicy `json:"models"`
}

type GatewaySale struct {
	Unit string `json:"unit"`
	TokenMode string `json:"tokenMode"`
	ReserveInputTokens int64 `json:"reserveInputTokens"`
	ReserveOutputTokens int64 `json:"reserveOutputTokens"`
	WithoutVideoCreditsPerMillion float64 `json:"withoutVideoCreditsPerMillion"`
	WithVideoCreditsPerMillion float64 `json:"withVideoCreditsPerMillion"`
	ReserveTokens int64 `json:"reserveTokens"`
	Tiers []GatewayPriceTier `json:"tiers"`
	Variants []GatewayVariantSale `json:"variants,omitempty"`
}

type GatewayVariantSale struct {
	ID string `json:"id"`
	Sale GatewaySale `json:"sale"`
}

type PublicGatewayModel struct {
	gatewaymodel.ModelDefinition
	DisplayName string `json:"displayName"`
	Badge string `json:"badge"`
	Remark string `json:"remark"`
	Sale GatewaySale `json:"sale"`
}
