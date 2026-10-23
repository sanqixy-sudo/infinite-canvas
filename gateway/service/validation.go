package service

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"slices"
	"strings"

	"github.com/tigerowo/infinite-canvas/gateway/model"
)

const SeedanceFast = "doubao-seedance-2-0-fast-260128"
const NewTokenAdapter = "newtoken-seedance-native-v1"
const SeedanceNativeAdapter = "seedance-native-v1"
const NewTokenVideosAdapter = "newtoken-videos-v1"
const DefaultGroup = "特殊分组"

var supportedModels = []string{"doubao-seedance-2-0-260128",SeedanceFast,"doubao-seedance-2-0-mini-260615","doubao-seedance-2-5-260628"}

func DefaultModel() model.ModelConfig {
	return model.ModelConfig{
		ModelDefinition: model.ModelDefinition{ID:SeedanceFast, Name:"Seedance 2.0 Fast", Revision:"seedance-fast-portrait-v1", Group:DefaultGroup,
			Capabilities:model.Capabilities{MaxImages:9, MaxVideos:3, MaxAudios:3, MaxTotal:0, Resolutions:[]string{"720p"}, Ratios:[]string{"9:16"}, MinDuration:4, MaxDuration:15, FirstFrame:true, LastFrame:true},
			Pricing:model.Pricing{TokenMode:model.TokenModeTotal, Unit:"token", Currency:"CNY", Per:1000000, WithoutVideoCents:3700, WithVideoCents:2200, ReserveTokens:500000, Tiers:[]model.PriceTier{{Resolution:"720p",WithoutVideoCents:3700,WithVideoCents:2200}}}},
		Adapter:NewTokenAdapter, Enabled:false,
	}
}

func DefaultModels() []model.ModelConfig {
	items := make([]model.ModelConfig,0,4)
	for _, id := range supportedModels {
		item := DefaultModel(); item.ID = id; item.Revision = "newtoken-portrait-v1"
		switch id {
		case "doubao-seedance-2-0-260128":
			item.Name = "Seedance 2.0"
			item.Pricing.Tiers = []model.PriceTier{{Resolution:"720p",WithoutVideoCents:4600,WithVideoCents:2800}}
		case "doubao-seedance-2-0-mini-260615":
			item.Name = "Seedance 2.0 Mini"; item.Pricing.Tiers = []model.PriceTier{{Resolution:"720p",WithoutVideoCents:2300,WithVideoCents:1400}}
		case "doubao-seedance-2-5-260628":
			item.Name = "Seedance 2.5"
			item.Capabilities.AudioOnly = true
			item.Capabilities.MaxImages, item.Capabilities.MaxVideos, item.Capabilities.MaxAudios, item.Capabilities.MaxDuration = 30,10,10,30
			item.Pricing.Tiers = []model.PriceTier{{Resolution:"720p",WithoutVideoCents:7000,WithVideoCents:4200}}
		}
		item.Pricing.WithoutVideoCents, item.Pricing.WithVideoCents = item.Pricing.Tiers[0].WithoutVideoCents,item.Pricing.Tiers[0].WithVideoCents
		items = append(items,item)
	}
	return items
}

func PriceForResolution(pricing model.Pricing, resolution string) (model.PriceTier,error) {
	if len(pricing.Tiers) == 0 && pricing.TokenMode == model.TokenModeTotal { return model.PriceTier{Resolution:resolution, WithoutVideoCents:pricing.WithoutVideoCents,WithVideoCents:pricing.WithVideoCents},nil }
	for _, tier := range pricing.Tiers { if tier.Resolution == resolution { return tier,nil } }
	return model.PriceTier{},fmt.Errorf("当前分辨率没有对应价格档位")
}

func ValidateDefinition(def model.ModelDefinition) error {
	if len(def.Variants) > 0 { return validateVariants(def) }
	return validateLeafDefinition(def)
}

func validateLeafDefinition(def model.ModelDefinition) error {
	c := def.Capabilities
	if def.ID == "" || def.Name == "" || def.Revision == "" || len(def.ID) > 128 || len(def.Revision) > 128 { return fmt.Errorf("模型 ID、名称和版本不能为空且 ID、版本不超过 128 字符") }
	if c.MaxImages < 0 || c.MaxVideos < 0 || c.MaxAudios < 0 || c.MaxTotal < 0 || c.MinDuration < 1 || c.MaxDuration < c.MinDuration || len(c.Resolutions) == 0 || len(c.Ratios) == 0 { return fmt.Errorf("模型能力配置不完整") }
	if c.MaxDuration>86400 || c.MaxImages>1000 || c.MaxVideos>1000 || c.MaxAudios>1000 || c.MaxTotal>3000 || len(c.Resolutions)>32 || len(c.Ratios)>32 { return fmt.Errorf("模型能力配置超过有效范围") }
	for _,values:=range [][]string{c.Resolutions,c.Ratios}{seen:=map[string]bool{};for _,value:=range values{if strings.TrimSpace(value)==""||value!=strings.TrimSpace(value)||len(value)>32||seen[value]{return fmt.Errorf("分辨率和比例不能为空、重复或过长")};seen[value]=true}}
	for _, supported := range DefaultModels() {
		if supported.ID != def.ID { continue }
		limit := supported.Capabilities
		if !slices.Equal(c.Resolutions, []string{"720p"}) || !slices.Equal(c.Ratios, []string{"9:16"}) { return fmt.Errorf("当前四个特殊渠道模型仅支持固定 720×1280 竖屏（720p、9:16），请核对模型配置后重新发布") }
		if c.MaxImages > limit.MaxImages || c.MaxVideos > limit.MaxVideos || c.MaxAudios > limit.MaxAudios || c.MinDuration < limit.MinDuration || c.MaxDuration > limit.MaxDuration { return fmt.Errorf("能力设置超过当前协议插件确认的上限") }
		if (c.AudioOnly && !limit.AudioOnly) || (c.FirstFrame && !limit.FirstFrame) || (c.LastFrame && !limit.LastFrame) { return fmt.Errorf("当前协议插件不支持所配置的输入模式") }
	}
	p := def.Pricing
	if p.Currency != "CNY" || !slices.Contains([]string{"token","second","call"},p.Unit) || (p.Unit == "token" && p.Per != 1000000) || (p.Unit != "token" && p.Per != 1) { return fmt.Errorf("价格单位须为 CNY/百万 Token、CNY/秒或 CNY/次") }
	if p.Unit != "token" && (p.TokenMode != "" || p.ReserveTokens != 0 || p.ReserveInputTokens != 0 || p.ReserveOutputTokens != 0) { return fmt.Errorf("按秒/次计费不填写 Token 模式与预扣量") }
	if p.Unit == "second" && !slices.Contains([]string{"request_duration","response_duration"},p.QuantitySource) { return fmt.Errorf("按秒计费须明确使用请求时长或响应实际时长") }
	if p.Unit == "call" && p.QuantitySource != "successful_task" { return fmt.Errorf("按次计费须选择 successful_task（成功任务一次）") }
	if p.Unit == "token" {
	switch p.TokenMode {
	case model.TokenModeTotal:
		if p.ReserveTokens <= 0 || p.ReserveTokens > 1000000000 || p.WithoutVideoCents <= 0 || p.WithVideoCents <= 0 { return fmt.Errorf("总量单价必须为正数，预扣总 Token 须在 1–1000000000 之间") }
	case model.TokenModeInputOutput:
		if p.ReserveInputTokens < 0 || p.ReserveOutputTokens < 0 || p.ReserveInputTokens > 1000000000 || p.ReserveOutputTokens > 1000000000 || p.ReserveInputTokens+p.ReserveOutputTokens <= 0 || p.ReserveInputTokens+p.ReserveOutputTokens > 1000000000 { return fmt.Errorf("输入、输出预扣 Token 不能为负数，合计须在 1–1000000000 之间") }
	default: return fmt.Errorf("请选择总 Token 或输入/输出分项计费模式")
	}
	}
	seen := make(map[string]bool)
	for _, tier := range p.Tiers {
		if seen[tier.Resolution] || !slices.Contains(c.Resolutions,tier.Resolution) { return fmt.Errorf("分辨率价格档位重复或无效") }; seen[tier.Resolution] = true
		if (p.Unit != "token" || p.TokenMode == model.TokenModeTotal) && (tier.WithoutVideoCents <= 0 || tier.WithVideoCents <= 0) { return fmt.Errorf("单价必须为正数") }
		if p.TokenMode == model.TokenModeInputOutput && (tier.WithoutVideoInputCents <= 0 || tier.WithoutVideoOutputCents <= 0 || tier.WithVideoInputCents <= 0 || tier.WithVideoOutputCents <= 0) { return fmt.Errorf("无参考视频、有参考视频的输入与输出单价均须为正数") }
	}
	for _, resolution := range c.Resolutions { if _, err := PriceForResolution(p,resolution); err != nil { return err } }
	return nil
}

// ValidateRequest is deterministic and shared with the platform. DNS validation
// belongs to the gateway submission boundary, not this pure validation function.
func ValidateRequest(def model.ModelDefinition, req model.Request) error {
	if err := ValidateDefinition(def); err != nil { return err }
	resolved, _, err := ResolveDefinition(def,req); if err != nil { return err }; def = resolved
	if strings.TrimSpace(req.RequestID) == "" || len(req.RequestID) > 128 { return fmt.Errorf("requestId 必填且最多 128 字符") }
	if req.Model != def.ID || req.Revision != def.Revision { return fmt.Errorf("模型或能力版本已变化，请刷新模型配置后重试") }
	if len(req.Prompt) > 32000 || strings.TrimSpace(req.Prompt) == "" { return fmt.Errorf("请输入提示词；提示词最多 32000 字节") }
	c, p := def.Capabilities, req.Parameters
	if c.Watermark!=nil && !*c.Watermark && p.Watermark!=nil && *p.Watermark {return fmt.Errorf("当前规格不支持水印选项")}
	if !slices.Contains(c.Resolutions, p.Resolution) { return fmt.Errorf("当前模型不支持分辨率 %s", p.Resolution) }
	if !slices.Contains(c.Ratios, p.Ratio) { return fmt.Errorf("当前模型不支持比例 %s", p.Ratio) }
	if p.Duration < c.MinDuration || p.Duration > c.MaxDuration { return fmt.Errorf("当前模型时长须为 %d–%d 秒", c.MinDuration, c.MaxDuration) }
	counts := map[string]int{"image":0,"video":0,"audio":0}
	first, last, references := 0, 0, 0
	for _, input := range req.Inputs {
		if _, exists := counts[input.Kind]; !exists { return fmt.Errorf("不支持素材类型 %s", input.Kind) }
		if err := validateURL(input.URL); err != nil { return err }
		counts[input.Kind]++
		switch input.Role {
		case "first_frame":
			if input.Kind != "image" || !c.FirstFrame { return fmt.Errorf("当前模型不支持此首帧输入") }; first++
		case "last_frame":
			if input.Kind != "image" || !c.LastFrame { return fmt.Errorf("当前模型不支持此尾帧输入") }; last++
		case "", "reference", "reference_image", "reference_video", "reference_audio":
			if input.Role != "" && input.Role != "reference" && input.Role != "reference_"+input.Kind { return fmt.Errorf("素材角色与素材类型不一致") }; references++
		default: return fmt.Errorf("不支持素材角色 %s", input.Role)
		}
	}
	for kind, limit := range map[string]int{"image":c.MaxImages,"video":c.MaxVideos,"audio":c.MaxAudios} {
		if counts[kind] > limit { return fmt.Errorf("当前模型最多支持 %d 个 %s 素材，已连接 %d 个", limit, kind, counts[kind]) }
	}
	if c.MaxTotal > 0 && len(req.Inputs) > c.MaxTotal { return fmt.Errorf("当前模型最多支持 %d 个素材，已连接 %d 个", c.MaxTotal, len(req.Inputs)) }
	if first > 1 || last > 1 || (last > 0 && first == 0) { return fmt.Errorf("首尾帧各最多 1 张，尾帧必须与首帧一起使用") }
	if first+last > 0 && (counts["image"] > 2 || references > 0 || counts["video"] > 0 || counts["audio"] > 0) { return fmt.Errorf("首尾帧模式最多 2 张图片，不能同时使用参考图片、视频或音频") }
	if !c.AudioOnly && counts["audio"] > 0 && counts["image"]+counts["video"] == 0 { return fmt.Errorf("参考音频须与参考图片或视频一起使用") }
	return nil
}

func validateURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" || u.User != nil || u.Fragment != "" { return fmt.Errorf("素材必须是可公开访问的 HTTP(S) URL；不支持 blob、data 或供应商素材 ID") }
	if ip := net.ParseIP(u.Hostname()); ip != nil && !publicIP(ip) { return fmt.Errorf("素材不能指向内网地址") }
	if strings.EqualFold(u.Hostname(), "localhost") || strings.HasSuffix(strings.ToLower(u.Hostname()), ".local") { return fmt.Errorf("素材不能指向本机地址") }
	return nil
}

func publicIP(ip net.IP) bool {
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() { return false }
	if v := ip.To4(); v != nil {
		return !(v[0] == 0 || v[0] == 127 || v[0] >= 224 || (v[0] == 100 && v[1] >= 64 && v[1] <= 127) || (v[0] == 169 && v[1] == 254) || (v[0] == 192 && v[1] == 0 && v[2] == 0) || (v[0] == 198 && (v[1] == 18 || v[1] == 19)))
	}
	return true
}

func validateInputHosts(ctx context.Context, inputs []model.Input) error {
	seen := make(map[string]bool)
	for _, input := range inputs {
		u, _ := url.Parse(input.URL)
		host := u.Hostname()
		if seen[host] { continue }; seen[host] = true
		ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil || len(ips) == 0 { return fmt.Errorf("素材域名暂时无法解析，请检查访问地址") }
		for _, ip := range ips { if !publicIP(ip.IP) { return fmt.Errorf("素材域名解析到内网地址，不能提交") } }
	}
	return nil
}
