package service

import (
	"encoding/json"
	"testing"

	"github.com/tigerowo/infinite-canvas/gateway/model"
)

func splitConfig() model.ModelConfig {
	config := DefaultModel()
	config.Pricing.TokenMode = model.TokenModeInputOutput
	config.Pricing.ReserveInputTokens,config.Pricing.ReserveOutputTokens = 100000,400000
	config.Pricing.Tiers = []model.PriceTier{{Resolution:"720p",WithoutVideoInputCents:1035,WithoutVideoOutputCents:2070,WithVideoInputCents:1200,WithVideoOutputCents:2400}}
	return config
}

func TestSplitUsageUsesActualCompleteCounters(t *testing.T) {
	for _, test := range []struct { name, raw string; valid bool; total int64 }{
		{"real counters",`{"input_tokens":100000,"output_tokens":200000,"total_tokens":300000}`,true,300000},
		{"zero input",`{"input_tokens":0,"output_tokens":200000}`,true,200000},
		{"zero output",`{"prompt_tokens":100000,"completion_tokens":0}`,true,100000},
		{"both zero",`{"input_tokens":0,"output_tokens":0,"total_tokens":0}`,true,0},
		{"matching aliases",`{"input_tokens":2,"output_tokens":3,"prompt_tokens":2,"completion_tokens":3}`,true,5},
		{"only total",`{"total_tokens":300000}`,false,0},
		{"only completion",`{"total_tokens":300000,"completion_tokens":200000}`,false,0},
		{"missing output",`{"input_tokens":0}`,false,0},
		{"crossed aliases",`{"input_tokens":2,"completion_tokens":3}`,false,0},
		{"incomplete second alias",`{"input_tokens":2,"output_tokens":3,"prompt_tokens":2}`,false,0},
		{"alias conflict",`{"input_tokens":2,"output_tokens":3,"prompt_tokens":4,"completion_tokens":3}`,false,0},
		{"total mismatch",`{"input_tokens":2,"output_tokens":3,"total_tokens":6}`,false,0},
		{"null total",`{"input_tokens":2,"output_tokens":3,"total_tokens":null}`,false,0},
		{"null input",`{"input_tokens":null,"output_tokens":3}`,false,0},
		{"negative",`{"input_tokens":-1,"output_tokens":3}`,false,0},
		{"string",`{"input_tokens":"2","output_tokens":3}`,false,0},
		{"fraction",`{"input_tokens":2.5,"output_tokens":3}`,false,0},
		{"exponent",`{"input_tokens":2e2,"output_tokens":3}`,false,0},
		{"sum too large",`{"input_tokens":9007199254740991,"output_tokens":1}`,false,0},
	} { t.Run(test.name,func(t *testing.T) {
		var raw upstreamUsage
		if err := json.Unmarshal([]byte(test.raw),&raw); err != nil { t.Fatal(err) }
		usage, err := parseUsage(model.TokenModeInputOutput,raw)
		if (err == nil) != test.valid { t.Fatalf("valid=%v, got %v",test.valid,err) }
		if test.valid && (usage.InputTokens == nil || usage.OutputTokens == nil || usage.TotalTokens != test.total) { t.Fatal("actual counter identity lost") }
	}) }
}

func TestSplitDefinitionNeedsPricesAndExplicitMode(t *testing.T) {
	config := splitConfig()
	if err := ValidateDefinition(config.ModelDefinition); err != nil { t.Fatal(err) }
	config.Pricing.TokenMode = ""
	if ValidateDefinition(config.ModelDefinition) == nil { t.Fatal("missing mode must require explicit configuration") }
	config = splitConfig(); config.Pricing.Tiers[0].WithVideoOutputCents = 0
	if ValidateDefinition(config.ModelDefinition) == nil { t.Fatal("missing output rate must not use total rate") }
	config = splitConfig(); config.Pricing.Tiers = nil
	if ValidateDefinition(config.ModelDefinition) == nil { t.Fatal("split mode must not fall back to total prices") }
	config = splitConfig(); config.Pricing.ReserveInputTokens,config.Pricing.ReserveOutputTokens = 0,500000
	if err := ValidateDefinition(config.ModelDefinition); err != nil { t.Fatal("one zero reserve is allowed",err) }
	config.Pricing.ReserveOutputTokens = 0
	if ValidateDefinition(config.ModelDefinition) == nil { t.Fatal("empty reserve must fail") }
	config.Pricing.ReserveInputTokens,config.Pricing.ReserveOutputTokens = 1000000000,1
	if ValidateDefinition(config.ModelDefinition) == nil { t.Fatal("reserve sum must remain bounded") }
}

func TestSplitTaskRetainsResultUntilActualCountersArrive(t *testing.T) {
	snapshot, _ := json.Marshal(splitConfig())
	task := model.Task{Status:"running",ConfigJSON:string(snapshot)}
	var response upstreamResponse
	_ = json.Unmarshal([]byte(`{"status":"succeeded","content":{"video_url":"https://example.com/result.mp4"},"usage":{"total_tokens":300000}}`),&response)
	applyResult(&task,response)
	if task.Status != "completed" || task.BillingStatus != "pending_usage" || task.VideoURL == "" || task.InputTokens != nil { t.Fatal("total alone cannot settle split billing") }
	_ = json.Unmarshal([]byte(`{"status":"succeeded","usage":{"total_tokens":300000,"input_tokens":0,"output_tokens":300000}}`),&response)
	applyResult(&task,response)
	if task.BillingStatus != "usage_available" || task.InputTokens == nil || *task.InputTokens != 0 || *task.OutputTokens != 300000 || task.VideoURL == "" { t.Fatal("valid later usage must settle without losing the result") }
}

func TestFailedSplitTaskWithUsageDoesNotRefundUnknownCounters(t *testing.T) {
	snapshot, _ := json.Marshal(splitConfig())
	task := model.Task{Status:"running",ConfigJSON:string(snapshot)}
	var response upstreamResponse
	_ = json.Unmarshal([]byte(`{"status":"failed","usage":{"total_tokens":123}}`),&response)
	applyResult(&task,response)
	if task.Status != "failed" || task.BillingStatus != "pending_usage" { t.Fatal("possible billed usage must remain pending") }
	applyResult(&task,upstreamResponse{Status:"failed"})
	if task.BillingStatus != "pending_usage" { t.Fatal("later missing usage must not erase a known billing uncertainty") }
	task = model.Task{Status:"running",ConfigJSON:string(snapshot)}
	applyResult(&task,upstreamResponse{Status:"failed"})
	if task.BillingStatus != "not_billable" { t.Fatal("failure without billed usage should allow refund") }
}

func TestZeroSplitUsageRemainsVisibleAndPayloadFreezesMode(t *testing.T) {
	snapshot, _ := json.Marshal(splitConfig())
	task := model.Task{Status:"running",ConfigJSON:string(snapshot)}
	var response upstreamResponse
	_ = json.Unmarshal([]byte(`{"status":"succeeded","usage":{"input_tokens":0,"output_tokens":0}}`),&response)
	applyResult(&task,response)
	r := result(task)
	if task.BillingStatus != "usage_available" || r.Usage == nil || r.Usage.InputTokens == nil || r.Usage.OutputTokens == nil || r.Usage.TotalTokens != 0 { t.Fatal("zero is real usage, not absent usage") }
	if nativePayload(validRequest(),model.TokenModeInputOutput)["billing_mode"] != model.TokenModeInputOutput { t.Fatal("New API must receive the frozen mode") }
}
