package service

import (
	"context"
	"errors"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

type TeamProjectAccess struct {
	Project model.TeamProject `json:"project"`
	Team model.Team `json:"team"`
	MyRole string `json:"myRole"`
	CanEdit bool `json:"canEdit"`
	CanViewCosts bool `json:"canViewCosts"`
}
type TeamPlanEpisode struct { ID string `json:"id"`; Title string `json:"title"`; Script string `json:"script"`; Order int `json:"order"` }
type TeamPlanAsset struct { ID string `json:"id"`; Kind string `json:"kind"`; Title string `json:"title"`; Description string `json:"description"`; VariantOf string `json:"variantOf"` }
type TeamPlanShot struct {
	ID string `json:"id"`; EpisodeID string `json:"episodeId"`; SceneID string `json:"sceneId"`; Order int `json:"order"`
	Title string `json:"title"`; Description string `json:"description"`; Dialogue string `json:"dialogue"`; Camera string `json:"camera"`
	Seconds int `json:"seconds"`; AssetIDs []string `json:"assetIds"`; Status string `json:"status"`
}
type TeamPlan struct {
	Revision int64 `json:"revision"`; Title string `json:"title"`; Synopsis string `json:"synopsis"`; StyleGuide string `json:"styleGuide"`
	Episodes []TeamPlanEpisode `json:"episodes"`; Scenes []model.ProductionScene `json:"scenes"`; Assets []TeamPlanAsset `json:"assets"`; Shots []TeamPlanShot `json:"shots"`
}
type TeamProjectDetail struct { TeamProjectAccess; Plan TeamPlan `json:"plan"` }

func newTeamAudit(teamID,userID,action,target,summary string) *model.TeamAudit { return &model.TeamAudit{ID:newID("audit"),TeamID:teamID,ActorID:userID,Action:action,TargetID:target,Summary:summary,CreatedAt:now()} }
func teamCostAccess(members []model.TeamMember,userID string) bool { for _, member:=range members { if member.UserID==userID { return member.Role=="owner"||member.Role=="admin"||member.CanViewCosts } };return false }
func TeamProjectAccessFor(userID string,project model.TeamProject,team model.Team,members []model.TeamMember)(TeamProjectAccess,error){
	if project.TeamID!=team.ID||project.RevokedAt!=""||team.DeletedAt!=""||teamRole(members,userID)==""||teamRole(members,project.OwnerUserID)=="" { return TeamProjectAccess{},ErrStorageAccessDenied }
	return TeamProjectAccess{project,team,teamRole(members,userID),project.EditAllowed||project.OwnerUserID==userID,teamCostAccess(members,userID)||project.OwnerUserID==userID},nil
}
func CurrentTeamProjectAccess(ctx context.Context,id string)(TeamProjectAccess,error){
	user,err:=accountDataUser(ctx);if err!=nil{return TeamProjectAccess{},err};var access TeamProjectAccess
	_,err=repository.ReadTeamProject(id,func(project model.TeamProject,team model.Team,members []model.TeamMember)error{var check error;access,check=TeamProjectAccessFor(user.ID,project,team,members);return check});return access,teamLookupError(err)
}
func teamProjectValidator(userID string,edit,manage bool)repository.TeamProjectValidator{return func(project model.TeamProject,team model.Team,members []model.TeamMember)error{
	access,err:=TeamProjectAccessFor(userID,project,team,members);if err!=nil{return err};if edit&&!access.CanEdit{return ErrStorageAccessDenied};if manage&&project.OwnerUserID!=userID&&access.MyRole!="owner"&&access.MyRole!="admin"{return ErrStorageAccessDenied};return nil
}}
func teamCollaborationError(err error)error{if errors.Is(err,repository.ErrProductionConflict){return productionError("计划版本已更新或内容已共享。请保留草稿，重新加载最新版本后再操作")};return teamLookupError(err)}

func CurrentTeamProjects(ctx context.Context,teamID string,q model.Query)(TeamListResult[model.TeamProject],error){user,err:=accountDataUser(ctx);if err!=nil{return TeamListResult[model.TeamProject]{},err};rows,total,err:=repository.TeamProjects(teamID,teamQuery(q),teamMember(user.ID));return TeamListResult[model.TeamProject]{rows,total},teamLookupError(err)}
func ShareCurrentTeamProject(ctx context.Context,teamID,workspaceID string,revision int64,editAllowed bool)(model.TeamProject,error){
	user,err:=accountDataUser(ctx);if err!=nil{return model.TeamProject{},err};if err:=productionID(&workspaceID,"项目",true);err!=nil{return model.TeamProject{},err};if revision<1{return model.TeamProject{},productionError("请先保存并加载制作计划")}
	project:=model.TeamProject{ID:newID("teamproject"),TeamID:teamID,OwnerUserID:user.ID,WorkspaceID:workspaceID,EditAllowed:editAllowed,CreatedAt:now()}
	err=repository.ShareTeamProject(&project,revision,teamMember(user.ID),newTeamAudit(teamID,user.ID,"project.share",project.ID,"共享制作计划"));return project,teamCollaborationError(err)
}
func ChangeCurrentTeamProject(ctx context.Context,id string,editAllowed,remove bool)error{
	user,err:=accountDataUser(ctx);if err!=nil{return err};stamp:="";action,summary:="project.permissions","更新制作计划编辑权限";if remove{stamp=now();action,summary="project.revoke","撤销制作计划共享"}
	return teamLookupError(repository.ChangeSharedTeamProject(id,editAllowed,stamp,teamProjectValidator(user.ID,false,true),newTeamAudit("",user.ID,action,id,summary)))
}

func publicTeamPlan(doc *model.ProductionDocument)TeamPlan{
	plan:=TeamPlan{Revision:doc.Revision,Title:doc.Title,Synopsis:doc.Synopsis,StyleGuide:doc.StyleGuide,Episodes:[]TeamPlanEpisode{},Scenes:doc.Scenes,Assets:[]TeamPlanAsset{},Shots:[]TeamPlanShot{}}
	for _,ep:=range doc.Episodes{plan.Episodes=append(plan.Episodes,TeamPlanEpisode{ep.ID,ep.Title,ep.Script,ep.Order})}
	for _,asset:=range doc.Assets{plan.Assets=append(plan.Assets,TeamPlanAsset{asset.ID,asset.Kind,asset.Title,asset.Description,asset.VariantOf})}
	for _,shot:=range doc.Shots{plan.Shots=append(plan.Shots,TeamPlanShot{shot.ID,shot.EpisodeID,shot.SceneID,shot.Order,shot.Title,shot.Description,shot.Dialogue,shot.Camera,shot.Seconds,shot.AssetIDs,shot.Status})};return plan
}
func CurrentTeamProject(ctx context.Context,id string)(TeamProjectDetail,error){
	user,err:=accountDataUser(ctx);if err!=nil{return TeamProjectDetail{},err};var access TeamProjectAccess
	doc,err:=repository.TeamProjectDocument(id,func(project model.TeamProject,team model.Team,members []model.TeamMember)error{var check error;access,check=TeamProjectAccessFor(user.ID,project,team,members);return check});if err!=nil{return TeamProjectDetail{},teamLookupError(err)};sortProduction(doc);return TeamProjectDetail{access,publicTeamPlan(doc)},nil
}

// Only collaborative text fields are accepted. Existing private media/bindings and delivery edits stay server-side.
func mergeTeamPlan(doc *model.ProductionDocument,plan TeamPlan)error{
	episodes:=map[string]model.ProductionEpisode{};for _,v:=range doc.Episodes{episodes[v.ID]=v};assets:=map[string]model.ProductionAsset{};for _,v:=range doc.Assets{assets[v.ID]=v};shots:=map[string]model.ProductionShot{};for _,v:=range doc.Shots{shots[v.ID]=v}
	oldIDs:=map[string]bool{};for _,v:=range doc.Episodes{oldIDs["episode:"+v.ID]=false};for _,v:=range doc.Scenes{oldIDs["scene:"+v.ID]=false};for _,v:=range doc.Assets{oldIDs["asset:"+v.ID]=false};for _,v:=range doc.Shots{oldIDs["shot:"+v.ID]=false}
	doc.Title,doc.Synopsis,doc.StyleGuide=plan.Title,plan.Synopsis,plan.StyleGuide;doc.Episodes=[]model.ProductionEpisode{};doc.Scenes=plan.Scenes;doc.Assets=[]model.ProductionAsset{};doc.Shots=[]model.ProductionShot{}
	for _,v:=range plan.Episodes{item:=episodes[v.ID];item.ID,item.Title,item.Script,item.Order=v.ID,v.Title,v.Script,v.Order;doc.Episodes=append(doc.Episodes,item);oldIDs["episode:"+v.ID]=true}
	for _,v:=range plan.Scenes{oldIDs["scene:"+v.ID]=true}
	for _,v:=range plan.Assets{item:=assets[v.ID];item.ID,item.Kind,item.Title,item.Description,item.VariantOf=v.ID,v.Kind,v.Title,v.Description,v.VariantOf;doc.Assets=append(doc.Assets,item);oldIDs["asset:"+v.ID]=true}
	for _,v:=range plan.Shots{item:=shots[v.ID];if item.ID!=""&&item.EpisodeID!=v.EpisodeID{return productionError("已有镜头不能跨集移动，请由项目拥有者在个人制作计划中处理")};item.ID,item.EpisodeID,item.SceneID,item.Order=v.ID,v.EpisodeID,v.SceneID,v.Order;item.Title,item.Description,item.Dialogue,item.Camera=v.Title,v.Description,v.Dialogue,v.Camera;item.Seconds,item.AssetIDs,item.Status=v.Seconds,v.AssetIDs,v.Status;doc.Shots=append(doc.Shots,item);oldIDs["shot:"+v.ID]=true}
	for _,present:=range oldIDs{if !present{return productionError("共享编辑支持新增和修改；删除已有内容请由项目拥有者在个人制作计划中处理")}}
	doc.UpdatedAt=now();if err:=normalizeProduction(doc);err!=nil{return err};return validateProductionDelivery(*doc)
}
func SaveCurrentTeamProject(ctx context.Context,id string,plan TeamPlan)(TeamPlan,error){
	user,err:=accountDataUser(ctx);if err!=nil{return TeamPlan{},err};doc,err:=repository.SaveTeamProjectDocument(id,plan.Revision,teamProjectValidator(user.ID,true,false),func(doc *model.ProductionDocument)error{return mergeTeamPlan(doc,plan)},newTeamAudit("",user.ID,"project.edit",id,"保存共享制作计划"));if err!=nil{return TeamPlan{},teamCollaborationError(err)};sortProduction(doc);return publicTeamPlan(doc),nil
}

func CurrentTeamAssets(ctx context.Context,teamID string,q model.Query)(TeamListResult[model.TeamAsset],error){user,err:=accountDataUser(ctx);if err!=nil{return TeamListResult[model.TeamAsset]{},err};rows,total,err:=repository.TeamAssets(teamID,teamQuery(q),teamMember(user.ID));return TeamListResult[model.TeamAsset]{rows,total},teamLookupError(err)}
func ShareCurrentTeamAsset(ctx context.Context,teamID,objectID,title string)(model.TeamAsset,error){
	user,err:=accountDataUser(ctx);if err!=nil{return model.TeamAsset{},err};if err:=productionID(&objectID,"文件",true);err!=nil{return model.TeamAsset{},err};if err:=productionText(&title,"素材名称",180,true);err!=nil{return model.TeamAsset{},err}
	asset:=model.TeamAsset{ID:newID("teamasset"),TeamID:teamID,OwnerUserID:user.ID,ObjectID:objectID,Title:title,CreatedAt:now()}
	err=repository.ShareTeamAsset(&asset,teamMember(user.ID),func(object model.StorageObject)error{if object.Bytes<=0{return productionError("文件未上传完成")};for _,kind:=range []string{"image","video","audio"}{if strings.HasPrefix(object.MimeType,kind+"/"){asset.Kind=kind;return nil}};return productionError("团队素材支持图片、视频和音频")},newTeamAudit(teamID,user.ID,"asset.share",asset.ID,"共享素材："+title));return asset,teamCollaborationError(err)
}
func teamAssetValidator(userID string,manage bool)func(model.TeamAsset,model.Team,[]model.TeamMember)error{return func(asset model.TeamAsset,team model.Team,members []model.TeamMember)error{
	role:=teamRole(members,userID);if role==""||teamRole(members,asset.OwnerUserID)==""||asset.RevokedAt!=""||team.DeletedAt!=""{return ErrStorageAccessDenied};if manage&&asset.OwnerUserID!=userID&&role!="owner"&&role!="admin"{return ErrStorageAccessDenied};return nil
}}
func RevokeCurrentTeamAsset(ctx context.Context,id string)error{user,err:=accountDataUser(ctx);if err!=nil{return err};return teamLookupError(repository.RevokeTeamAsset(id,now(),teamAssetValidator(user.ID,true),newTeamAudit("",user.ID,"asset.revoke",id,"撤销共享素材")))}
func CurrentTeamAssetMedia(ctx context.Context,id,rangeHeader string)(DownloadedStorageObject,error){
	user,err:=accountDataUser(ctx);if err!=nil{return DownloadedStorageObject{},err};asset,err:=repository.ReadTeamAsset(id,teamAssetValidator(user.ID,false));if err!=nil{return DownloadedStorageObject{},teamLookupError(err)}
	object,err:=repository.GetStorageObject(asset.ObjectID);if err!=nil{return DownloadedStorageObject{},teamLookupError(err)};if object.CreatedBy!=asset.OwnerUserID||object.DeletedAt!=""||!strings.HasPrefix(object.MimeType,asset.Kind+"/"){return DownloadedStorageObject{},ErrStorageAccessDenied};return downloadStoredObject(object,rangeHeader)
}
func SetCurrentTeamCostPermission(ctx context.Context,teamID,targetID string,allow bool)error{
	user,err:=accountDataUser(ctx);if err!=nil{return err};return teamLookupError(repository.SetTeamCostPermission(teamID,targetID,allow,func(team model.Team,members []model.TeamMember)error{if team.OwnerID!=user.ID||teamRole(members,targetID)!="member"{return ErrStorageAccessDenied};return nil},newTeamAudit(teamID,user.ID,"member.cost_permission",targetID,"更新成员成本查看权限")))
}
func TransferCurrentTeamOwner(ctx context.Context,teamID,targetID,confirmation string)error{
	user,err:=accountDataUser(ctx);if err!=nil{return err};return teamLookupError(repository.TransferTeamOwner(teamID,user.ID,targetID,func(team model.Team,members []model.TeamMember)error{
		if team.OwnerID!=user.ID||targetID==user.ID||teamRole(members,targetID)==""{return ErrStorageAccessDenied};if confirmation!="转移团队所有权："+team.Name{return productionError("请输入完整的转移确认文字")};return nil
	},newTeamAudit(teamID,user.ID,"team.transfer",targetID,"转移团队所有权；原拥有者成为管理员")))
}
func CurrentTeamAudits(ctx context.Context,teamID string,q model.Query)(TeamListResult[model.TeamAudit],error){user,err:=accountDataUser(ctx);if err!=nil{return TeamListResult[model.TeamAudit]{},err};rows,total,err:=repository.TeamAudits(teamID,teamQuery(q),teamManager(user.ID));return TeamListResult[model.TeamAudit]{rows,total},teamLookupError(err)}
