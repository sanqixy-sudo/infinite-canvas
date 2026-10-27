package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/tigerowo/infinite-canvas/gateway/model"
	"github.com/tigerowo/infinite-canvas/gateway/repository"
)

func validRequest() model.Request {
	def := DefaultModel()
	return model.Request{RequestID:"request-one",Model:def.ID,Revision:def.Revision,Prompt:"城市夜景",Parameters:model.Parameters{Resolution:"720p",Ratio:"9:16",Duration:5}}
}

func TestFourSpecialModelsUseOnlyFixedPortraitAndIndependentPrices(t *testing.T) {
	prices := map[string]int64{"doubao-seedance-2-0-260128":4600, SeedanceFast:3700, "doubao-seedance-2-0-mini-260615":2300, "doubao-seedance-2-5-260628":7000}
	for _, config := range DefaultModels() { t.Run(config.ID,func(t *testing.T) {
		if config.Group != "特殊分组" || len(config.Pricing.Tiers) != 1 || config.Pricing.Tiers[0].Resolution != "720p" || config.Pricing.WithoutVideoCents != prices[config.ID] { t.Fatal("each model must keep its own 720p price in the special group") }
		req := validRequest(); req.Model,req.Revision = config.ID,config.Revision
		if err := ValidateRequest(config.ModelDefinition,req); err != nil { t.Fatal(err) }
		for _, ratio := range []string{"16:9","1:1","adaptive"} { invalid := req; invalid.Parameters.Ratio = ratio; if ValidateRequest(config.ModelDefinition,invalid) == nil { t.Fatalf("unsupported ratio accepted: %s",ratio) } }
		for _, resolution := range []string{"480p","1080p"} { invalid := req; invalid.Parameters.Resolution = resolution; if ValidateRequest(config.ModelDefinition,invalid) == nil { t.Fatalf("unsupported resolution accepted: %s",resolution) } }
		broad := config.ModelDefinition; broad.Capabilities.Ratios = []string{"9:16","16:9"}
		if ValidateDefinition(broad) == nil || ValidateRequest(broad,req) == nil { t.Fatal("old broad capabilities must require explicit reconfiguration") }
		broad = config.ModelDefinition; broad.Capabilities.Resolutions = []string{"720p","1080p"}
		if ValidateDefinition(broad) == nil { t.Fatal("1080p capabilities must not be published") }
		broad = config.ModelDefinition; broad.Capabilities.MaxVideos++
		if ValidateDefinition(broad) == nil { t.Fatal("catalog must not advertise inputs beyond the plugin limit") }
		lower := config.ModelDefinition; lower.Capabilities.MaxVideos--
		if err := ValidateDefinition(lower); err != nil { t.Fatal("lower channel limits must remain configurable",err) }
	}) }
}

func TestPublishedInvalidPortraitConfigRequiresAdminReview(t *testing.T) {
	store,err := repository.Open(filepath.Join(t.TempDir(),"gateway.db")); if err != nil { t.Fatal(err) }; defer store.Close()
	s,err := New(store,strings.Repeat("a",32),strings.Repeat("b",32),base64.StdEncoding.EncodeToString(make([]byte,32))); if err != nil { t.Fatal(err) }
	if err := s.SaveChannel(model.ChannelInput{ID:"test",Name:"test",BaseURL:"https://example.com",APIKey:"test-key",Enabled:true}); err != nil { t.Fatal(err) }
	config := DefaultModel(); config.ChannelID,config.Enabled,config.PricingConfirmed = "test",true,true; config.Capabilities.Ratios = []string{"16:9","9:16"}
	if err := store.SaveModel(config); err != nil { t.Fatal(err) }
	if _,err := s.Models(false); err == nil { t.Fatal("invalid published catalog must not be silently advertised") }
	configs,err := s.Models(true); if err != nil || len(configs) != 4 { t.Fatal("administrator must still be able to inspect all saved models") }
	for _, saved := range configs { if saved.ID == config.ID && len(saved.Capabilities.Ratios) != 2 { t.Fatal("reading the catalog must not rewrite saved configuration") } }
}

func TestCapabilitiesRejectUnsupportedInputsWithoutTruncating(t *testing.T) {
	def, req := DefaultModel(),validRequest()
	for range 4 { req.Inputs = append(req.Inputs,model.Input{Kind:"video",URL:"https://example.com/video.mp4",Role:"reference"}) }
	if ValidateRequest(def.ModelDefinition,req) == nil { t.Fatal("four videos must be rejected") }
	if len(req.Inputs) != 4 { t.Fatal("validation must preserve connected inputs") }
	req.Inputs = nil; req.Parameters.Resolution = "1080p"
	if ValidateRequest(def.ModelDefinition,req) == nil { t.Fatal("Fast must not silently accept 1080p") }
}

func TestFirstLastFramesCannotMixWithReferenceMode(t *testing.T) {
	req := validRequest()
	req.Inputs = []model.Input{{Kind:"image",URL:"https://example.com/1.jpg",Role:"first_frame"},{Kind:"video",URL:"https://example.com/v.mp4",Role:"reference"}}
	if ValidateRequest(DefaultModel().ModelDefinition,req) == nil { t.Fatal("mixed frame modes must fail") }
}

func TestNoGuessedAggregateLimitAndModelSpecificAudio(t *testing.T) {
	req := validRequest()
	for range 9 { req.Inputs = append(req.Inputs,model.Input{Kind:"image",URL:"https://example.com/i.jpg"}) }
	for range 3 { req.Inputs = append(req.Inputs,model.Input{Kind:"video",URL:"https://example.com/v.mp4"}) }
	for range 3 { req.Inputs = append(req.Inputs,model.Input{Kind:"audio",URL:"https://example.com/a.mp3"}) }
	if err := ValidateRequest(DefaultModel().ModelDefinition,req); err != nil { t.Fatal(err) }
	req.Inputs = []model.Input{{Kind:"audio",URL:"https://example.com/a.mp3"}}
	if ValidateRequest(DefaultModel().ModelDefinition,req) == nil { t.Fatal("2.0 requires a visual reference with audio") }
	for _, def := range DefaultModels() { if strings.Contains(def.ID,"2-5") { req.Model,req.Revision = def.ID,def.Revision; if err := ValidateRequest(def.ModelDefinition,req); err != nil { t.Fatal(err) } } }
}

func TestStrictActualUsageAndPendingSuccess(t *testing.T) {
	for _, raw := range []string{"", "null", "0", "-1", "1.5", `"123"`, "1e3"} {
		if tokenCount(json.RawMessage(raw)) != 0 { t.Fatalf("invalid usage accepted: %q",raw) }
	}
	if tokenCount(json.RawMessage("300000")) != 300000 { t.Fatal("valid usage rejected") }
	config, _ := json.Marshal(DefaultModel())
	task := model.Task{Status:"running",ConfigJSON:string(config)}; response := upstreamResponse{Status:"succeeded"}; response.Content.VideoURL = "https://example.com/result.mp4"
	applyResult(&task,response)
	if task.Status != "completed" || task.BillingStatus != "pending_usage" || task.VideoURL == "" { t.Fatal("successful result with missing usage must remain pending settlement") }
	applyResult(&task,upstreamResponse{Status:"failed"})
	if task.Status != "completed" || task.BillingStatus != "pending_usage" { t.Fatal("later failure must not undo a known successful task") }
	response.Usage.TotalTokens = json.RawMessage("300000"); applyResult(&task,response)
	if task.TotalTokens != 300000 || task.BillingStatus != "usage_available" { t.Fatal("actual usage was not persisted") }
}

func TestResolutionPriceDoesNotFallBack(t *testing.T) {
	p := DefaultModel().Pricing
	if _,err := PriceForResolution(p,"1080p"); err == nil { t.Fatal("missing price tier must reject") }
	if tier,err := PriceForResolution(p,"720p"); err != nil || tier.WithoutVideoCents != 3700 { t.Fatal("wrong price tier") }
}

func TestIdempotencyAndUnknownSubmissionNeverResubmit(t *testing.T) {
	for _, status := range []int{200,503} { t.Run(http.StatusText(status),func(t *testing.T){
		var calls atomic.Int32
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){ calls.Add(1); w.Header().Set("Content-Type","application/json"); w.WriteHeader(status); _,_ = w.Write([]byte(`{"id":"upstream-task"}`)) })); defer server.Close()
		store,err := repository.Open(filepath.Join(t.TempDir(),"gateway.db")); if err != nil { t.Fatal(err) }; defer store.Close()
		s,err := New(store,strings.Repeat("a",32),strings.Repeat("b",32),base64.StdEncoding.EncodeToString(make([]byte,32))); if err != nil { t.Fatal(err) }
		if err := s.SaveChannel(model.ChannelInput{ID:"test",Name:"test",BaseURL:server.URL,APIKey:"test-key",Enabled:true}); err != nil { t.Fatal(err) }
		config := DefaultModel(); config.ChannelID,config.Revision,config.Enabled,config.PricingConfirmed = "test","test-v2",true,true
		if err := s.SaveModel(config); err != nil { t.Fatal(err) }
		req := validRequest(); req.Revision = config.Revision
		first,err := s.Submit(context.Background(),req); if err != nil { t.Fatal(err) }
		second,err := s.Submit(context.Background(),req); if err != nil || second.ID != first.ID || calls.Load() != 1 { t.Fatal("same request generated more than once") }
		if status == 503 && second.Status != "submission_unknown" { t.Fatal("5xx cannot be treated as a safe rejection") }
		req.Prompt = "另一个请求"
		if _,err := s.Submit(context.Background(),req); err == nil || calls.Load() != 1 { t.Fatal("changed payload with same requestId must conflict") }
	}) }
}
