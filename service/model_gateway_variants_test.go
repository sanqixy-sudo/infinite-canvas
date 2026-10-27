package service

import (
	"testing"
	gm "github.com/tigerowo/infinite-canvas/gateway/model"
	gs "github.com/tigerowo/infinite-canvas/gateway/service"
	"github.com/tigerowo/infinite-canvas/model"
)

func TestGatewayVariantRatesAndBillingUnits(t *testing.T){
	def:=gs.DefaultModel().ModelDefinition;def.ID="variant-test"
	for _,unit:=range []string{"token","second","call"}{
		caps:=def.Capabilities;caps.Resolutions=[]string{unit+"p"}
		pricing:=def.Pricing;pricing.Tiers=[]gm.PriceTier{{Resolution:unit+"p",WithoutVideoCents:30,WithVideoCents:50}}
		if unit!="token"{pricing=gm.Pricing{Unit:unit,Currency:"CNY",Per:1,QuantitySource:"request_duration",Tiers:pricing.Tiers};if unit=="call"{pricing.QuantitySource="successful_task"}}
		def.Variants=append(def.Variants,gm.VariantDefinition{ID:unit,Name:unit,Capabilities:caps,Pricing:pricing})
	}
	policy:=model.GatewayPolicy{Model:def.ID,Enabled:true,Mode:"multiplier",Multiplier:0.5,CreditsPerYuan:10}
	sale,err:=gatewaySale(def,policy);if err!=nil||len(sale.Variants)!=3{t.Fatal(sale,err)}
	cfg:=model.GatewaySettings{Enabled:true,APIKey:"test",BaseURL:"http://gateway",Catalog:[]gm.ModelDefinition{def},Models:[]model.GatewayPolicy{policy}}
	for _,unit:=range []string{"token","second","call"}{
		req:=gm.Request{RequestID:"quote-test",Model:def.ID,Revision:def.Revision,VariantID:unit,Prompt:"test",Parameters:gm.Parameters{Resolution:unit+"p",Ratio:"9:16",Duration:5}}
		b,err:=gatewayRequestBilling(cfg,req);if err!=nil{t.Fatal(err)}
		want:=0.75;if unit=="second"{want=7.5};if unit=="call"{want=1.5}
		if got,err:=b.reserveAmount();err!=nil||got!=want||b.VariantID!=unit{t.Fatalf("%s reserve=%v want=%v err=%v",unit,got,want,err)}
		if unit!="token"{units:=int64(8);if unit=="call"{units=1};got,err:=b.actualAmount(&gm.Usage{Units:&units});if err!=nil||got!=float64(units)*1.5{t.Fatal(got,err)};if _,err:=b.actualAmount(&gm.Usage{TotalTokens:500000});err==nil{t.Fatal("tokens used as seconds/call units")}}
		prior:=gatewayHash(b);cfg.Models[0].Multiplier=0.6;changed,err:=gatewayRequestBilling(cfg,req);if err!=nil||gatewayHash(changed)==prior{t.Fatal("price change does not invalidate signed terms")};cfg.Models[0].Multiplier=0.5
	}
	policy.Mode="fixed";policy.Tiers=[]model.GatewayPriceTier{{VariantID:"token",Resolution:"tokenp",WithoutVideoCreditsPerMillion:2,WithVideoCreditsPerMillion:3},{VariantID:"second",Resolution:"secondp",WithoutVideoCredits:4,WithVideoCredits:5},{VariantID:"call",Resolution:"callp",WithoutVideoCredits:6,WithVideoCredits:7}}
	fixed,err:=gatewaySale(def,policy);if err!=nil||fixed.Variants[1].Sale.Tiers[0].WithoutVideoCredits!=4||fixed.Variants[2].Sale.Tiers[0].WithVideoCredits!=7{t.Fatal(fixed,err)}
	policy.Tiers[1].VariantID="wrong";if _,err:=gatewaySale(def,policy);err==nil{t.Fatal("fixed price from another variant accepted")}
}
