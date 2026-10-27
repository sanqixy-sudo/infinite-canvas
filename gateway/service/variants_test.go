package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/tigerowo/infinite-canvas/gateway/model"
	"github.com/tigerowo/infinite-canvas/gateway/repository"
)

func variantTestConfig() model.ModelConfig {
	base := DefaultModel()
	base.ID,base.Name,base.Group,base.Revision="standard-model","标准模型","测试分组","variants-1"
	for _,resolution:=range []string{"720p","1080p"}{
		caps:=base.Capabilities;caps.Resolutions=[]string{resolution};caps.Ratios=[]string{"9:16"}
		pricing:=base.Pricing;pricing.Tiers=[]model.PriceTier{{Resolution:resolution,WithoutVideoCents:3700,WithVideoCents:2200}}
		base.Variants=append(base.Variants,model.VariantDefinition{ID:resolution,Name:resolution,Capabilities:caps,Pricing:pricing})
		base.Routes=append(base.Routes,model.VariantRoute{VariantID:resolution,ChannelID:"channel",UpstreamModel:"provider-"+resolution,Adapter:SeedanceNativeAdapter})
	}
	aggregateVariants(&base.ModelDefinition)
	return base
}

func TestVariantsResolveOneRealRouteAndRejectOverlap(t *testing.T){
	cfg:=variantTestConfig();req:=validRequest();req.Model,req.Revision=cfg.ID,cfg.Revision
	if err:=ValidateRequest(cfg.ModelDefinition,req);err!=nil{t.Fatal(err)}
	resolved,err:=resolveConfig(cfg,req);if err!=nil||resolved.UpstreamModel!="provider-720p"||len(resolved.Variants)!=0||len(cfg.Variants)!=2{t.Fatalf("route resolution/snapshot: %+v %v",resolved,err)}
	req.Parameters.Resolution="1080p";req.VariantID="720p"
	if ValidateRequest(cfg.ModelDefinition,req)==nil{t.Fatal("explicit wrong variant accepted")}
	req.VariantID="1080p";req.Parameters.Ratio="16:9"
	if ValidateRequest(cfg.ModelDefinition,req)==nil{t.Fatal("unsupported cross product accepted")}
	cfg.Variants[1].Capabilities.Resolutions=[]string{"720p"};cfg.Variants[1].Pricing.Tiers[0].Resolution="720p"
	if ValidateDefinition(cfg.ModelDefinition)==nil{t.Fatal("overlapping conditions must not use priority/random selection")}
	cfg.Variants[0].ReferenceModes=[]string{"text","image"};cfg.Variants[1].ReferenceModes=[]string{"video"}
	if err:=ValidateDefinition(cfg.ModelDefinition);err!=nil{t.Fatal(err)}
	req.Parameters.Resolution,req.Parameters.Ratio,req.VariantID="720p","9:16","";req.Inputs=[]model.Input{{Kind:"video",Role:"reference_video",URL:"https://example.com/video.mp4"}}
	_,id,err:=ResolveDefinition(cfg.ModelDefinition,req);if err!=nil||id!="1080p"{t.Fatal("reference scene did not select configured route",id,err)}
	cfg.Variants[1].Capabilities.MaxVideos=1;req.Inputs=append(req.Inputs,req.Inputs[0])
	if ValidateRequest(cfg.ModelDefinition,req)==nil{t.Fatal("variant-specific attachment limit ignored")}
}

func TestVariantSubmissionFreezesAliasAndKeepsRequestId(t *testing.T){
	var count atomic.Int32;var upstream string
	server:=httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){count.Add(1);var body map[string]any;_ = json.NewDecoder(r.Body).Decode(&body);upstream,_=body["model"].(string);if _,exists:=body["billing_mode"];exists{t.Error("native protocol must not receive custom plugin billing_mode")};w.Header().Set("Content-Type","application/json");_,_=w.Write([]byte(`{"id":"provider-task"}`))}));defer server.Close()
	store,err:=repository.Open(filepath.Join(t.TempDir(),"gateway.db"));if err!=nil{t.Fatal(err)};defer store.Close()
	s,err:=New(store,strings.Repeat("a",32),strings.Repeat("b",32),base64.StdEncoding.EncodeToString(make([]byte,32)));if err!=nil{t.Fatal(err)}
	if err:=s.SaveChannel(model.ChannelInput{ID:"channel",Name:"test",BaseURL:server.URL,APIKey:"secret",Enabled:true});err!=nil{t.Fatal(err)}
	cfg:=variantTestConfig();cfg.Enabled,cfg.PricingConfirmed=true,true;if err:=s.SaveModel(cfg);err!=nil{t.Fatal(err)}
	req:=validRequest();req.Model,req.Revision,req.VariantID=cfg.ID,cfg.Revision,"720p"
	first,err:=s.Submit(context.Background(),req);if err!=nil||upstream!="provider-720p"{t.Fatal(first,err,upstream)}
	cfg.Routes[0].UpstreamModel="changed-alias";cfg.Revision="variants-2";if err:=s.SaveModel(cfg);err!=nil{t.Fatal(err)}
	second,err:=s.Submit(context.Background(),req);if err!=nil||second.ID!=first.ID||count.Load()!=1{t.Fatal("same request retriggered after config change",second,err)}
	saved,err:=store.Task(first.ID);if err!=nil{t.Fatal(err)};var snap model.ModelConfig;_ = json.Unmarshal([]byte(saved.ConfigJSON),&snap)
	if snap.UpstreamModel!="provider-720p"||snap.Revision!="variants-1"||saved.ChannelID!="channel"{t.Fatal("in-flight route changed")}
}

func TestSecondsAndCallUsageAreExplicitAndMissingUsageStaysPending(t *testing.T){
	for _,source:=range []string{"request_duration","response_duration","successful_task"}{t.Run(source,func(t *testing.T){
		cfg:=variantTestConfig();cfg.Pricing=model.Pricing{Unit:"second",QuantitySource:source};if source=="successful_task"{cfg.Pricing.Unit="call"}
		data,_:=json.Marshal(cfg);request,_:=json.Marshal(validRequest());task:=model.Task{Status:"running",ConfigJSON:string(data),RequestJSON:string(request)}
		response:=upstreamResponse{Status:"succeeded"};applyResult(&task,response)
		if source=="response_duration"{if task.BillingStatus!="pending_usage"||task.Units!=nil{t.Fatal("missing actual duration treated as zero/request duration")};response.Duration=json.RawMessage("8");applyResult(&task,response)}
		want:=int64(5);if source=="response_duration"{want=8};if source=="successful_task"{want=1}
		if task.BillingStatus!="usage_available"||task.Units==nil||*task.Units!=want{t.Fatal(task)}
		applyResult(&task,upstreamResponse{Status:"failed"});if task.Status!="completed"||*task.Units!=want{t.Fatal("later stale failure undid success")}
		failed:=model.Task{Status:"running",ConfigJSON:string(data),RequestJSON:string(request)};applyResult(&failed,upstreamResponse{Status:"failed"});if failed.BillingStatus!="not_billable"||failed.Units!=nil{t.Fatal("failed call/seconds was billed")}
	})}
}

func TestThirdPartyVideosCannotAdvertiseIgnoredResolutionOrRatio(t *testing.T){
	s:=&Service{};caps:=DefaultModel().Capabilities;disabled:=false;caps.Watermark=&disabled;caps.FirstFrame,caps.LastFrame=false,false
	pricing:=model.Pricing{Unit:"second",QuantitySource:"request_duration"}
	if err:=s.validateRoute("","provider-720p",NewTokenVideosAdapter,caps,pricing,false);err!=nil{t.Fatal(err)}
	caps.Resolutions=[]string{"720p","1080p"}
	if s.validateRoute("","provider-720p",NewTokenVideosAdapter,caps,pricing,false)==nil{t.Fatal("one fixed upstream ID advertised two resolutions")}
	caps.Resolutions=[]string{"720p"};caps.Ratios=[]string{"adaptive"}
	if s.validateRoute("","provider-720p",NewTokenVideosAdapter,caps,pricing,false)==nil{t.Fatal("undocumented adaptive ratio accepted")}
}

func TestModelSaveRejectsStaleRevisionAndDisableSnapshot(t *testing.T){
	store,err:=repository.Open(filepath.Join(t.TempDir(),"models.db"));if err!=nil{t.Fatal(err)};defer store.Close()
	base:=DefaultModel();if err:=store.SaveModelIfUnchanged(base,"");err!=nil{t.Fatal(err)}
	prior,err:=store.Model(base.ID);if err!=nil{t.Fatal(err)}
	newer:=base;newer.Revision="new-revision";newer.Name="新配置";if err:=store.SaveModelIfUnchanged(newer,prior.ConfigJSON);err!=nil{t.Fatal(err)}
	stale:=newer;stale.Name="同 revision 的另一份配置"
	if !errors.Is(store.SaveModelIfUnchanged(stale,prior.ConfigJSON),repository.ErrModelChanged){t.Fatal("concurrent editor replaced a published revision")}
	if !errors.Is(store.SaveModelIfUnchanged(base,prior.ConfigJSON),repository.ErrModelChanged){t.Fatal("stale disable restored old configuration")}
	if !errors.Is(store.SaveModelIfUnchanged(base,""),repository.ErrModelChanged){t.Fatal("new model conflict overwrote existing configuration")}
	current,err:=store.Model(base.ID);if err!=nil{t.Fatal(err)};var saved model.ModelConfig;if json.Unmarshal([]byte(current.ConfigJSON),&saved)!=nil||saved.Revision!=newer.Revision||saved.Name!=newer.Name{t.Fatal("current configuration changed after rejected save")}
}
