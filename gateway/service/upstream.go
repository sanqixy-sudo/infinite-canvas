package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/tigerowo/infinite-canvas/gateway/model"
)

type upstreamResponse struct {
	ID string `json:"id"`
	Status string `json:"status"`
	Content struct { VideoURL string `json:"video_url"` } `json:"content"`
	Usage upstreamUsage `json:"usage"`
	Data json.RawMessage `json:"data"`
	Duration json.RawMessage `json:"duration"`
}

func nativePayload(req model.Request, tokenMode string) map[string]any {
	content := make([]map[string]any,0,len(req.Inputs)+1)
	if strings.TrimSpace(req.Prompt) != "" { content = append(content,map[string]any{"type":"text","text":req.Prompt}) }
	for _, input := range req.Inputs {
		kind, role := input.Kind+"_url", input.Role
		if role == "" || role == "reference" { role = "reference_"+input.Kind }
		content = append(content,map[string]any{"type":kind, kind:map[string]string{"url":input.URL}, "role":role})
	}
	payload := map[string]any{"model":req.Model,"content":content,"resolution":req.Parameters.Resolution,"ratio":req.Parameters.Ratio,"duration":req.Parameters.Duration,"billing_mode":tokenMode}
	if req.Model == "doubao-seedance-2-5-260628" && slices.ContainsFunc(req.Inputs,func(input model.Input) bool { return input.Kind == "video" }) { payload["omni_reference_task_type"] = "reference" }
	if req.Parameters.GenerateAudio != nil { payload["generate_audio"] = *req.Parameters.GenerateAudio }
	if req.Parameters.Watermark != nil { payload["watermark"] = *req.Parameters.Watermark }
	return payload
}

func (s *Service) call(ctx context.Context, channel model.Channel, method, path string, payload any) (upstreamResponse,int,error) {
	var data []byte; var err error
	if payload != nil { data, err = json.Marshal(payload); if err != nil { return upstreamResponse{},0,err } }
	key, err := s.decrypt(channel.Secret); if err != nil { return upstreamResponse{},0,fmt.Errorf("无法解密渠道密钥") }
	req, err := http.NewRequestWithContext(ctx, method, channel.BaseURL+path, bytes.NewReader(data))
	if err != nil { return upstreamResponse{},0,err }
	req.Header.Set("Authorization","Bearer "+key)
	req.Header.Set("Content-Type","application/json")
	resp, err := s.client.Do(req); if err != nil { return upstreamResponse{},0,fmt.Errorf("上游请求未取得确认") }
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 { return upstreamResponse{},resp.StatusCode,fmt.Errorf("上游 HTTP %d",resp.StatusCode) }
	raw, err := io.ReadAll(io.LimitReader(resp.Body,4*1024*1024+1))
	if err != nil || len(raw) > 4*1024*1024 { return upstreamResponse{},resp.StatusCode,fmt.Errorf("上游响应读取失败或过大") }
	var response upstreamResponse
	if err := json.Unmarshal(raw,&response); err != nil { return response,resp.StatusCode,fmt.Errorf("上游任务响应格式不正确") }
	// The custom New API native presenter returns a flat task; allow its JSON data wrapper too.
	if response.ID == "" && response.Status == "" && len(response.Data) > 0 {
		if err := json.Unmarshal(response.Data,&response); err != nil { return response,resp.StatusCode,fmt.Errorf("上游任务响应格式不正确") }
	}
	return response,resp.StatusCode,nil
}

func (s *Service) submitUpstream(ctx context.Context, task *model.Task, channel model.Channel, req model.Request) {
	var config model.ModelConfig
	if err := json.Unmarshal([]byte(task.ConfigJSON),&config); err != nil { task.Status,task.BillingStatus,task.Error = "failed","not_billable","任务配置快照无效，未提交上游"; return }
	upstream:=req;upstream.Model=config.UpstreamModel;if upstream.Model==""{upstream.Model=req.Model}
	payload:=nativePayload(upstream,config.Pricing.TokenMode)
	if config.Adapter!=NewTokenAdapter{delete(payload,"billing_mode")}
	if config.Adapter==NewTokenVideosAdapter {
		payload=map[string]any{"model":upstream.Model,"prompt":req.Prompt,"duration":req.Parameters.Duration,"ratio":req.Parameters.Ratio}
		for _,kind:=range []string{"image","video","audio"}{urls:=[]string{};for _,input:=range req.Inputs{if input.Kind==kind{urls=append(urls,input.URL)}};if len(urls)>0{payload["reference_"+kind+"s"]=urls}}
	}
	response, status, err := s.call(ctx,channel,http.MethodPost,channel.SubmitPath,payload)
	if err != nil || strings.TrimSpace(response.ID) == "" {
		task.Status, task.Error = "submission_unknown", "上游提交结果未确认，请管理员核对任务；系统不会自动再次提交"
		if status >= 400 && status < 500 && status != http.StatusRequestTimeout {
			task.Status, task.BillingStatus, task.Error = "failed","not_billable",fmt.Sprintf("上游拒绝提交（HTTP %d）",status)
		}
		return
	}
	task.UpstreamID, task.Status = response.ID,"queued"
	task.NextPollAt = time.Now().Add(5*time.Second)
}

func applyResult(task *model.Task, response upstreamResponse) {
	status := strings.ToLower(response.Status)
	switch status {
	case "queued","pending","submitted":
		if task.Status != "completed" { task.Status = "queued" }
	case "running","processing","in_progress":
		if task.Status != "completed" { task.Status, task.Progress = "running",50 }
	case "succeeded","success","completed":
		task.Status, task.Progress, task.Error = "completed",100,""
		if response.Content.VideoURL != "" { task.VideoURL = response.Content.VideoURL }
		applyTaskUsage(task,response)
	case "failed","error","cancelled","canceled","expired":
		// A known successful snapshot must not become a refunded failure after an upstream timeout.
		if task.Status != "completed" {
			task.Status, task.Error = "failed","上游生成失败，请查看你的 New API 任务详情"
			var config model.ModelConfig
			if json.Unmarshal([]byte(task.ConfigJSON), &config) != nil { task.BillingStatus = "pending_usage" } else if config.Pricing.Unit == "token" && (response.Usage.present() || task.BillingStatus == "pending_usage") { applyUsage(task,response.Usage) } else { task.BillingStatus = "not_billable" }
		}
	default: task.Error = "上游任务状态尚未识别，将继续查询"
	}
}

func applyUsage(task *model.Task, raw upstreamUsage) {
	var config model.ModelConfig
	if err := json.Unmarshal([]byte(task.ConfigJSON),&config); err != nil { task.BillingStatus,task.Error = "pending_usage","任务计费快照无效，保留结果等待核对"; return }
	usage, err := parseUsage(config.Pricing.TokenMode,raw)
	if usage != nil {
		if usage.TotalTokens > 0 { task.TotalTokens = usage.TotalTokens }
		if usage.InputTokens != nil { task.InputTokens = usage.InputTokens }
		if usage.OutputTokens != nil { task.OutputTokens = usage.OutputTokens }
	}
	if err != nil { task.BillingStatus,task.Error = "pending_usage",err.Error()+"；保留结果等待结算"; return }
	task.TotalTokens,task.InputTokens,task.OutputTokens = usage.TotalTokens,usage.InputTokens,usage.OutputTokens
	task.BillingStatus = "usage_available"
}

func applyTaskUsage(task *model.Task,response upstreamResponse){
	var config model.ModelConfig
	if json.Unmarshal([]byte(task.ConfigJSON),&config)!=nil{task.BillingStatus="pending_usage";return}
	if config.Pricing.Unit=="token"{applyUsage(task,response.Usage);return}
	var units *int64
	if config.Pricing.Unit=="call"&&config.Pricing.QuantitySource=="successful_task"{n:=int64(1);units=&n}
	if config.Pricing.Unit=="second"{
		if config.Pricing.QuantitySource=="request_duration"{var req model.Request;if json.Unmarshal([]byte(task.RequestJSON),&req)==nil{n:=int64(req.Parameters.Duration);units=&n}}else{units,_=usageCounter(response.Duration)}
	}
	if units==nil||*units<1||*units>86400{task.BillingStatus,task.Error="pending_usage","缺少有效计费数量，保留结果等待结算";return}
	task.Units,task.BillingStatus=units,"usage_available"
}

func (s *Service) poll(ctx context.Context, task model.Task) {
	var snapshot channelSnapshot
	if err := json.Unmarshal([]byte(task.ChannelJSON),&snapshot); err != nil { log.Printf("gateway task %s: invalid channel snapshot",task.ID); return }
	snapshot.Channel.Secret = snapshot.Secret
	path := strings.Replace(snapshot.QueryPath,"{id}",url.PathEscape(task.UpstreamID),1)
	response, _, err := s.call(ctx,snapshot.Channel,http.MethodGet,path,nil)
	task.PollAttempts++
	if err == nil { applyResult(&task,response) } else { task.Error = "任务查询暂时失败，将继续查询；不会重新提交生成" }
	delay := 10*time.Second
	if err != nil || task.BillingStatus == "pending_usage" {
		delay = time.Duration(min(task.PollAttempts,30))*10*time.Second
	}
	task.NextPollAt = time.Now().Add(delay)
	if err := s.store.SaveTask(&task); err != nil { log.Printf("gateway task %s: cannot save polling state",task.ID) }
}

func (s *Service) Run(ctx context.Context) {
	ticker := time.NewTicker(5*time.Second); defer ticker.Stop()
	for {
		select {
		case <-ctx.Done(): return
		case <-ticker.C:
			tasks, err := s.store.DueTasks(time.Now()); if err != nil { log.Print("gateway: cannot load pending tasks"); continue }
			var wg sync.WaitGroup; workers := make(chan struct{},4)
			for _, task := range tasks {
				if ctx.Err() != nil { break }
				workers <- struct{}{}; wg.Add(1)
				go func(task model.Task) { defer wg.Done(); defer func(){ <-workers }(); s.poll(ctx,task) }(task)
			}
			wg.Wait()
		}
	}
}

// ResolveSubmission binds an independently verified upstream task, never resubmits it.
func (s *Service) ResolveSubmission(id, upstreamID string) (model.TaskResult,error) {
	if upstreamID == "" || len(upstreamID) > 256 || strings.ContainsAny(upstreamID,"/\\?#\r\n") { return model.TaskResult{},failure(400,"请填写有效的上游任务 ID") }
	task, err := s.store.Task(id); if err != nil { return model.TaskResult{},recordError(err) }
	if task.Status != "submission_unknown" { return model.TaskResult{},failure(409,"仅提交结果未知的任务支持人工认领") }
	task.UpstreamID, task.Status, task.Error = upstreamID,"queued",""
	task.NextPollAt = time.Now()
	if err := s.store.ResolveTask(&task); err != nil { return model.TaskResult{},failure(409,err.Error()) }
	return result(task),nil
}
