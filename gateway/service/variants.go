package service

import (
	"fmt"
	"slices"
	"strings"

	"github.com/tigerowo/infinite-canvas/gateway/model"
)

var referenceModes = []string{"text","image","video","audio"}

func ReferenceMode(inputs []model.Input) string {
	mode := "text"
	for _, input := range inputs { if input.Kind == "video" { return "video" }; if input.Kind == "image" { mode = "image" }; if input.Kind == "audio" && mode == "text" { mode = "audio" } }
	return mode
}

func variantModes(variant model.VariantDefinition) []string { if len(variant.ReferenceModes) == 0 { return referenceModes }; return variant.ReferenceModes }
func intersects(a,b []string) bool { for _, value := range a { if slices.Contains(b,value) { return true } }; return false }

func variantLeaf(def model.ModelDefinition, v model.VariantDefinition) model.ModelDefinition {
	def.Variants, def.Capabilities, def.Pricing = nil, v.Capabilities, v.Pricing
	return def
}

func validateVariants(def model.ModelDefinition) error {
	if strings.TrimSpace(def.ID)=="" || len(def.ID)>128 || strings.TrimSpace(def.Name)=="" || strings.TrimSpace(def.Group)=="" || strings.TrimSpace(def.Revision)=="" || len(def.Revision)>128 || len(def.Variants)>64 { return fmt.Errorf("请填写标准模型、分组和版本；每个模型最多 64 个真实规格") }
	seen:=map[string]bool{}
	for i,v:=range def.Variants {
		if strings.TrimSpace(v.ID)=="" || len(v.ID)>128 || seen[v.ID] || strings.TrimSpace(v.Name)=="" { return fmt.Errorf("规格 ID/名称必填且 ID 不得重复") };seen[v.ID]=true
		leaf:=variantLeaf(def,v);leaf.ID="variant"
		if err:=validateLeafDefinition(leaf);err!=nil{return fmt.Errorf("规格 %s：%w",v.Name,err)}
		modes:=map[string]bool{};for _,mode:=range v.ReferenceModes { if !slices.Contains(referenceModes,mode)||modes[mode]{return fmt.Errorf("参考模式仅支持 text/image/video/audio，不能重复")};modes[mode]=true }
		for _,other:=range def.Variants[:i] {
			a,b:=v.Capabilities,other.Capabilities
			if intersects(a.Resolutions,b.Resolutions)&&intersects(a.Ratios,b.Ratios)&&a.MinDuration<=b.MaxDuration&&b.MinDuration<=a.MaxDuration&&intersects(variantModes(v),variantModes(other))&&(v.GenerateAudio==nil||other.GenerateAudio==nil||*v.GenerateAudio==*other.GenerateAudio){return fmt.Errorf("规格 %s 与 %s 条件重叠，不能唯一选择上游；请拆分分辨率、比例、时长或参考模式",v.Name,other.Name)}
		}
	}
	return nil
}

// No priority fallback: the exact settings must identify one and only one real route.
func ResolveDefinition(def model.ModelDefinition, req model.Request) (model.ModelDefinition,string,error) {
	if len(def.Variants)==0 { if req.VariantID!="" {return def,"",fmt.Errorf("当前模型没有该规格")};return def,"",nil }
	matches:=[]model.VariantDefinition{}
	for _,v:=range def.Variants {
		c,p:=v.Capabilities,req.Parameters
		if slices.Contains(c.Resolutions,p.Resolution)&&slices.Contains(c.Ratios,p.Ratio)&&p.Duration>=c.MinDuration&&p.Duration<=c.MaxDuration&&slices.Contains(variantModes(v),ReferenceMode(req.Inputs))&&(v.GenerateAudio==nil||p.GenerateAudio!=nil&&*v.GenerateAudio==*p.GenerateAudio){matches=append(matches,v)}
	}
	if len(matches)!=1 {return def,"",fmt.Errorf("当前分辨率、比例、时长与参考素材没有唯一可用规格，请调整设置或同步目录")}
	if req.VariantID!=""&&req.VariantID!=matches[0].ID{return def,"",fmt.Errorf("所选规格与当前参数不匹配，请重新报价")}
	return variantLeaf(def,matches[0]),matches[0].ID,nil
}

func aggregateVariants(def *model.ModelDefinition) {
	if len(def.Variants)==0{return}
	c:=model.Capabilities{MinDuration:86400}
	for _,v:=range def.Variants { a:=v.Capabilities;for _,r:=range a.Resolutions{if !slices.Contains(c.Resolutions,r){c.Resolutions=append(c.Resolutions,r)}};for _,r:=range a.Ratios{if !slices.Contains(c.Ratios,r){c.Ratios=append(c.Ratios,r)}};c.MinDuration=min(c.MinDuration,a.MinDuration);c.MaxDuration=max(c.MaxDuration,a.MaxDuration);c.MaxImages=max(c.MaxImages,a.MaxImages);c.MaxVideos=max(c.MaxVideos,a.MaxVideos);c.MaxAudios=max(c.MaxAudios,a.MaxAudios);c.FirstFrame=c.FirstFrame||a.FirstFrame;c.LastFrame=c.LastFrame||a.LastFrame;c.AudioOnly=c.AudioOnly||a.AudioOnly }
	def.Capabilities=c;def.Pricing=def.Variants[0].Pricing
}

func resolveConfig(config model.ModelConfig,req model.Request)(model.ModelConfig,error){
	def,id,err:=ResolveDefinition(config.ModelDefinition,req);if err!=nil{return config,err}
	if id!=""{index:=slices.IndexFunc(config.Routes,func(route model.VariantRoute)bool{return route.VariantID==id});if index<0{return config,fmt.Errorf("规格没有已配置的上游路由")};route:=config.Routes[index];config.ChannelID,config.UpstreamModel,config.Adapter=route.ChannelID,route.UpstreamModel,route.Adapter}
	config.ModelDefinition=def;config.Routes=nil
	if config.UpstreamModel==""{config.UpstreamModel=config.ID}
	return config,nil
}
