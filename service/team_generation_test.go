package service

import (
	"context"
	"encoding/json"
	"errors"
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

func TestTeamGenerationDTOHidesCostsAndPrivateContext(t *testing.T){
	amount:=7.0;row:=model.TeamGenerationApproval{ID:"request",PayerID:"private-payer",CanvasID:"private-canvas",NodeID:"private-node",PreparedRequest:"private-signed-url",RequestHash:"private-hash",Parameters:`{"resolution":"720p"}`,ReservedCredits:8,ActualCredits:&amount,AccountedHold:8}
	raw,_:=json.Marshal(teamGenerationDTO(row,false));for _,secret:=range []string{"private-","reservedCredits","actualCredits","accountedHold","preparedRequest","requestHash"}{if strings.Contains(string(raw),secret){t.Fatalf("member DTO leak: %s",raw)}}
	visible:=teamGenerationDTO(row,true);if visible["reservedCredits"]!=8.0||visible["actualCredits"]==nil{t.Fatal("authorized cost detail missing")}
}

func TestTeamGenerationBudgetReservationAndSettlement(t *testing.T){
	const marker="TEAM_BUDGET_CHILD"
	if os.Getenv(marker)!="1"{ctx,cancel:=context.WithTimeout(context.Background(),45*time.Second);defer cancel();cmd:=exec.CommandContext(ctx,os.Args[0],"-test.run=^TestTeamGenerationBudgetReservationAndSettlement$","-test.timeout=40s");cmd.Env=append(os.Environ(),marker+"=1");if output,err:=cmd.CombinedOutput();err!=nil{t.Fatalf("team budget: %v\n%s",err,output)};return}
	config.Cfg=config.Config{StorageDriver:"sqlite",DatabaseDSN:filepath.Join(t.TempDir(),"team-budget.db")};db,err:=repository.DB();if err!=nil{t.Fatal(err)};conn,err:=db.DB();if err!=nil{t.Fatal(err)};conn.SetMaxOpenConns(1);t.Cleanup(func(){_=conn.Close()})
	if err:=db.AutoMigrate(&model.Team{},&model.TeamMember{},&model.TeamProject{},&model.TeamAsset{},&model.TeamAudit{},&model.TeamGenerationBudget{},&model.TeamGenerationApproval{},&model.ProductionProject{},&model.ProductionEpisode{},&model.ProductionShot{},&model.ProductionTaskRecord{},&model.ProductionTaskLink{},&model.CanvasProject{});err!=nil{t.Fatal(err)}
	for _,value:=range []any{
		&model.User{ID:"payer",Username:"payer",AffCode:"payer",Role:model.UserRoleUser,Status:model.UserStatusActive,Credits:50},&model.User{ID:"requester",Username:"requester",AffCode:"requester",Role:model.UserRoleUser,Status:model.UserStatusActive},
		&model.Team{ID:"team",Name:"协作组",OwnerID:"payer"},&model.TeamMember{TeamID:"team",UserID:"payer",Role:"owner"},&model.TeamMember{TeamID:"team",UserID:"requester",Role:"member"},
		&model.TeamProject{ID:"shared",TeamID:"team",OwnerUserID:"payer",WorkspaceID:"workspace",Title:"短剧"},&model.ProductionProject{ID:"plan",UserID:"payer",WorkspaceID:"workspace",Title:"短剧",Revision:1},&model.ProductionShot{ProjectID:"plan",ID:"shot",EpisodeID:"ep",Title:"镜头",CanvasID:"canvas",VideoNodeID:"node"},&model.TeamGenerationBudget{ProjectID:"shared",LimitCredits:10},
		&model.CanvasProject{UserID:"payer",ID:"canvas",CreatedAt:"2026-01-01T00:00:00.000Z",UpdatedAt:"2026-01-01T00:00:00.000Z",ProjectData:`{"id":"canvas","nodes":[{"id":"node","type":"video","position":{"x":12,"y":20},"metadata":{"prompt":"original prompt","content":"original.mp4","storageKey":"local:original","status":"success","videoTaskVideoId":"old-poll"}}],"connections":[]}`},
	}{if err:=db.Create(value).Error;err!=nil{t.Fatal(err)}}
	makeTask:=func(id string,reserve float64)model.VideoTask{
		approval:=model.TeamGenerationApproval{ID:"approval-"+id,ProjectID:"shared",TeamID:"team",RequesterID:"requester",PayerID:"payer",ShotID:"shot",CanvasID:"canvas",NodeID:"node",State:"pending",PreparedRequest:"{}",Parameters:"{}"};if err:=db.Create(&approval).Error;err!=nil{t.Fatal(err)}
		return model.VideoTask{ID:id,UserID:"payer",TeamApprovalID:approval.ID,CanvasID:"canvas",Source:"canvas",SourceID:"node",GatewaySnapshot:"{}",GatewayRequestHash:id,RequestBody:"{}",ReservedCredits:reserve,Status:"queued",BillingStatus:"reserved",CreatedAt:now(),UpdatedAt:now()}
	}
	reserve:=func(task model.VideoTask)(bool,error){_,created,err:=repository.ReserveGatewayTask(task,model.CreditLog{ID:"reserve-"+task.ID,UserID:"payer",RelatedID:task.ID,Type:model.CreditLogTypeAIConsume,Amount:-task.ReservedCredits});return created,err}
	assertMoney:=func(credits,held,spent float64){t.Helper();var user model.User;var budget model.TeamGenerationBudget;if err:=db.First(&user,"id = ?","payer").Error;err!=nil{t.Fatal(err)};if err:=db.First(&budget,"project_id = ?","shared").Error;err!=nil{t.Fatal(err)};if user.Credits!=credits||budget.HeldCredits!=held||budget.SpentCredits!=spent{t.Fatalf("money user=%v hold=%v spent=%v want=%v/%v/%v",user.Credits,budget.HeldCredits,budget.SpentCredits,credits,held,spent)}}
	task:=makeTask("first",8);if created,err:=reserve(task);err!=nil||!created{t.Fatalf("first reserve: %v %v",created,err)};assertMoney(42,8,0)
	var bound model.CanvasProject;if err:=db.Where("user_id = ? AND id = ?","payer","canvas").First(&bound).Error;err!=nil{t.Fatal(err)}
	if !strings.Contains(bound.ProjectData,`"videoTaskId":"first"`)||!strings.Contains(bound.ProjectData,`"content":"original.mp4"`)||!strings.Contains(bound.ProjectData,`"prompt":"original prompt"`)||strings.Contains(bound.ProjectData,"old-poll"){t.Fatalf("canvas binding changed media or failed: %s",bound.ProjectData)}
	if created,err:=reserve(task);err!=nil||created{t.Fatalf("idempotent reserve: %v %v",created,err)};assertMoney(42,8,0)
	var repeated model.CanvasProject;if err:=db.Where("user_id = ? AND id = ?","payer","canvas").First(&repeated).Error;err!=nil{t.Fatal(err)};if repeated.ProjectData!=bound.ProjectData||repeated.UpdatedAt!=bound.UpdatedAt{t.Fatal("repeat approval rewrote canvas")}
	busyTask:=makeTask("busy-node",1);if _,err:=reserve(busyTask);!errors.Is(err,repository.ErrTeamCanvasTask){t.Fatalf("overlapping task overwritten: %v",err)};assertMoney(42,8,0)
	stale:=bound;stale.UpdatedAt=time.Now().UTC().Add(time.Second).Format("2006-01-02T15:04:05.000Z");stale.ProjectData=`{"id":"canvas","nodes":[{"id":"node","type":"video","metadata":{"prompt":"new local prompt","content":"local-edit.mp4","status":"success"}}]}`
	merged,err:=repository.SaveUserCanvasProject(stale);if err!=nil{t.Fatal(err)};if !strings.Contains(merged.ProjectData,`"videoTaskId":"first"`)||!strings.Contains(merged.ProjectData,`"prompt":"new local prompt"`)||!strings.Contains(merged.ProjectData,`"content":"local-edit.mp4"`){t.Fatalf("delayed save lost task or local content: %s",merged.ProjectData)}
	blocked:=makeTask("over-budget",3);if _,err:=reserve(blocked);!errors.Is(err,repository.ErrTeamBudget){t.Fatalf("budget not enforced: %v",err)};assertMoney(42,8,0)
	if err:=db.Model(&model.TeamGenerationBudget{}).Where("project_id = ?","shared").Update("limit_credits",50).Error;err!=nil{t.Fatal(err)};if err:=db.Model(&model.User{}).Where("id = ?","payer").Update("credits",1).Error;err!=nil{t.Fatal(err)}
	if _,err:=reserve(blocked);!errors.Is(err,repository.ErrGatewayBalance){t.Fatalf("wallet not enforced: %v",err)};assertMoney(1,8,0)
	actual:=11.0;task.Status,task.BillingStatus,task.UpdatedAt="completed","settled",now();task.ActualTokens=100
	settle:=func(id string)error{return repository.ApplyGatewayTaskResult(task,&actual,model.CreditLog{ID:id,UserID:"payer",RelatedID:task.ID})}
	if err:=settle("pending-charge");err!=nil{t.Fatal(err)};assertMoney(1,11,0)
	if err:=settle("pending-retry");err!=nil{t.Fatal(err)};assertMoney(1,11,0)
	if _,err:=reserve(blocked);!errors.Is(err,repository.ErrGatewayBalance){t.Fatalf("pending debt did not block next charge: %v",err)};assertMoney(1,11,0)
	if err:=db.Model(&model.User{}).Where("id = ?","payer").Update("credits",20).Error;err!=nil{t.Fatal(err)}
	// Revoking a requester does not discard an already-incurred charge.
	if err:=db.Where("team_id = ? AND user_id = ?","team","requester").Delete(&model.TeamMember{}).Error;err!=nil{t.Fatal(err)}
	if err:=settle("settled-charge");err!=nil{t.Fatal(err)};assertMoney(17,0,11)
	if err:=settle("settled-retry");err!=nil{t.Fatal(err)};assertMoney(17,0,11)
	if _,err:=reserve(blocked);!errors.Is(err,repository.ErrTeamBudget){t.Fatalf("removed requester approval accepted: %v",err)};assertMoney(17,0,11)
	if err:=db.Create(&model.TeamMember{TeamID:"team",UserID:"requester",Role:"member"}).Error;err!=nil{t.Fatal(err)}
	if created,err:=reserve(blocked);err!=nil||!created{t.Fatalf("new task after debt cleared: %v %v",created,err)};assertMoney(14,3,11)
	zero:=0.0;blocked.Status,blocked.BillingStatus,blocked.UpdatedAt="failed","released",now();if err:=repository.ApplyGatewayTaskResult(blocked,&zero,model.CreditLog{ID:"refund",UserID:"payer",RelatedID:blocked.ID});err!=nil{t.Fatal(err)};assertMoney(17,0,11)
	if err:=repository.ApplyGatewayTaskResult(blocked,&zero,model.CreditLog{ID:"refund-retry",UserID:"payer",RelatedID:blocked.ID});err!=nil{t.Fatal(err)};assertMoney(17,0,11)
	var count int64;if err:=db.Model(&model.VideoTask{}).Where("user_id = ?","payer").Count(&count).Error;err!=nil||count!=2{t.Fatalf("unexpected task count %d %v",count,err)}
	assertApprovalRetryBlocked:=func(){t.Helper();list,err:=CurrentUserProductionTasks(WithUser(context.Background(),model.AuthUser{ID:"payer",Role:model.UserRoleUser}),"workspace",ProductionTaskQuery{Page:1,PageSize:20,Status:"failed"});if err!=nil{t.Fatal(err)};if len(list.Items)!=1||list.Items[0].ID!=blocked.ID||list.Items[0].CanRetry||!strings.Contains(list.Items[0].RetryReason,"重新申请并审批"){t.Fatalf("team approval exposed direct retry: %+v",list)}}
	assertApprovalRetryBlocked()
	if err:=db.Model(&model.TeamProject{}).Where("id = ?","shared").Update("revoked_at",now()).Error;err!=nil{t.Fatal(err)}
	if err:=repository.DeleteUserVideoTask("payer",blocked.ID);err!=nil{t.Fatal(err)}
	assertApprovalRetryBlocked()
}
