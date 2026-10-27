package model

// ModelDefinition is the versioned catalog shared by the platform and gateway.
type ModelDefinition struct {
	ID string `json:"id"`
	Name string `json:"name"`
	Revision string `json:"revision"`
	Group string `json:"group"`
	Capabilities Capabilities `json:"capabilities"`
	Pricing Pricing `json:"pricing"`
	Variants []VariantDefinition `json:"variants,omitempty"`
}

// A variant is a real, configured offer. Its route and credentials remain private.
type VariantDefinition struct {
	ID string `json:"id"`
	Name string `json:"name"`
	ReferenceModes []string `json:"referenceModes"`
	GenerateAudio *bool `json:"generateAudio,omitempty"`
	Capabilities Capabilities `json:"capabilities"`
	Pricing Pricing `json:"pricing"`
}

type Capabilities struct {
	MaxImages int `json:"maxImages"`
	MaxVideos int `json:"maxVideos"`
	MaxAudios int `json:"maxAudios"`
	MaxTotal int `json:"maxTotal"`
	Resolutions []string `json:"resolutions"`
	Ratios []string `json:"ratios"`
	MinDuration int `json:"minDuration"`
	MaxDuration int `json:"maxDuration"`
	FirstFrame bool `json:"firstFrame"`
	LastFrame bool `json:"lastFrame"`
	AudioOnly bool `json:"audioOnly"`
	Watermark *bool `json:"watermark,omitempty"`
}

type Pricing struct {
	TokenMode string `json:"tokenMode"`
	Unit string `json:"unit"`
	Currency string `json:"currency"`
	Per int64 `json:"per"`
	QuantitySource string `json:"quantitySource,omitempty"`
	WithoutVideoCents int64 `json:"withoutVideoCents"`
	WithVideoCents int64 `json:"withVideoCents"`
	ReserveTokens int64 `json:"reserveTokens"`
	ReserveInputTokens int64 `json:"reserveInputTokens"`
	ReserveOutputTokens int64 `json:"reserveOutputTokens"`
	Tiers []PriceTier `json:"tiers,omitempty"`
}

type PriceTier struct {
	Resolution string `json:"resolution"`
	WithoutVideoCents int64 `json:"withoutVideoCents"`
	WithVideoCents int64 `json:"withVideoCents"`
	WithoutVideoInputCents int64 `json:"withoutVideoInputCents"`
	WithoutVideoOutputCents int64 `json:"withoutVideoOutputCents"`
	WithVideoInputCents int64 `json:"withVideoInputCents"`
	WithVideoOutputCents int64 `json:"withVideoOutputCents"`
}

type Parameters struct {
	Resolution string `json:"resolution"`
	Ratio string `json:"ratio"`
	Duration int `json:"duration"`
	GenerateAudio *bool `json:"generateAudio,omitempty"`
	Watermark *bool `json:"watermark,omitempty"`
}

type Input struct {
	Kind string `json:"kind"`
	URL string `json:"url"`
	Role string `json:"role"`
}

type Request struct {
	RequestID string `json:"requestId"`
	Model string `json:"model"`
	Revision string `json:"revision"`
	VariantID string `json:"variantId,omitempty"`
	Prompt string `json:"prompt"`
	Parameters Parameters `json:"parameters"`
	Inputs []Input `json:"inputs"`
}

const TokenModeTotal = "total_tokens"
const TokenModeInputOutput = "input_output_tokens"

type Usage struct {
	TotalTokens int64 `json:"totalTokens"`
	InputTokens *int64 `json:"inputTokens,omitempty"`
	OutputTokens *int64 `json:"outputTokens,omitempty"`
	Units *int64 `json:"units,omitempty"`
}

type TaskResult struct {
	ID string `json:"id"`
	RequestID string `json:"requestId"`
	Model string `json:"model"`
	Revision string `json:"revision"`
	VariantID string `json:"variantId,omitempty"`
	Status string `json:"status"`
	BillingStatus string `json:"billingStatus"`
	VideoURL string `json:"videoUrl,omitempty"`
	Error string `json:"error,omitempty"`
	Progress int `json:"progress"`
	Usage *Usage `json:"usage,omitempty"`
	Parameters Parameters `json:"parameters"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}
