package service

import (
	"fmt"
	"slices"
	"strings"
	"github.com/tigerowo/infinite-canvas/gateway/model"
)

func (s *Service) validateRoute(channelID,upstream,adapter string,caps model.Capabilities,pricing model.Pricing,enabled bool)error{
	if strings.TrimSpace(upstream)==""||len(upstream)>256{return fmt.Errorf("每个规格必须填写真实上游模型 ID（最多 256 字符）")}
	if adapter==NewTokenAdapter{
		if !slices.Contains(supportedModels,upstream)||pricing.Unit!="token"{return fmt.Errorf("已有 NewToken 专用插件仅支持四个 Token 模型；其他规格选择对应协议适配器")}
		def:=model.ModelDefinition{ID:upstream,Name:upstream,Revision:"check",Capabilities:caps,Pricing:pricing};if err:=ValidateDefinition(def);err!=nil{return err}
	}else if adapter==NewTokenVideosAdapter{
		if len(caps.Resolutions)!=1||!slices.Contains([]string{"720p","1080p"},caps.Resolutions[0]){return fmt.Errorf("NewToken 第三方按秒协议通过上游模型 ID 固定分辨率；每个规格仅填写 720p 或 1080p 一档")}
		for _,ratio:=range caps.Ratios{if !slices.Contains([]string{"16:9","9:16","1:1","21:9","3:4","4:3"},ratio){return fmt.Errorf("NewToken 第三方按秒协议不支持比例 %s",ratio)}}
		if caps.Watermark==nil||*caps.Watermark{return fmt.Errorf("NewToken /v1/videos 未开放水印参数，请关闭该规格水印能力")}
		if caps.FirstFrame||caps.LastFrame||caps.MaxImages>9||caps.MaxVideos>3||caps.MaxAudios>3||caps.MinDuration<4||caps.MaxDuration>15||pricing.Unit!="second"||pricing.QuantitySource!="request_duration"{return fmt.Errorf("NewToken /v1/videos 适配器按请求时长计秒，4–15秒、9图/3视频/3音频，不接受首尾帧")}
	}else if adapter!=SeedanceNativeAdapter{return fmt.Errorf("请选择已实现的 Seedance 协议适配器")}
	if channelID==""{if enabled{return fmt.Errorf("发布前必须选择真实渠道")};return nil}
	channel,err:=s.store.Channel(channelID);if err!=nil||enabled&&!channel.Enabled{return fmt.Errorf("规格渠道不存在或未启用")};return nil
}

func (s *Service) validateRoutes(config model.ModelConfig)error{
	if len(config.Variants)==0{upstream:=config.UpstreamModel;if upstream==""{upstream=config.ID};if len(config.Routes)>0{return fmt.Errorf("无规格模型不能配置规格路由")};if config.Adapter==NewTokenVideosAdapter{return fmt.Errorf("NewToken /v1/videos 请创建规格并明确固定的生成音频条件")};return s.validateRoute(config.ChannelID,upstream,config.Adapter,config.Capabilities,config.Pricing,config.Enabled)}
	if len(config.Routes)!=len(config.Variants){return fmt.Errorf("每个规格必须且只能配置一条上游路由")}
	seen:=map[string]bool{}
	for _,route:=range config.Routes{
		i:=slices.IndexFunc(config.Variants,func(v model.VariantDefinition)bool{return v.ID==route.VariantID});if i<0||seen[route.VariantID]{return fmt.Errorf("路由规格不存在或重复")};seen[route.VariantID]=true;v:=config.Variants[i]
		if route.Adapter==NewTokenVideosAdapter&&v.GenerateAudio==nil{return fmt.Errorf("规格 %s：/v1/videos 未开放生成音频开关，请按渠道实际输出填写固定音频条件",v.Name)}
		if err:=s.validateRoute(route.ChannelID,route.UpstreamModel,route.Adapter,v.Capabilities,v.Pricing,config.Enabled);err!=nil{return fmt.Errorf("规格 %s：%w",v.Name,err)}
	};return nil
}
