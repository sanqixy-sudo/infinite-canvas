package service

import (
    "testing"
    "github.com/tigerowo/infinite-canvas/model"
)

func TestProductionNodeChangeGuard(t *testing.T){
    before:=`{"nodes":[{"id":"text","type":"text"},{"id":"image","type":"image"},{"id":"other","type":"video"}]}`
    doc:=model.ProductionDocument{Shots:[]model.ProductionShot{{Title:"镜头",CanvasID:"canvas",TextNodeID:"text",Candidates:[]model.ProductionCandidate{{CanvasID:"canvas",NodeID:"image",Title:"候选"}}}}}
    docs:=[]model.ProductionDocument{doc}
    if err:=validateProductionNodeChanges("canvas",before,`{"nodes":[{"id":"text","type":"text"},{"id":"image","type":"image"}]}`,docs);err!=nil{t.Fatal(err)}
    if err:=validateProductionNodeChanges("canvas",before,`{"nodes":[{"id":"text","type":"video"},{"id":"image","type":"image"}]}`,docs);err==nil{t.Fatal("referenced node changed type")}
    if err:=validateProductionNodeChanges("canvas",before,`{"nodes":[{"id":"text","type":"text"}]}`,docs);err==nil{t.Fatal("referenced candidate deleted")}
    if err:=validateProductionNodeChanges("unrelated",before,`{"nodes":[]}`,docs);err!=nil{t.Fatal(err)}
}
