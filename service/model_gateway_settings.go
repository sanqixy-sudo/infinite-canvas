package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"math/big"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	gm "github.com/tigerowo/infinite-canvas/gateway/model"
	gs "github.com/tigerowo/infinite-canvas/gateway/service"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

var gatewayHTTP = &http.Client{Timeout: 90 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}

type gatewayHTTPError struct { Status int }
func (e gatewayHTTPError) Error() string { return fmt.Sprintf("模型中间件返回 HTTP %d，请检查中间件日志", e.Status) }

func gatewayCall(ctx context.Context, cfg model.GatewaySettings, method, path string, body, out any) error {
	var reader io.Reader
	if body != nil { b, err := json.Marshal(body); if err != nil { return err }; reader = bytes.NewReader(b) }
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(cfg.BaseURL, "/")+path, reader)
	if err != nil { return errors.New("中间件地址无效") }
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := gatewayHTTP.Do(req)
	if err != nil { return errors.New("无法确认中间件响应，请稍后查看任务状态") }
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 { return gatewayHTTPError{resp.StatusCode} }
	var envelope struct { Code int `json:"code"`; Data json.RawMessage `json:"data"` }
	if json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&envelope) != nil || envelope.Code != 0 { return errors.New("中间件响应格式无效") }
	return json.Unmarshal(envelope.Data, out)
}

func publicGatewayConfig(cfg model.GatewaySettings) model.GatewaySettings {
	cfg.HasAPIKey = cfg.APIKey != ""
	cfg.APIKey = ""
	if cfg.Catalog == nil { cfg.Catalog = []gm.ModelDefinition{} }
	if cfg.Models == nil { cfg.Models = []model.GatewayPolicy{} }
	return cfg
}

func AdminGatewaySettings(ctx context.Context) (model.GatewaySettings, error) {
	if _, err := commerceUser(ctx, true); err != nil { return model.GatewaySettings{}, err }
	s, err := repository.GetSettings()
	return publicGatewayConfig(s.Private.Gateway), err
}

func SaveGatewaySettings(ctx context.Context, cfg model.GatewaySettings) (model.GatewaySettings, error) {
	if _, err := commerceUser(ctx, true); err != nil { return cfg, err }
	s, err := repository.GetSettings(); if err != nil { return cfg, err }
	cfg.BaseURL = strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	cfg.MediaBaseURL = strings.TrimRight(strings.TrimSpace(cfg.MediaBaseURL), "/")
	for _, raw := range []string{cfg.BaseURL, cfg.MediaBaseURL} {
		if raw == "" { continue }; u, err := url.Parse(raw)
		if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") { return cfg, safeMessageError{message:"地址须为不含用户名、查询参数的 HTTP(S) 地址"} }
	}
	if cfg.APIKey == "" { cfg.APIKey = s.Private.Gateway.APIKey }
	if cfg.Enabled && (cfg.BaseURL == "" || cfg.APIKey == "") { return cfg, safeMessageError{message:"请先填写中间件地址和连接密钥"} }
	// Catalog can only be changed through synchronization, never supplied by the browser.
	cfg.Catalog = s.Private.Gateway.Catalog
	seen := map[string]bool{}
	for _, policy := range cfg.Models {
		if seen[policy.Model] { return cfg, safeMessageError{message:"模型定价重复"} }; seen[policy.Model] = true
		if !policy.Enabled { continue }
		index := slices.IndexFunc(cfg.Catalog, func(m gm.ModelDefinition) bool { return m.ID == policy.Model })
		if index < 0 { return cfg, safeMessageError{message:"模型未同步，请先同步模型清单"} }
		if _, err := gatewaySale(cfg.Catalog[index], policy); err != nil { return cfg, err }
	}
	s.Private.Gateway = cfg
	if err:=validateGatewayChannelConflicts(s);err!=nil{return model.GatewaySettings{},err}
	_, err = repository.SaveSettings(s, now())
	return publicGatewayConfig(cfg), err
}

func validateGatewayChannelConflicts(s model.Settings) error {
	if !s.Private.Gateway.Enabled{return nil}
	for _,policy:=range s.Private.Gateway.Models {
		if !policy.Enabled{continue}
		for _,channel:=range s.Private.Channels {
			if channel.Enabled && slices.Contains(channel.Models,policy.Model){return safeMessageError{message:"模型 "+policy.Model+" 已在旧渠道启用，请先停用旧渠道中的同名模型再发布中间件模型"}}
		}
	}
	return nil
}

func SyncGatewayModels(ctx context.Context) (model.GatewaySettings, error) {
	if _, err := commerceUser(ctx, true); err != nil { return model.GatewaySettings{}, err }
	s, err := repository.GetSettings(); if err != nil { return model.GatewaySettings{}, err }
	cfg := s.Private.Gateway
	if cfg.BaseURL == "" || cfg.APIKey == "" { return cfg, safeMessageError{message:"请先保存中间件地址和连接密钥"} }
	var catalog []gm.ModelDefinition
	if err := gatewayCall(ctx, cfg, "GET", "/v1/models", nil, &catalog); err != nil { return model.GatewaySettings{}, err }
	seen := map[string]bool{}
	for _, def := range catalog {
		if def.ID == "" || seen[def.ID] || gs.ValidateDefinition(def) != nil { return model.GatewaySettings{}, safeMessageError{message:"中间件模型清单、计费模式或价格配置无效"} }
		seen[def.ID] = true
		if slices.IndexFunc(cfg.Models, func(p model.GatewayPolicy) bool { return p.Model == def.ID }) < 0 {
			cfg.Models = append(cfg.Models, model.GatewayPolicy{Model:def.ID, Mode:"multiplier", Multiplier:1, CreditsPerYuan:1})
		}
	}
	// A changed price/capability revision requires explicit republishing.
	for i := range cfg.Models {
		old := slices.IndexFunc(cfg.Catalog, func(d gm.ModelDefinition) bool { return d.ID == cfg.Models[i].Model })
		fresh := slices.IndexFunc(catalog, func(d gm.ModelDefinition) bool { return d.ID == cfg.Models[i].Model })
		if fresh < 0 || old < 0 || cfg.Catalog[old].Revision != catalog[fresh].Revision { cfg.Models[i].Enabled = false }
	}
	cfg.Catalog = catalog
	s.Private.Gateway = cfg
	_, err = repository.SaveSettings(s, now())
	return publicGatewayConfig(cfg), err
}

func decimalRat(v float64) *big.Rat { r, _ := new(big.Rat).SetString(strconv.FormatFloat(v, 'f', -1, 64)); return r }

// Decimal rationals preserve rate precision; each reservation or final total rounds once to 0.01 credits.
func gatewayAmount(tokens int64, rate float64) (float64, error) {
	return gatewayPartsAmount(gatewayCharge{tokens,rate})
}

type gatewayCharge struct { Tokens int64; Rate float64 }

func gatewayPartsAmount(parts ...gatewayCharge) (float64, error) {
	r := new(big.Rat)
	for _, part := range parts {
		if part.Tokens < 0 || part.Tokens > 9007199254740991 || math.IsNaN(part.Rate) || math.IsInf(part.Rate, 0) || part.Rate < 0 || part.Rate > 100000000 { return 0, errors.New("Token 用量或价格无效") }
		r.Add(r,new(big.Rat).Mul(new(big.Rat).SetInt64(part.Tokens),decimalRat(part.Rate)))
	}
	// Sum input/output decimal charges before rounding once for the whole task.
	r.Quo(r, big.NewRat(10000, 1)) // cents per task
	q, rem := new(big.Int), new(big.Int); q.QuoRem(r.Num(), r.Denom(), rem)
	if new(big.Int).Lsh(rem, 1).Cmp(r.Denom()) >= 0 { q.Add(q, big.NewInt(1)) }
	if !q.IsInt64() || q.Int64() > 100000000000000 { return 0, errors.New("结算金额超过钱包安全范围") }
	return float64(q.Int64()) / 100, nil
}

func gatewaySale(def gm.ModelDefinition, p model.GatewayPolicy) (model.GatewaySale, error) {
	sale := model.GatewaySale{Unit:def.Pricing.Unit,TokenMode:def.Pricing.TokenMode,ReserveTokens:def.Pricing.ReserveTokens,ReserveInputTokens:def.Pricing.ReserveInputTokens,ReserveOutputTokens:def.Pricing.ReserveOutputTokens}
	if err := gs.ValidateDefinition(def); err != nil { return sale,safeMessageError{message:err.Error()} }
	if len(def.Variants)>0 {
		for _,v:=range def.Variants{
			leaf:=def;leaf.Variants=nil;leaf.ID="variant";leaf.Capabilities,leaf.Pricing=v.Capabilities,v.Pricing
			policy:=p;policy.Tiers=nil;for _,tier:=range p.Tiers{if tier.VariantID==v.ID{policy.Tiers=append(policy.Tiers,tier)}}
			part,err:=gatewaySale(leaf,policy);if err!=nil{return sale,err};for i:=range part.Tiers{part.Tiers[i].VariantID=v.ID}
			sale.Variants=append(sale.Variants,model.GatewayVariantSale{ID:v.ID,Sale:part})
		};sale.Unit="variants";return sale,nil
	}
	invalid := func(v float64) bool { return math.IsNaN(v) || math.IsInf(v, 0) || v <= 0 || v > 100000000 }
	if p.Mode != "fixed" && p.Mode != "multiplier" { return sale, safeMessageError{message:"请选择倍率或固定售价"} }
	if p.Mode == "multiplier" && (invalid(p.Multiplier) || invalid(p.CreditsPerYuan)) { return sale, safeMessageError{message:"倍率和每元算力须为有效正数"} }
	for _, resolution := range def.Capabilities.Resolutions {
		tier := model.GatewayPriceTier{Resolution:resolution}
		if p.Mode == "multiplier" {
			base, err := gs.PriceForResolution(def.Pricing, resolution); if err != nil { return sale, err }
			convert := func(cents int64) float64 {
				r := new(big.Rat).Mul(big.NewRat(cents,100), decimalRat(p.CreditsPerYuan)); r.Mul(r, decimalRat(p.Multiplier)); v,_ := r.Float64(); return v
			}
			tier.WithoutVideoCreditsPerMillion, tier.WithVideoCreditsPerMillion = convert(base.WithoutVideoCents), convert(base.WithVideoCents)
			if sale.Unit!="token" {tier.WithoutVideoCredits,tier.WithVideoCredits=tier.WithoutVideoCreditsPerMillion,tier.WithVideoCreditsPerMillion;tier.WithoutVideoCreditsPerMillion,tier.WithVideoCreditsPerMillion=0,0}
			tier.WithoutVideoInputCreditsPerMillion, tier.WithoutVideoOutputCreditsPerMillion = convert(base.WithoutVideoInputCents), convert(base.WithoutVideoOutputCents)
			tier.WithVideoInputCreditsPerMillion, tier.WithVideoOutputCreditsPerMillion = convert(base.WithVideoInputCents), convert(base.WithVideoOutputCents)
		} else {
			i := slices.IndexFunc(p.Tiers,func(t model.GatewayPriceTier) bool { return t.Resolution == resolution })
			if i < 0 { return sale, safeMessageError{message:"固定售价必须填写每个分辨率的有/无参考视频两档价格"} }; tier = p.Tiers[i]
		}
		rates := []float64{tier.WithoutVideoCreditsPerMillion,tier.WithVideoCreditsPerMillion}
		if sale.Unit!="token"{rates=[]float64{tier.WithoutVideoCredits,tier.WithVideoCredits}}
		if sale.TokenMode == gm.TokenModeInputOutput { rates = []float64{tier.WithoutVideoInputCreditsPerMillion,tier.WithoutVideoOutputCreditsPerMillion,tier.WithVideoInputCreditsPerMillion,tier.WithVideoOutputCreditsPerMillion} }
		for _, rate := range rates { if invalid(rate) { return sale, safeMessageError{message:"请完整填写当前计费模式下每个分辨率、参考视频档位的有效正数售价"} } }
		sale.Tiers = append(sale.Tiers,tier)
	}
	if len(sale.Tiers) == 0 { return sale, errors.New("模型未配置分辨率") }
	sale.WithoutVideoCreditsPerMillion = sale.Tiers[0].WithoutVideoCreditsPerMillion
	sale.WithVideoCreditsPerMillion = sale.Tiers[0].WithVideoCreditsPerMillion
	return sale,nil
}

func appendGatewayPublic(settings *model.PublicSetting, cfg model.GatewaySettings) {
	if !cfg.Enabled { return }
	channel := model.PublicModelChannelInfo{ID:"model-gateway", Protocol:"gateway", Name:"模型中间件", Enabled:true, Weight:1, ModelCapabilities:map[string]string{}}
	for _, def := range cfg.Catalog {
		i := slices.IndexFunc(cfg.Models,func(p model.GatewayPolicy) bool { return p.Model == def.ID && p.Enabled })
		if i < 0 { continue }; p := cfg.Models[i]
		sale, err := gatewaySale(def,p); if err != nil { continue }
		channel.Models = append(channel.Models,def.ID); channel.ModelCapabilities[def.ID] = "video"
		published:=model.PublicGatewayModel{ModelDefinition:def, DisplayName:p.DisplayName, Badge:p.Badge, Remark:p.Remark, Sale:sale}
		channel.GatewayModels = append(channel.GatewayModels,published)
		reserve := 0.0
		parts:=[]model.GatewayVariantSale{{Sale:sale}};if len(sale.Variants)>0{parts=sale.Variants}
		for _,part:=range parts{for _, tier := range part.Sale.Tiers { for _, video := range []bool{false,true} {
			billing:=gatewayBillingFor(part.Sale,tier,video);billing.ReserveUnits=int64(def.Capabilities.MaxDuration);if billing.Unit=="call"{billing.ReserveUnits=1}
			amount, err := billing.reserveAmount(); if err == nil { reserve = math.Max(reserve,amount) }
		} }}
		settings.ModelChannel.ModelCosts = slices.DeleteFunc(settings.ModelChannel.ModelCosts,func(c model.ModelCost) bool { return c.Model == def.ID })
		settings.ModelChannel.ModelCosts = append(settings.ModelChannel.ModelCosts,model.ModelCost{Model:def.ID, Credits:reserve, BillingUnit:sale.Unit, Gateway:&published, TokenMode:sale.TokenMode, ReserveCredits:reserve, ReserveTokens:sale.ReserveTokens, ReserveInputTokens:sale.ReserveInputTokens, ReserveOutputTokens:sale.ReserveOutputTokens, WithoutVideoCreditsPerMillion:sale.WithoutVideoCreditsPerMillion, WithVideoCreditsPerMillion:sale.WithVideoCreditsPerMillion, Tiers:sale.Tiers})
		if !slices.Contains(settings.ModelChannel.AvailableModels,def.ID) { settings.ModelChannel.AvailableModels = append(settings.ModelChannel.AvailableModels,def.ID) }
	}
	if len(channel.Models)>0 { settings.ModelChannel.Channels = append(settings.ModelChannel.Channels,channel) }
}
