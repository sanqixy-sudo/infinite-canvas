package service

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/tigerowo/infinite-canvas/config"
	gm "github.com/tigerowo/infinite-canvas/gateway/model"
	gs "github.com/tigerowo/infinite-canvas/gateway/service"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

func TestGatewayTokenPrices(t *testing.T) {
	for _,tt:=range []struct{tokens int64;rate,want float64}{{500000,37,18.50},{300000,37,11.10},{600000,22,13.20},{333333,16.65,5.55},{1,5000,0.01},{0,37,0}} {
		got,err:=gatewayAmount(tt.tokens,tt.rate);if err!=nil||got!=tt.want{t.Fatalf("%d × %v / 1M = %v; want %v (%v)",tt.tokens,tt.rate,got,tt.want,err)}
	}
	if _,err:=gatewayAmount(9007199254740992,37);err==nil{t.Fatal("unsafe token count accepted")}
	def:=gs.DefaultModels()[0].ModelDefinition
	sale,err:=gatewaySale(def,model.GatewayPolicy{Mode:"multiplier",Multiplier:0.45,CreditsPerYuan:100})
	if err!=nil||len(sale.Tiers)!=1||sale.Tiers[0].WithoutVideoCreditsPerMillion!=2070||sale.Tiers[0].WithVideoCreditsPerMillion!=1260{t.Fatalf("portrait pricing: %+v %v",sale,err)}
	if _,err:=gatewaySale(def,model.GatewayPolicy{Mode:"fixed",Tiers:[]model.GatewayPriceTier{{Resolution:"1080p",WithoutVideoCreditsPerMillion:20,WithVideoCreditsPerMillion:15}}});err==nil{t.Fatal("missing 720p price silently accepted")}
}

func TestGatewaySplitPrices(t *testing.T) {
	billing := gatewayBilling{TokenMode:gm.TokenModeInputOutput,InputUnitPrice:10.35,OutputUnitPrice:20.70,ReserveInputTokens:250000,ReserveOutputTokens:250000}
	if got,err:=billing.reserveAmount();err!=nil||got!=7.76{t.Fatalf("split reservation: %v %v",got,err)}
	input,output:=int64(200000),int64(300000)
	if got,err:=billing.actualAmount(&gm.Usage{TotalTokens:500000,InputTokens:&input,OutputTokens:&output});err!=nil||got!=8.28{t.Fatalf("different input/output rates: %v %v",got,err)}
	if _,err:=billing.actualAmount(&gm.Usage{TotalTokens:500000,OutputTokens:&output});err==nil{t.Fatal("missing input must not be inferred from total")}
	zero:=int64(0)
	if got,err:=billing.actualAmount(&gm.Usage{InputTokens:&zero,OutputTokens:&zero});err!=nil||got!=0{t.Fatalf("explicit zero usage: %v %v",got,err)}
	if _,err:=billing.actualAmount(&gm.Usage{TotalTokens:500001,InputTokens:&input,OutputTokens:&output});err==nil{t.Fatal("inconsistent usage accepted")}
	if got,err:=gatewayPartsAmount(gatewayCharge{1,5000},gatewayCharge{1,5000});err!=nil||got!=0.01{t.Fatalf("round once after adding both parts: %v %v",got,err)}
	def:=gs.DefaultModels()[0].ModelDefinition
	def.Pricing.TokenMode=gm.TokenModeInputOutput
	def.Pricing.ReserveInputTokens,def.Pricing.ReserveOutputTokens=250000,250000
	for i:=range def.Pricing.Tiers{
		tier:=&def.Pricing.Tiers[i]
		tier.WithoutVideoInputCents,tier.WithoutVideoOutputCents=1000,2000
		tier.WithVideoInputCents,tier.WithVideoOutputCents=1500,2500
	}
	sale,err:=gatewaySale(def,model.GatewayPolicy{Mode:"multiplier",Multiplier:0.5,CreditsPerYuan:1})
	if err!=nil{t.Fatal(err)}
	without:=gatewayBillingFor(sale,sale.Tiers[0],false)
	with:=gatewayBillingFor(sale,sale.Tiers[0],true)
	if without.InputUnitPrice!=5||without.OutputUnitPrice!=10||with.InputUnitPrice!=7.5||with.OutputUnitPrice!=12.5{t.Fatalf("split/reference video tiers: %+v %+v",without,with)}
	fixed:=model.GatewayPolicy{Mode:"fixed"}
	for _,tier:=range def.Pricing.Tiers{fixed.Tiers=append(fixed.Tiers,model.GatewayPriceTier{Resolution:tier.Resolution,WithoutVideoInputCreditsPerMillion:1,WithoutVideoOutputCreditsPerMillion:2,WithVideoInputCreditsPerMillion:3,WithVideoOutputCreditsPerMillion:4})}
	sale,err=gatewaySale(def,fixed)
	if err!=nil||sale.Tiers[0].WithoutVideoInputCreditsPerMillion!=1||sale.Tiers[0].WithVideoOutputCreditsPerMillion!=4{t.Fatalf("fixed split prices: %+v %v",sale,err)}
}

func TestGatewayWalletLifecycle(t *testing.T) {
	const child="GATEWAY_WALLET_TEST_CHILD"
	if os.Getenv(child)!="1" {
		cmd:=exec.Command(os.Args[0],"-test.run=^TestGatewayWalletLifecycle$","-test.timeout=30s")
		cmd.Env=append(os.Environ(),child+"=1");if output,err:=cmd.CombinedOutput();err!=nil{t.Fatalf("isolated wallet: %v\n%s",err,output)};return
	}
	config.Cfg=config.Config{StorageDriver:"sqlite",DatabaseDSN:filepath.Join(t.TempDir(),"billing.db")}
	db,err:=repository.DB();if err!=nil{t.Fatal(err)}
	if err:=db.Create(&model.User{ID:"billing-user",Username:"billing-user",Credits:100,Status:model.UserStatusActive}).Error;err!=nil{t.Fatal(err)}
	balance:=func()float64{var user model.User;if err:=db.First(&user,"id = ?","billing-user").Error;err!=nil{t.Fatal(err)};return user.Credits}
	create:=func(id string)model.VideoTask{
		data,_:=json.Marshal(gatewayTaskSnapshot{gatewayBilling:gatewayBilling{TokenMode:gm.TokenModeTotal,UnitPrice:37,ReserveTokens:500000}})
		task:=model.VideoTask{ID:id,UserID:"billing-user",Status:"queued",BillingStatus:"reserved",ReservedCredits:18.5,GatewaySnapshot:string(data),GatewayRequestHash:id,CreatedAt:now(),UpdatedAt:now()}
		task,created,err:=repository.ReserveGatewayTask(task,model.CreditLog{ID:id+"-reserve",UserID:task.UserID,Amount:-18.5,CreatedAt:now()});if err!=nil||!created{t.Fatalf("reserve: %v %v",created,err)}
		if _,created,err=repository.ReserveGatewayTask(task,model.CreditLog{ID:id+"-duplicate"});err!=nil||created{t.Fatalf("duplicate reserve: %v %v",created,err)};return task
	}
	task:=create("one")
	if got:=balance();got!=81.5{t.Fatalf("duplicate reservation: %v",got)}
	if err:=applyGatewayPoll(task,VideoTaskPollUpdate{GatewayResult:&gm.TaskResult{ID:"up-one",Status:"completed",VideoURL:"https://example.com/video.mp4"}});err!=nil{t.Fatal(err)}
	if got:=balance();got!=81.5{t.Fatalf("missing usage must stay reserved: %v",got)}
	update:=VideoTaskPollUpdate{GatewayResult:&gm.TaskResult{ID:"up-one",Status:"completed",BillingStatus:"usage_available",Usage:&gm.Usage{TotalTokens:300000}}}
	if err:=applyGatewayPoll(task,update);err!=nil{t.Fatal(err)}
	if err:=applyGatewayPoll(task,update);err!=nil{t.Fatal(err)}
	if got:=balance();got!=88.9{t.Fatalf("settlement/refund is not idempotent: %v",got)}
	task=create("two")
	if err:=applyGatewayPoll(task,VideoTaskPollUpdate{GatewayResult:&gm.TaskResult{ID:"up-two",Status:"completed",BillingStatus:"usage_available",Usage:&gm.Usage{TotalTokens:600000}}});err!=nil{t.Fatal(err)}
	if got:=balance();got!=66.7{t.Fatalf("additional debit: %v",got)}
	task=create("three")
	failed:=VideoTaskPollUpdate{GatewayResult:&gm.TaskResult{ID:"up-three",Status:"failed",BillingStatus:"not_billable"}}
	if err:=applyGatewayPoll(task,failed);err!=nil{t.Fatal(err)};if err:=applyGatewayPoll(task,failed);err!=nil{t.Fatal(err)}
	if got:=balance();got!=66.7{t.Fatalf("failure refund repeated: %v",got)}
	task=create("four")
	if err:=db.Model(&model.User{}).Where("id = ?","billing-user").Update("credits",0).Error;err!=nil{t.Fatal(err)}
	large:=VideoTaskPollUpdate{GatewayResult:&gm.TaskResult{ID:"up-four",Status:"completed",BillingStatus:"usage_available",Usage:&gm.Usage{TotalTokens:1000000}}}
	if err:=applyGatewayPoll(task,large);err!=nil{t.Fatal(err)}
	saved,found,err:=repository.GetUserVideoTask(task.UserID,task.ID);if err!=nil||!found||saved.BillingStatus!="pending_balance"||balance()!=0{t.Fatalf("insufficient funds: %+v %v",saved,err)}
	if err:=db.Model(&model.User{}).Where("id = ?",task.UserID).Update("credits",20).Error;err!=nil{t.Fatal(err)}
	if err:=applyGatewayPoll(saved,large);err!=nil{t.Fatal(err)};if err:=applyGatewayPoll(saved,large);err!=nil{t.Fatal(err)}
	if got:=balance();got!=1.5{t.Fatalf("top-up settlement: %v",got)}

	if err:=db.Model(&model.User{}).Where("id = ?",task.UserID).Update("credits",100).Error;err!=nil{t.Fatal(err)}
	snapshot,_:=json.Marshal(gatewayTaskSnapshot{gatewayBilling:gatewayBilling{TokenMode:gm.TokenModeInputOutput,InputUnitPrice:10.35,OutputUnitPrice:20.70,ReserveInputTokens:250000,ReserveOutputTokens:250000}})
	task=model.VideoTask{ID:"split",UserID:"billing-user",Status:"queued",BillingStatus:"reserved",ReservedCredits:7.76,GatewaySnapshot:string(snapshot),GatewayRequestHash:"split",CreatedAt:now(),UpdatedAt:now()}
	task,_,err=repository.ReserveGatewayTask(task,model.CreditLog{ID:"split-reserve",UserID:task.UserID,Amount:-7.76,CreatedAt:now()});if err!=nil{t.Fatal(err)}
	partial:=VideoTaskPollUpdate{GatewayResult:&gm.TaskResult{ID:"up-split",Status:"completed",BillingStatus:"pending_usage",VideoURL:"https://example.com/split.mp4",Usage:&gm.Usage{TotalTokens:500000}}}
	if err:=applyGatewayPoll(task,partial);err!=nil{t.Fatal(err)}
	saved,found,err=repository.GetUserVideoTask(task.UserID,task.ID)
	if err!=nil||!found||saved.BillingStatus!="pending_usage"||saved.VideoURL==""||balance()!=92.24{t.Fatalf("partial usage should keep video and reservation: %+v %v",saved,err)}
	input,output:=int64(200000),int64(300000)
	splitResult:=VideoTaskPollUpdate{GatewayResult:&gm.TaskResult{ID:"up-split",Status:"completed",BillingStatus:"usage_available",Usage:&gm.Usage{TotalTokens:500000,InputTokens:&input,OutputTokens:&output}}}
	conflicted:=splitResult;copyResult:=*splitResult.GatewayResult;copyResult.BillingStatus="pending_usage";conflicted.GatewayResult=&copyResult
	if err:=applyGatewayPoll(saved,conflicted);err!=nil{t.Fatal(err)}
	if got:=balance();got!=92.24{t.Fatalf("pending/conflicting upstream usage must not settle: %v",got)}
	if err:=db.Model(&model.User{}).Where("id = ?",task.UserID).Update("credits",0).Error;err!=nil{t.Fatal(err)}
	if err:=applyGatewayPoll(saved,splitResult);err!=nil{t.Fatal(err)}
	saved,found,err=repository.GetUserVideoTask(task.UserID,task.ID)
	if err!=nil||!found||saved.BillingStatus!="pending_balance"||saved.ActualInputTokens==nil||*saved.ActualInputTokens!=input||saved.ActualOutputTokens==nil||*saved.ActualOutputTokens!=output{t.Fatalf("persist split usage while awaiting top-up: %+v %v",saved,err)}
	if err:=db.Model(&model.User{}).Where("id = ?",task.UserID).Update("credits",1).Error;err!=nil{t.Fatal(err)}
	recovered,err:=PollGatewayVideoTask(t.Context(),saved);if err!=nil{t.Fatal(err)}
	if err:=applyGatewayPoll(saved,recovered);err!=nil{t.Fatal(err)}
	if err:=applyGatewayPoll(saved,recovered);err!=nil{t.Fatal(err)}
	if got:=balance();got!=0.48{t.Fatalf("split recovery must debit 0.52 exactly once: %v",got)}
}
