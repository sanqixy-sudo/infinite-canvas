package service

import (
    "context"
    "encoding/json"
    "io"
    "math"
    "mime/multipart"
    "os"
    "strings"
    "github.com/tigerowo/infinite-canvas/model"
    gm "github.com/tigerowo/infinite-canvas/gateway/model"
    "github.com/tigerowo/infinite-canvas/repository"
)

type TeamGenerationInput struct { RequestID string `json:"requestId"`;ShotID string `json:"shotId"`;Model string `json:"model"`;Prompt string `json:"prompt"`;Parameters gm.Parameters `json:"parameters"`;AssetIDs []string `json:"assetIds"` }
type TeamGenerationAction struct { Action string `json:"action"`;QuoteID string `json:"quoteId"`;Reason string `json:"reason"` }

func teamGenerationOwner(userID string)repository.TeamProjectValidator{return func(project model.TeamProject,team model.Team,members []model.TeamMember)error{_,err:=TeamProjectAccessFor(userID,project,team,members);if err!=nil{return err};if project.OwnerUserID!=userID{return ErrStorageAccessDenied};return nil}}
func teamGenerationDTO(row model.TeamGenerationApproval,costs bool) map[string]any {
    data,_:=json.Marshal(row);var value map[string]any;_ = json.Unmarshal(data,&value);value["parameters"]=json.RawMessage(row.Parameters)
    if costs {value["reservedCredits"]=row.ReservedCredits;value["actualCredits"]=row.ActualCredits};return value
}
func CurrentTeamGeneration(ctx context.Context,projectID string,q model.Query)(map[string]any,error){
    access,err:=CurrentTeamProjectAccess(ctx,projectID);if err!=nil{return nil,err};user,_:=UserFromContext(ctx);q=teamQuery(q)
    budget,rows,total,err:=repository.TeamGenerationList(projectID,q,func(project model.TeamProject,team model.Team,members []model.TeamMember)error{var check error;access,check=TeamProjectAccessFor(user.ID,project,team,members);return check});if err!=nil{return nil,teamLookupError(err)};items:=[]map[string]any{};for _,row:=range rows{items=append(items,teamGenerationDTO(row,access.CanViewCosts))}
    result:=map[string]any{"canApprove":access.Project.OwnerUserID==user.ID,"canViewCosts":access.CanViewCosts,"requests":items,"total":total,"page":q.Page,"pageSize":q.PageSize};if access.CanViewCosts{result["budget"]=budget};return result,nil
}
func SetCurrentTeamGenerationBudget(ctx context.Context,projectID string,limit float64)error{
    user,err:=accountDataUser(ctx);if err!=nil{return err};if math.IsNaN(limit)||math.IsInf(limit,0)||limit<0||limit>100000000||math.Abs(limit*100-math.Round(limit*100))>0.00001{return productionError("预算须为 0 到 1 亿的算力数，最多两位小数")}
    return repository.SetTeamGenerationBudget(projectID,limit,teamGenerationOwner(user.ID),newTeamAudit("",user.ID,"budget.update",projectID,"更新生成审批预算"))
}
func CreateCurrentTeamGeneration(ctx context.Context,projectID string,input TeamGenerationInput)(map[string]any,error){
    user,err:=accountDataUser(ctx);if err!=nil{return nil,err};access,err:=CurrentTeamProjectAccess(ctx,projectID);if err!=nil{return nil,err}
    if err:=productionID(&input.RequestID,"申请",true);err!=nil{return nil,err};if err:=productionID(&input.ShotID,"镜头",true);err!=nil{return nil,err};if err:=productionText(&input.Prompt,"提示词",10000,true);err!=nil{return nil,err};if len(input.AssetIDs)>50{return nil,productionError("参考素材数量过多")}
    plan,err:=repository.GetUserProductionDocument(access.Project.OwnerUserID,access.Project.WorkspaceID);if err!=nil{return nil,err};if plan==nil{return nil,productionError("制作计划不存在")}
    var shot *model.ProductionShot;for i:=range plan.Shots{if plan.Shots[i].ID==input.ShotID{shot=&plan.Shots[i];break}};if shot==nil||shot.CanvasID==""||shot.VideoNodeID==""{return nil,productionError("请先由项目拥有者在制作计划中为镜头建立并保存画布节点")}
    params,_:=json.Marshal(input.Parameters);row:=model.TeamGenerationApproval{ID:"approval_"+gatewayHash([]string{user.ID,projectID,input.RequestID}),ProjectID:projectID,TeamID:access.Project.TeamID,RequesterID:user.ID,PayerID:access.Project.OwnerUserID,ShotID:shot.ID,ShotTitle:shot.Title,CanvasID:shot.CanvasID,NodeID:shot.VideoNodeID,Model:input.Model,Prompt:input.Prompt,Parameters:string(params),AssetIDs:input.AssetIDs,RequestHash:gatewayHash(input),State:"pending",CreatedAt:now(),UpdatedAt:now()}
    // Validate capability counts without downloading media or spending credits.
    req,err:=teamGenerationRequest(ctx,row,false);if err!=nil{return nil,err};row.Revision=req.Revision;settings,err:=repository.GetSettings();if err!=nil{return nil,err};if _,_,err=gatewayDefinition(settings.Private.Gateway,req);err!=nil{return nil,err}
    err=repository.CreateTeamGenerationApproval(&row,plan.Revision,teamProjectValidator(user.ID,false,false),newTeamAudit(row.TeamID,user.ID,"generation.request",row.ID,"申请镜头生成："+row.ShotTitle));if err!=nil{return nil,teamLookupError(err)};return teamGenerationDTO(row,access.CanViewCosts),nil
}

func teamGenerationRequest(ctx context.Context,row model.TeamGenerationApproval,prepare bool)(gm.Request,error){
    user,_:=UserFromContext(ctx);req:=gm.Request{RequestID:row.ID,Model:row.Model,Prompt:row.Prompt,Inputs:[]gm.Input{}};if json.Unmarshal([]byte(row.Parameters),&req.Parameters)!=nil{return req,productionError("请求参数无效")};settings,err:=repository.GetSettings();if err!=nil{return req,err};for _,def:=range settings.Private.Gateway.Catalog{if def.ID==row.Model{req.Revision=def.Revision}}
    if row.Revision!="" && row.Revision!=req.Revision{return req,productionError("模型能力版本已变化，请撤回申请并按最新规格重新申请")}
    seen:=map[string]bool{};for _,id:=range row.AssetIDs{
        if seen[id]{return req,productionError("同一个参考素材不能重复添加")};seen[id]=true
        asset,err:=repository.ReadTeamAsset(id,teamAssetValidator(user.ID,false));if err!=nil{return req,teamLookupError(err)};if asset.TeamID!=row.TeamID{return req,ErrStorageAccessDenied}
        url:="https://example.invalid/validated-team-reference";if prepare{
            media,err:=CurrentTeamAssetMedia(ctx,id,"");if err!=nil{return req,err}
            if media.Object.Bytes<=0||media.Object.Bytes>GatewayMediaLimit{media.Stream.Close();return req,productionError("参考素材大小超出模型临时上传限制")}
            file,err:=os.CreateTemp("","team-generation-*");if err!=nil{media.Stream.Close();return req,err}
            result,copyErr:=func()(map[string]any,error){defer os.Remove(file.Name());defer file.Close();defer media.Stream.Close();size,err:=io.Copy(file,io.LimitReader(media.Stream,GatewayMediaLimit+1));if err!=nil{return nil,err};if size!=media.Object.Bytes{return nil,productionError("素材下载不完整")};if _,err:=file.Seek(0,io.SeekStart);err!=nil{return nil,err};return UploadGatewayMedia(ctx,file,&multipart.FileHeader{Filename:asset.Title,Size:size})}();if copyErr!=nil{return req,copyErr};url,_=result["url"].(string)
        };req.Inputs=append(req.Inputs,gm.Input{Kind:asset.Kind,Role:"reference_"+asset.Kind,URL:url})
    };return req,nil
}

func ActCurrentTeamGeneration(ctx context.Context,projectID,id string,input TeamGenerationAction)(map[string]any,error){
    user,err:=accountDataUser(ctx);if err!=nil{return nil,err};access,err:=CurrentTeamProjectAccess(ctx,projectID);if err!=nil{return nil,err}
    row,err:=repository.UpdateTeamGenerationApproval(projectID,id,teamProjectValidator(user.ID,false,false),func(row *model.TeamGenerationApproval)error{return nil},nil);if err!=nil{return nil,teamLookupError(err)}
    owner:=access.Project.OwnerUserID==user.ID
    if input.Action=="withdraw"||input.Action=="reject"{if input.Action=="withdraw"&&row.RequesterID!=user.ID||input.Action=="reject"&&!owner{return nil,ErrStorageAccessDenied};if err:=productionText(&input.Reason,"处理说明",1000,false);err!=nil{return nil,err};row,err=repository.UpdateTeamGenerationApproval(projectID,id,teamProjectValidator(user.ID,false,false),func(current *model.TeamGenerationApproval)error{if current.State!="pending"{return productionError("该申请已受理，无法撤回或拒绝")};current.State,current.Reason,current.UpdatedAt=input.Action,input.Reason,now();return nil},newTeamAudit("",user.ID,"generation."+input.Action,id,"处理镜头生成申请"));return teamGenerationDTO(row,access.CanViewCosts),err}
    if !owner{return nil,ErrStorageAccessDenied};if input.Action!="quote"&&input.Action!="submit"{return nil,productionError("审批操作无效")}
    if row.TaskID!=""{task,found,err:=repository.GetUserVideoTask(user.ID,row.TaskID);if err!=nil{return nil,err};if !found{return nil,productionError("任务记录暂不可用，请稍后重试")};return map[string]any{"accepted":true,"task":VideoTaskResponse(task)},nil}
    if row.State!="pending"{return nil,productionError("申请已撤回或拒绝")}
    if input.Action=="quote"{
        req,err:=teamGenerationRequest(ctx,row,true);if err!=nil{return nil,err};quote,err:=QuoteGatewayTask(ctx,req);if err!=nil{return nil,err};body,_:=json.Marshal(req)
        _,err=repository.UpdateTeamGenerationApproval(projectID,id,teamGenerationOwner(user.ID),func(current *model.TeamGenerationApproval)error{if current.State!="pending"{return productionError("审批状态已变化")};current.PreparedRequest=string(body);current.UpdatedAt=now();return nil},nil);if err!=nil{return nil,err};return quote,nil
    }
    var req gm.Request;if row.PreparedRequest==""||json.Unmarshal([]byte(row.PreparedRequest),&req)!=nil{return nil,productionError("请先获取报价并确认预扣")}
    task,err:=SubmitGatewayTask(ctx,GatewaySubmit{Request:req,QuoteID:strings.TrimSpace(input.QuoteID),Source:"canvas",CanvasID:row.CanvasID,SourceID:row.NodeID,teamApprovalID:row.ID});if err!=nil{return nil,err};return map[string]any{"accepted":true,"task":task},nil
}
