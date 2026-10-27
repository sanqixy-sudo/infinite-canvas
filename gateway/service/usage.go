package service

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/tigerowo/infinite-canvas/gateway/model"
)

const maxUsageTokens int64 = 9007199254740991

type upstreamUsage struct {
	TotalTokens json.RawMessage `json:"total_tokens"`
	InputTokens json.RawMessage `json:"input_tokens"`
	OutputTokens json.RawMessage `json:"output_tokens"`
	PromptTokens json.RawMessage `json:"prompt_tokens"`
	CompletionTokens json.RawMessage `json:"completion_tokens"`
}

func (u upstreamUsage) present() bool {
	return len(u.TotalTokens)+len(u.InputTokens)+len(u.OutputTokens)+len(u.PromptTokens)+len(u.CompletionTokens) > 0
}

// A missing counter differs from a real zero. Never derive one component by subtraction.
func usageCounter(raw json.RawMessage) (*int64,error) {
	if len(raw) == 0 { return nil,nil }
	value := string(raw)
	if value == "" || strings.Trim(value,"0123456789") != "" { return nil,fmt.Errorf("用量必须为非负整数字段") }
	n, err := strconv.ParseInt(value,10,64)
	if err != nil || n < 0 || n > maxUsageTokens { return nil,fmt.Errorf("Token 用量超出有效范围") }
	return &n,nil
}

func tokenCount(raw json.RawMessage) int64 {
	n, err := usageCounter(raw)
	if err != nil || n == nil { return 0 }; return *n
}

// ValidateUsage checks the exact counters needed by the task's frozen billing mode.
func ValidateUsage(mode string, usage *model.Usage) error {
	if usage == nil { return fmt.Errorf("等待上游返回实际 Token 用量") }
	switch mode {
	case model.TokenModeTotal:
		if usage.TotalTokens <= 0 || usage.TotalTokens > maxUsageTokens { return fmt.Errorf("等待上游返回有效 total_tokens") }
	case model.TokenModeInputOutput:
		if usage.InputTokens == nil || usage.OutputTokens == nil { return fmt.Errorf("等待上游返回真实输入与输出 Token；不能从总量推算") }
		input, output := *usage.InputTokens,*usage.OutputTokens
		if input < 0 || output < 0 || input > maxUsageTokens || output > maxUsageTokens || input+output > maxUsageTokens || usage.TotalTokens != input+output { return fmt.Errorf("输入、输出与总 Token 用量不一致或超出有效范围") }
	default: return fmt.Errorf("任务未配置有效 Token 计费模式")
	}
	return nil
}

func parseUsage(mode string, raw upstreamUsage) (*model.Usage,error) {
	total, err := usageCounter(raw.TotalTokens); if err != nil { return nil,err }
	u := &model.Usage{}
	if total != nil { u.TotalTokens = *total }
	if mode == model.TokenModeInputOutput {
		for _, pair := range [][2]json.RawMessage{{raw.InputTokens,raw.OutputTokens},{raw.PromptTokens,raw.CompletionTokens}} {
			if len(pair[0])+len(pair[1]) == 0 { continue }
			input, err := usageCounter(pair[0]); if err != nil { return u,err }
			output, err := usageCounter(pair[1]); if err != nil { return u,err }
			if input == nil || output == nil { return u,fmt.Errorf("上游输入与输出 Token 必须成对返回") }
			if u.InputTokens != nil && (*u.InputTokens != *input || *u.OutputTokens != *output) { return u,fmt.Errorf("输入与输出 Token 的两组别名值冲突") }
			u.InputTokens,u.OutputTokens = input,output
		}
		if total == nil && u.InputTokens != nil && u.OutputTokens != nil { u.TotalTokens = *u.InputTokens+*u.OutputTokens }
	}
	return u,ValidateUsage(mode,u)
}
