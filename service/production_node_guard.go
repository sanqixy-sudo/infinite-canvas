package service

import (
    "encoding/json"
    "fmt"
    "github.com/tigerowo/infinite-canvas/model"
)

func validateProductionNodeChanges(canvasID, previous, next string, docs []model.ProductionDocument) error {
    type node struct { ID string `json:"id"`; Type string `json:"type"` }
    type canvas struct { Nodes []node `json:"nodes"` }
    var before, after canvas
    if json.Unmarshal([]byte(previous), &before) != nil || json.Unmarshal([]byte(next), &after) != nil { return safeMessageError{message:"画布节点数据无效"} }
    previousTypes, nextTypes := map[string]string{}, map[string]string{}
    for _, n := range before.Nodes { previousTypes[n.ID] = n.Type }
    for _, n := range after.Nodes { nextTypes[n.ID] = n.Type }
    check := func(id, title string) error {
        if kind, exists := previousTypes[id]; id != "" && exists && nextTypes[id] != kind {
            return safeMessageError{message:fmt.Sprintf("节点仍被%s引用，请先在短剧制作中解除关联并保存，再删除或改变节点类型",title)}
        }
        return nil
    }
    for _, doc := range docs {
        for _, shot := range doc.Shots {
            if shot.CanvasID == canvasID { for _, id := range []string{shot.TextNodeID,shot.ImageNodeID,shot.VideoNodeID} { if err:=check(id,"镜头「"+shot.Title+"」");err!=nil{return err} } }
            for _, candidate := range shot.Candidates { if candidate.CanvasID==canvasID { if err:=check(candidate.NodeID,"镜头候选「"+candidate.Title+"」");err!=nil{return err} } }
        }
        for _, asset := range doc.Assets { for _, ref := range asset.References { if ref.CanvasID==canvasID {if err:=check(ref.NodeID,"资产「"+asset.Title+"」");err!=nil{return err}} } }
    }
    return nil
}
