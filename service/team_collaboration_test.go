package service

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

func collaborativeTestDoc() model.ProductionDocument {
	return model.ProductionDocument{ProductionProject:model.ProductionProject{ID:"p",UserID:"owner",WorkspaceID:"private-workspace",Title:"计划",Revision:1},Episodes:[]model.ProductionEpisode{{ProjectID:"p",ID:"ep",Title:"第一集"}},Scenes:[]model.ProductionScene{},Assets:[]model.ProductionAsset{{ProjectID:"p",ID:"a",Title:"角色",Kind:"character",References:[]model.ProductionNodeRef{{CanvasID:"private-canvas",NodeID:"private-node"}}}},Shots:[]model.ProductionShot{{ProjectID:"p",ID:"s",EpisodeID:"ep",Title:"镜头",Seconds:5,Status:"draft",CanvasID:"private-canvas",ImageNodeID:"private-node",AssetIDs:[]string{"a"},Candidates:[]model.ProductionCandidate{{ID:"c",Kind:"image",Title:"候选",CanvasID:"private-canvas",NodeID:"private-node",StorageKey:"server:private-file"}},SelectedImageCandidateID:"c"}}}
}

func TestTeamPlanPrivateFieldsPreservedAndNotPublished(t *testing.T){
	doc:=collaborativeTestDoc();public:=publicTeamPlan(&doc);raw,_:=json.Marshal(public)
	for _,secret:=range []string{"private-","canvasId","nodeId","candidates","storageKey","workspaceId","delivery"}{if strings.Contains(string(raw),secret){t.Fatalf("private field exposed: %s",raw)}}
	public.Shots[0].Description="新的画面";public.Episodes[0].Script="新的剧本"
	if err:=mergeTeamPlan(&doc,public);err!=nil{t.Fatal(err)}
	if doc.Shots[0].CanvasID!="private-canvas"||doc.Shots[0].Candidates[0].StorageKey!="server:private-file"||doc.Assets[0].References[0].NodeID!="private-node"{t.Fatal("shared editing destroyed private bindings")}
	doc=collaborativeTestDoc();public=publicTeamPlan(&doc);public.Assets=nil;public.Shots[0].AssetIDs=nil;public.Scenes=append(public.Scenes,model.ProductionScene{ID:"a",EpisodeID:"ep",Title:"reuse asset ID"})
	if err:=mergeTeamPlan(&doc,public);err==nil{t.Fatal("existing asset deleted by reusing ID as scene")}
}

func TestTeamCollaborationCASOwnershipAndMedia(t *testing.T){
	const marker="TEAM_COLLAB_CHILD"
	if os.Getenv(marker)!="1"{ctx,cancel:=context.WithTimeout(context.Background(),45*time.Second);defer cancel();cmd:=exec.CommandContext(ctx,os.Args[0],"-test.run=^TestTeamCollaborationCASOwnershipAndMedia$","-test.timeout=40s");cmd.Env=append(os.Environ(),marker+"=1");if output,err:=cmd.CombinedOutput();err!=nil{t.Fatalf("team collaboration: %v\n%s",err,output)};return}
	config.Cfg=config.Config{StorageDriver:"sqlite",DatabaseDSN:filepath.Join(t.TempDir(),"collaboration.db"),LocalStorageDir:t.TempDir()};db,err:=repository.DB();if err!=nil{t.Fatal(err)};conn,err:=db.DB();if err!=nil{t.Fatal(err)};conn.SetMaxOpenConns(1);t.Cleanup(func(){_=conn.Close()})
	if err:=db.AutoMigrate(&model.Team{},&model.TeamMember{},&model.TeamInvite{},&model.TeamProject{},&model.TeamAsset{},&model.TeamAudit{},&model.ProductionReview{},&model.ProductionReviewComment{},&model.ProductionProject{},&model.ProductionEpisode{},&model.ProductionScene{},&model.ProductionAsset{},&model.ProductionShot{});err!=nil{t.Fatal(err)}
	for _,id:=range []string{"owner","member","outsider"}{if err:=db.Create(&model.User{ID:id,Username:id,AffCode:id,Role:model.UserRoleUser}).Error;err!=nil{t.Fatal(err)}}
	ctx:=func(id string)context.Context{return WithUser(context.Background(),model.AuthUser{ID:id,Role:model.UserRoleUser})};owner,member,outsider:=ctx("owner"),ctx("member"),ctx("outsider")
	team,err:=CreateCurrentUserTeam(owner,"制作组");if err!=nil{t.Fatal(err)};invite,err:=CreateCurrentTeamInvite(owner,team.ID);if err!=nil{t.Fatal(err)};if _,err:=JoinCurrentTeam(member,invite.Code);err!=nil{t.Fatal(err)}
	doc:=collaborativeTestDoc();for _,rows:=range []any{&doc.ProductionProject,&doc.Episodes,&doc.Assets,&doc.Shots}{if err:=db.Create(rows).Error;err!=nil{t.Fatal(err)}}
	shared,err:=ShareCurrentTeamProject(owner,team.ID,doc.WorkspaceID,1,true);if err!=nil{t.Fatal(err)}
	if _,err:=CurrentTeamProject(outsider,shared.ID);!errors.Is(err,ErrStorageAccessDenied){t.Fatalf("outsider read: %v",err)}
	detail,err:=CurrentTeamProject(member,shared.ID);if err!=nil{t.Fatal(err)};if detail.CanViewCosts||!detail.CanEdit{t.Fatal("member initial permissions")}
	detail.Plan.Shots[0].Description="成员协作";saved,err:=SaveCurrentTeamProject(member,shared.ID,detail.Plan);if err!=nil||saved.Revision!=2{t.Fatalf("save: %+v %v",saved,err)}
	if err:=repository.DeleteUserProductionDocument("owner",doc.ID,2);!errors.Is(err,repository.ErrProductionTeamShared){t.Fatalf("active shared plan was deletable: %v",err)}
	if _,err:=SaveCurrentTeamProject(member,shared.ID,detail.Plan);err==nil{t.Fatal("stale edit overwrote newer revision")}
	if err:=SetCurrentTeamCostPermission(member,team.ID,"member",true);!errors.Is(err,ErrStorageAccessDenied){t.Fatal("member granted own cost access")}
	if err:=SetCurrentTeamCostPermission(owner,team.ID,"member",true);err!=nil{t.Fatal(err)};access,err:=CurrentTeamProjectAccess(member,shared.ID);if err!=nil||!access.CanViewCosts{t.Fatal("cost permission not applied")}
	if err:=TransferCurrentTeamOwner(owner,team.ID,"member","wrong confirmation");err==nil{t.Fatal("ownership transferred without typed confirmation")}
	if err:=TransferCurrentTeamOwner(owner,team.ID,"member","转移团队所有权：制作组");err!=nil{t.Fatal(err)};access,err=CurrentTeamProjectAccess(member,shared.ID);if err!=nil||access.Team.OwnerID!="member"||access.Project.OwnerUserID!="owner"{t.Fatal("team transfer changed private project payer")}
	file:=model.StorageObject{ID:"asset-file",CreatedBy:"owner",ProviderID:localStorageProviderID,ObjectKey:"team/test.png",MimeType:"image/png",Bytes:3};if err:=putLocalObject(file.ObjectKey,[]byte("png"));err!=nil{t.Fatal(err)};if err:=db.Create(&file).Error;err!=nil{t.Fatal(err)}
	if _,err:=ShareCurrentTeamAsset(member,team.ID,file.ID,"偷取");err==nil{t.Fatal("member shared foreign private file")};asset,err:=ShareCurrentTeamAsset(owner,team.ID,file.ID,"明确共享");if err!=nil{t.Fatal(err)}
	stream,err:=CurrentTeamAssetMedia(member,asset.ID,"bytes=0-1");if err!=nil{t.Fatal(err)};data,_:=io.ReadAll(stream.Stream);_=stream.Stream.Close();if string(data)!="pn"||stream.StatusCode!=206{t.Fatal("shared range stream")}
	if err:=RevokeCurrentTeamAsset(owner,asset.ID);err!=nil{t.Fatal(err)};if _,err:=CurrentTeamAssetMedia(member,asset.ID,"");!errors.Is(err,ErrStorageAccessDenied){t.Fatal("revoked asset remained accessible")}
	if err:=ChangeCurrentTeamMember(member,team.ID,"owner","");err!=nil{t.Fatal(err)};if _,err:=CurrentTeamProject(member,shared.ID);!errors.Is(err,ErrStorageAccessDenied){t.Fatal("departed project owner's grant remained")}
	var count int64;if err:=db.Model(&model.TeamAudit{}).Where("team_id = ?",team.ID).Count(&count).Error;err!=nil||count<8{t.Fatalf("missing transactional audits: %d %v",count,err)}
}
