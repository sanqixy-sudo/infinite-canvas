package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"slices"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/tigerowo/infinite-canvas/config"
	gm "github.com/tigerowo/infinite-canvas/gateway/model"
	gs "github.com/tigerowo/infinite-canvas/gateway/service"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

type GatewaySubmit struct {
	gm.Request
	QuoteID string `json:"quoteId"`
	Source string `json:"source"`
	SourceID string `json:"sourceId"`
	CanvasID string `json:"canvasId"`
	retryOf string
	attempt int
	teamApprovalID string
}

type gatewayQuoteClaims struct {
	UserID string `json:"userId"`
	Hash string `json:"hash"`
	Revision string `json:"revision"`
	gatewayBilling
	jwt.RegisteredClaims
}

type gatewayTaskSnapshot struct {
	BaseURL string `json:"baseUrl"`
	APIKey string `json:"apiKey"`
	Request gm.Request `json:"request"`
	Source string `json:"source"`
	SourceID string `json:"sourceId"`
	CanvasID string `json:"canvasId"`
	gatewayBilling
}

// Both the signed quote and durable task snapshot freeze these billing terms.
type gatewayBilling struct {
	Unit string `json:"unit"`
	QuantitySource string `json:"quantitySource,omitempty"`
	ReserveUnits int64 `json:"reserveUnits,omitempty"`
	VariantID string `json:"variantId,omitempty"`
	TokenMode string `json:"tokenMode"`
	UnitPrice float64 `json:"unitPrice"`
	InputUnitPrice float64 `json:"inputUnitPrice"`
	OutputUnitPrice float64 `json:"outputUnitPrice"`
	ReserveTokens int64 `json:"reserveTokens"`
	ReserveInputTokens int64 `json:"reserveInputTokens"`
	ReserveOutputTokens int64 `json:"reserveOutputTokens"`
}

func gatewayBillingFor(sale model.GatewaySale, tier model.GatewayPriceTier, video bool) gatewayBilling {
	b := gatewayBilling{Unit:sale.Unit,TokenMode:sale.TokenMode,ReserveTokens:sale.ReserveTokens,ReserveInputTokens:sale.ReserveInputTokens,ReserveOutputTokens:sale.ReserveOutputTokens}
	if b.Unit==""{b.Unit="token"}
	if b.Unit!="token"{b.UnitPrice=tier.WithoutVideoCredits;if video{b.UnitPrice=tier.WithVideoCredits};return b}
	if sale.TokenMode == gm.TokenModeInputOutput {
		b.InputUnitPrice,b.OutputUnitPrice = tier.WithoutVideoInputCreditsPerMillion,tier.WithoutVideoOutputCreditsPerMillion
		if video { b.InputUnitPrice,b.OutputUnitPrice = tier.WithVideoInputCreditsPerMillion,tier.WithVideoOutputCreditsPerMillion }
	} else {
		b.UnitPrice = tier.WithoutVideoCreditsPerMillion
		if video { b.UnitPrice = tier.WithVideoCreditsPerMillion }
	}
	return b
}

func (b gatewayBilling) reserveAmount() (float64,error) {
	if b.Unit=="second"||b.Unit=="call"{if b.ReserveUnits<1||b.ReserveUnits>86400{return 0,errors.New("预扣计费数量无效")};return gatewayAmount(b.ReserveUnits*1000000,b.UnitPrice)}
	switch b.TokenMode {
	case gm.TokenModeTotal:
		if b.ReserveTokens <= 0 || b.ReserveTokens > 1000000000 { return 0,errors.New("预扣 Token 配置无效") }
		return gatewayAmount(b.ReserveTokens,b.UnitPrice)
	case gm.TokenModeInputOutput:
		if b.ReserveInputTokens < 0 || b.ReserveOutputTokens < 0 || b.ReserveInputTokens > 1000000000 || b.ReserveOutputTokens > 1000000000 || b.ReserveInputTokens+b.ReserveOutputTokens == 0 || b.ReserveInputTokens+b.ReserveOutputTokens > 1000000000 { return 0,errors.New("分项预扣 Token 配置无效") }
		return gatewayPartsAmount(gatewayCharge{b.ReserveInputTokens,b.InputUnitPrice},gatewayCharge{b.ReserveOutputTokens,b.OutputUnitPrice})
	default: return 0,errors.New("任务计费模式无效，请重新同步模型")
	}
}

func (b gatewayBilling) actualAmount(usage *gm.Usage) (float64,error) {
	if b.Unit=="second"||b.Unit=="call"{if usage==nil||usage.Units==nil||*usage.Units<1||*usage.Units>86400||b.Unit=="call"&&*usage.Units!=1{return 0,errors.New("等待有效实际计费数量")};return gatewayAmount(*usage.Units*1000000,b.UnitPrice)}
	if err := gs.ValidateUsage(b.TokenMode,usage); err != nil { return 0,err }
	if b.TokenMode == gm.TokenModeInputOutput { return gatewayPartsAmount(gatewayCharge{*usage.InputTokens,b.InputUnitPrice},gatewayCharge{*usage.OutputTokens,b.OutputUnitPrice}) }
	return gatewayAmount(usage.TotalTokens,b.UnitPrice)
}

func gatewayHash(value any) string { data,_ := json.Marshal(value); sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }

func gatewaySubmitHash(req GatewaySubmit) string { parts:=[]any{req.Request, req.Source, req.SourceID, req.CanvasID, req.retryOf};if req.teamApprovalID!=""{parts=append(parts,req.teamApprovalID)};return gatewayHash(parts) }

func GatewayTaskByRequest(ctx context.Context, requestID string) (map[string]any,bool,error) {
	user,err:=commerceUser(ctx,false);if err!=nil{return nil,false,err}
	id:="gateway_"+gatewayHash([]string{user.ID,requestID})
	task,found,err:=repository.GetUserVideoTask(user.ID,id)
	if err!=nil || !found{return nil,found,err};return VideoTaskResponse(task),true,nil
}

func gatewayDefinition(cfg model.GatewaySettings, req gm.Request) (gm.ModelDefinition, model.GatewaySale, error) {
	if !cfg.Enabled || cfg.APIKey == "" || cfg.BaseURL == "" { return gm.ModelDefinition{},model.GatewaySale{},safeMessageError{message:"模型中间件尚未启用"} }
	i := slices.IndexFunc(cfg.Catalog,func(d gm.ModelDefinition) bool { return d.ID == req.Model })
	p := slices.IndexFunc(cfg.Models,func(p model.GatewayPolicy) bool { return p.Model == req.Model && p.Enabled })
	if i<0 || p<0 { return gm.ModelDefinition{},model.GatewaySale{},safeMessageError{message:"模型尚未发布或已下架"} }
	def := cfg.Catalog[i]
	if err := gs.ValidateRequest(def,req); err != nil { return def,model.GatewaySale{},safeMessageError{message:err.Error()} }
	sale,err := gatewaySale(def,cfg.Models[p]);if err!=nil{return def,sale,err}
	leaf,id,err:=gs.ResolveDefinition(def,req);if err!=nil{return def,sale,err};if id!=""{for _,v:=range sale.Variants{if v.ID==id{return leaf,v.Sale,nil}};return leaf,sale,errors.New("规格售价尚未发布")};return leaf,sale,nil
}

func gatewayRequestBilling(cfg model.GatewaySettings,req gm.Request)(gatewayBilling,error){
	def,sale,err:=gatewayDefinition(cfg,req);if err!=nil{return gatewayBilling{},err}
	i:=slices.IndexFunc(sale.Tiers,func(t model.GatewayPriceTier)bool{return t.Resolution==req.Parameters.Resolution});if i<0{return gatewayBilling{},safeMessageError{message:"此规格未配置价格"}}
	b:=gatewayBillingFor(sale,sale.Tiers[i],slices.ContainsFunc(req.Inputs,func(i gm.Input)bool{return i.Kind=="video"}));b.VariantID=sale.Tiers[i].VariantID;b.QuantitySource=def.Pricing.QuantitySource;b.ReserveUnits=int64(req.Parameters.Duration);if b.Unit=="call"{b.ReserveUnits=1};return b,nil
}

func QuoteGatewayTask(ctx context.Context, req gm.Request) (map[string]any,error) {
	user,err := commerceUser(ctx,false); if err != nil { return nil,err }
	s,err := repository.GetSettings(); if err != nil { return nil,err }
	billing,err:=gatewayRequestBilling(s.Private.Gateway,req);if err!=nil{return nil,err}
	reserve,err := billing.reserveAmount(); if err != nil { return nil,err }
	expires := time.Now().Add(5*time.Minute)
	claims := gatewayQuoteClaims{UserID:user.ID, Hash:gatewayHash(req), Revision:req.Revision, gatewayBilling:billing, RegisteredClaims:jwt.RegisteredClaims{Audience:jwt.ClaimStrings{"gateway-quote"}, ExpiresAt:jwt.NewNumericDate(expires)}}
	token,err := jwt.NewWithClaims(jwt.SigningMethodHS256,claims).SignedString([]byte(config.Cfg.JWTSecret)); if err != nil { return nil,err }
	return map[string]any{"quoteId":token,"reserveCredits":reserve,"unit":billing.Unit,"quantitySource":billing.QuantitySource,"variantId":billing.VariantID,"reserveUnits":billing.ReserveUnits,"unitPriceCredits":billing.UnitPrice,"tokenMode":billing.TokenMode,"unitPriceCreditsPerMillion":billing.UnitPrice,"inputPriceCreditsPerMillion":billing.InputUnitPrice,"outputPriceCreditsPerMillion":billing.OutputUnitPrice,"reserveTokens":billing.ReserveTokens,"reserveInputTokens":billing.ReserveInputTokens,"reserveOutputTokens":billing.ReserveOutputTokens,"expiresAt":expires.Format(time.RFC3339)},nil
}

func SubmitGatewayTask(ctx context.Context, req GatewaySubmit) (map[string]any,error) {
	user,err := commerceUser(ctx,false); if err != nil { return nil,err }
	if req.RequestID == "" || len(req.RequestID)>128 { return nil,safeMessageError{message:"任务标识无效"} }
	id := "gateway_"+gatewayHash([]string{user.ID,req.RequestID})
	hash := gatewaySubmitHash(req)
	if old,found,err := repository.GetUserVideoTask(user.ID,id); err != nil { return nil,err } else if found {
		if old.GatewayRequestHash != hash { return nil,safeMessageError{message:"同一任务标识不能提交不同内容"} }; return VideoTaskResponse(old),nil
	}
	var claims gatewayQuoteClaims
	_,err = jwt.ParseWithClaims(req.QuoteID,&claims,func(_ *jwt.Token)(any,error){ return []byte(config.Cfg.JWTSecret),nil },jwt.WithValidMethods([]string{"HS256"}),jwt.WithAudience("gateway-quote"),jwt.WithExpirationRequired())
	if err != nil || claims.UserID != user.ID || claims.Hash != gatewayHash(req.Request) || claims.Revision != req.Revision { return nil,safeMessageError{message:"报价已失效或请求已改变，请重新提交"} }
	s,err := repository.GetSettings(); if err != nil { return nil,err }
	currentBilling,err:=gatewayRequestBilling(s.Private.Gateway,req.Request);if err!=nil{return nil,err};if gatewayHash(currentBilling)!=gatewayHash(claims.gatewayBilling){return nil,safeMessageError{message:"规格或售价已变化，请重新报价确认"}}
	reserve,err := claims.reserveAmount(); if err != nil { return nil,err }
	// Namespace request IDs by account; middleware never receives a browser-selected shared ID.
	upstream := req.Request; upstream.RequestID = id
	snapshot := gatewayTaskSnapshot{BaseURL:s.Private.Gateway.BaseURL,APIKey:s.Private.Gateway.APIKey,Request:upstream,Source:req.Source,SourceID:req.SourceID,CanvasID:req.CanvasID,gatewayBilling:claims.gatewayBilling}
	data,_ := json.Marshal(snapshot); body,_ := json.Marshal(req.Request)
	task := model.VideoTask{ID:id,UserID:user.ID,Model:req.Model,ChannelID:"model-gateway",ChannelName:"模型中间件",Source:req.Source,SourceID:req.SourceID,CanvasID:req.CanvasID,Status:"queued",BillingStatus:"reserved",ReservedCredits:reserve,GatewaySnapshot:string(data),GatewayRequestHash:hash,RequestBody:string(body),Seconds:strconv.Itoa(req.Parameters.Duration),Size:req.Parameters.Resolution,CreatedAt:now(),UpdatedAt:now()}
	task.RetryOf, task.Attempt = req.retryOf, max(1, req.attempt)
	task.TeamApprovalID,task.BillingUnit=req.teamApprovalID,claims.Unit
	entry := model.CreditLog{ID:newID("credit"),UserID:user.ID,Type:model.CreditLogTypeAIConsume,Amount:-reserve,RelatedID:id,Remark:"模型生成预扣；按冻结规格规则多退少补",Extra:string(body),CreatedAt:task.CreatedAt}
	task,created,err := repository.ReserveGatewayTask(task,entry)
	if err != nil { if errors.Is(err,repository.ErrGatewayBalance)||errors.Is(err,repository.ErrGatewayConflict)||errors.Is(err,repository.ErrTeamBudget)||errors.Is(err,repository.ErrTeamCanvasTask){ return nil,safeMessageError{message:err.Error()} };return nil,err }
	if created {
		// Dispatch/recovery is owned by the durable poller, independent of the browser connection.
		WakeVideoTaskPoller()
	}
	return VideoTaskResponse(task),nil
}

func PollGatewayVideoTask(ctx context.Context,task model.VideoTask)(VideoTaskPollUpdate,error) {
	var snapshot gatewayTaskSnapshot
	if json.Unmarshal([]byte(task.GatewaySnapshot),&snapshot)!=nil { return VideoTaskPollUpdate{},errors.New("任务配置快照无效") }
	if task.BillingStatus=="pending_balance" {
		usage := &gm.Usage{TotalTokens:task.ActualTokens,InputTokens:task.ActualInputTokens,OutputTokens:task.ActualOutputTokens,Units:task.ActualUnits}
		if _,err := snapshot.actualAmount(usage); err != nil { return VideoTaskPollUpdate{},err }
		result:=gm.TaskResult{ID:task.UpstreamTaskID,RequestID:task.ID,Status:task.Status,BillingStatus:"usage_available",VideoURL:task.VideoURL,Error:task.Error,Progress:task.Progress,Usage:usage}
		return VideoTaskPollUpdate{GatewayResult:&result},nil
	}
	cfg := model.GatewaySettings{BaseURL:snapshot.BaseURL,APIKey:snapshot.APIKey}
	path := "/v1/tasks/by-request/"+url.PathEscape(task.ID)
	if task.UpstreamTaskID!="" { path="/v1/tasks/"+url.PathEscape(task.UpstreamTaskID) }
	var result gm.TaskResult
	err := gatewayCall(ctx,cfg,"GET",path,nil,&result)
	var remote gatewayHTTPError
	if errors.As(err,&remote) && remote.Status==404 && task.UpstreamTaskID=="" {
		// Gateway's persistent request-id deduplication makes crash recovery safe.
		err = gatewayCall(ctx,cfg,"POST","/v1/tasks",snapshot.Request,&result)
		if errors.As(err,&remote) && (remote.Status==400 || remote.Status==409 || remote.Status==422) {
			result = gm.TaskResult{RequestID:task.ID,Status:"failed",BillingStatus:"not_billable",Error:"模型能力或价格版本已变化，请同步后重新生成"}; err=nil
		}
	}
	if err!=nil { return VideoTaskPollUpdate{},err }
	if result.RequestID!=task.ID || (result.Model!="" && result.Model!=task.Model) || (result.VariantID!="" && result.VariantID!=snapshot.VariantID) { return VideoTaskPollUpdate{},errors.New("中间件任务归属或规格不一致") }
	return VideoTaskPollUpdate{GatewayResult:&result},nil
}

func applyGatewayPoll(task model.VideoTask,update VideoTaskPollUpdate) error {
	if update.GatewayResult==nil { return repository.TouchGatewayTask(task.ID,now()) } // transport errors never release a reservation
	r := update.GatewayResult
	task.UpdatedAt,task.LastPolledAt=now(),now(); task.UpstreamTaskID=r.ID
	task.Status=NormalizeVideoTaskStatus(r.Status); if task.Status=="" { task.Status="in_progress" }
	task.Progress=clampProgress(r.Progress); task.Error=r.Error
	if r.VideoURL!="" { task.VideoURL=r.VideoURL }
	b,_:=json.Marshal(r);task.LastResponse=string(b)
	var amount *float64
	failed := task.Status=="failed" || task.Status=="cancelled"
	if failed || task.Status=="completed" {
		var snapshot gatewayTaskSnapshot
		if err:=json.Unmarshal([]byte(task.GatewaySnapshot),&snapshot);err!=nil{return err}
		task.CompletedAt=now();task.BillingStatus="pending_usage"
		_,usageErr:=snapshot.actualAmount(r.Usage)
		if r.BillingStatus=="usage_available" && usageErr==nil {
			actual,err:=snapshot.actualAmount(r.Usage);if err!=nil{return err}
			task.ActualTokens=r.Usage.TotalTokens;task.ActualInputTokens=r.Usage.InputTokens;task.ActualOutputTokens=r.Usage.OutputTokens
			task.ActualUnits=r.Usage.Units
			task.BillingStatus="settled";amount=&actual
		} else if failed && r.Usage==nil && r.BillingStatus=="not_billable" {
			zero:=0.0;amount=&zero;task.BillingStatus="released"
		} else {
			task.Error="生成任务已结束，计费用量尚不完整，等待核对后结算"
		}
	}
	entry:=model.CreditLog{ID:newID("credit"),UserID:task.UserID,RelatedID:task.ID,Remark:"模型任务差额结算",Extra:string(b),CreatedAt:now()}
	return repository.ApplyGatewayTaskResult(task,amount,entry)
}
