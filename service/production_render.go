package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os/exec"
	"strings"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"gorm.io/gorm"
)

const productionRenderMaxInput = 512 << 20
const productionRenderMaxOutput = 256 << 20

type ProductionRenderInput struct {
	WorkspaceID string `json:"workspaceId"`
	EpisodeID string `json:"episodeId"`
	Revision int64 `json:"revision"`
	RequestID string `json:"requestId"`
}

type productionRenderClip struct {
	ShotID string `json:"shotId"`
	Title string `json:"title"`
	Seconds int `json:"seconds"`
	Kind string `json:"kind"`
	StorageKey string `json:"storageKey"`
}

type productionRenderSnapshot struct {
	Clips []productionRenderClip `json:"clips"`
	Delivery model.ProductionDeliveryEdit `json:"delivery"`
}

func productionRenderFileID(key string) (string,error) {
	id := strings.TrimPrefix(key,"server:")
	if !strings.HasPrefix(key,"server:") || id == "" || len(id)>128 || strings.ContainsAny(id,"/:\\\x00\r\n") { return "",productionError("成片只支持已保存到账号的素材文件，请先将浏览器本地或外链素材存入账号再建立候选") }
	return id,nil
}

func productionRenderError(err error) error {
	if errors.Is(err,repository.ErrProductionRenderConflict) { return productionError("制作计划版本或请求已变化，请保存计划后重新提交成片") }
	if errors.Is(err,repository.ErrProductionRenderLimit) { return productionError("每个账号最多同时排队或合成 2 个成片任务，请等待或取消已有任务") }
	if errors.Is(err,repository.ErrProductionRenderStopped) { return productionError("任务状态已变化，请刷新后操作") }
	if errors.Is(err,gorm.ErrRecordNotFound) { return productionError("任务或制作计划不存在，或不属于当前账号") }
	return err
}

func CurrentUserProductionRenders(ctx context.Context, workspaceID string) ([]model.ProductionRenderJob,error) {
	userID,err:=productionUser(ctx); if err!=nil{return nil,err}
	if err:=productionID(&workspaceID,"项目",true);err!=nil{return nil,err}
	return repository.ListProductionRenders(userID,workspaceID)
}

func CurrentUserProductionRenderRequest(ctx context.Context,requestID string)(*model.ProductionRenderJob,error){
	userID,err:=productionUser(ctx);if err!=nil{return nil,err}
	if err:=productionID(&requestID,"成片请求",true);err!=nil{return nil,err}
	return repository.GetProductionRenderByRequest(userID,requestID)
}

func CancelCurrentUserProductionRenderRequest(ctx context.Context,requestID string)(model.ProductionRenderJob,error){
	userID,err:=productionUser(ctx);if err!=nil{return model.ProductionRenderJob{},err}
	if err:=productionID(&requestID,"成片请求",true);err!=nil{return model.ProductionRenderJob{},err}
	stamp:=now()
	return repository.CancelProductionRenderRequest(model.ProductionRenderJob{ID:newID("render"),UserID:userID,RequestID:requestID,RequestHash:"cancelled-before-submission",Status:"cancelled",Error:"已取消待确认的成片提交",CreatedAt:stamp,UpdatedAt:stamp})
}

func CreateCurrentUserProductionRender(ctx context.Context,input ProductionRenderInput)(model.ProductionRenderJob,error){
	var job model.ProductionRenderJob
	userID,err:=productionUser(ctx);if err!=nil{return job,err}
	for label,value:=range map[string]*string{"项目":&input.WorkspaceID,"分集":&input.EpisodeID,"成片请求":&input.RequestID}{if err:=productionID(value,label,true);err!=nil{return job,err}}
	if input.Revision<1 || input.Revision>=1<<53{return job,productionError("制作计划版本无效")}
	requestBytes,_:=json.Marshal(input);hash:=sha256.Sum256(requestBytes);requestHash:=hex.EncodeToString(hash[:])
	if existing,err:=repository.GetProductionRenderByRequest(userID,input.RequestID);err!=nil{return job,err}else if existing!=nil{if existing.RequestHash!=requestHash{return job,productionRenderError(repository.ErrProductionRenderConflict)};return *existing,nil}
	if _,err:=exec.LookPath("ffmpeg");err!=nil{return job,productionError("成片服务尚未安装 FFmpeg，请管理员更新后端容器")}
	if _,err:=exec.LookPath("ffprobe");err!=nil{return job,productionError("成片服务尚未安装 FFprobe，请管理员更新后端容器")}
	doc,err:=repository.GetUserProductionDocument(userID,input.WorkspaceID);if err!=nil{return job,err};if doc==nil||doc.Revision!=input.Revision{return job,productionError("请先保存制作计划，再按当前账号版本提交成片")}
	sortProduction(doc)
	var title string;for _,episode:=range doc.Episodes{if episode.ID==input.EpisodeID{title=episode.Title;break}}
	if title==""{return job,productionError("当前分集不存在")}
	snapshot:=productionRenderSnapshot{Delivery:model.ProductionDeliveryEdit{OriginalGain:1,AudioTracks:[]model.ProductionAudioTrack{},Subtitles:[]model.ProductionSubtitle{}}}
	for _,episode:=range doc.Episodes{if episode.ID==input.EpisodeID&&episode.Delivery!=nil{snapshot.Delivery=*episode.Delivery;break}}
	if err:=validateProductionDelivery(*doc);err!=nil{return job,err}
	validation:=model.ProductionDocument{ProductionProject:doc.ProductionProject}
	canvasIDs:=[]string{doc.WorkspaceID};storageIDs:=[]string{};expected:=map[string]string{};seconds:=0
	for _,shot:=range doc.Shots{
		if shot.EpisodeID!=input.EpisodeID{continue}
		if shot.Seconds<1||shot.Seconds>60{return job,productionError("成片单镜头时长须为 1～60 秒，请在镜头计划中调整")}
		selected,kind:=shot.SelectedVideoCandidateID,"video";if selected==""{selected,kind=shot.SelectedImageCandidateID,"image"}
		var chosen *model.ProductionCandidate
		for _,candidate:=range shot.Candidates{if candidate.ID==selected&&candidate.Kind==kind{copy:=candidate;chosen=&copy;break}}
		if chosen==nil{return job,productionError(shot.Title+"：尚未采用图片或视频")}
		fileID,err:=productionRenderFileID(chosen.StorageKey);if err!=nil{return job,err}
		if old:=expected[fileID];old!=""&&old!=kind{return job,productionError("同一文件不能同时作为图片和视频")};expected[fileID]=kind
		storageIDs=append(storageIDs,fileID);canvasIDs=append(canvasIDs,chosen.CanvasID)
		snapshot.Clips=append(snapshot.Clips,productionRenderClip{ShotID:shot.ID,Title:shot.Title,Seconds:shot.Seconds,Kind:kind,StorageKey:chosen.StorageKey})
		validation.Shots=append(validation.Shots,model.ProductionShot{Candidates:[]model.ProductionCandidate{*chosen}});seconds+=shot.Seconds
	}
	if len(snapshot.Clips)==0||len(snapshot.Clips)>60||seconds>300{return job,productionError("单次成片支持 1～60 个镜头，总计划时长最多 300 秒")}
	for _,track:=range snapshot.Delivery.AudioTracks{id,err:=productionRenderFileID(track.StorageKey);if err!=nil{return job,err};storageIDs=append(storageIDs,id);if expected[id]!=""&&expected[id]!="audio"{return job,productionError("音轨不能与画面素材共用同一文件")};expected[id]="audio";if track.StartSeconds+track.DurationSeconds>float64(seconds)+0.001{return job,productionError("音轨超过本集计划时长，请在时间编辑中调整")}}
	for _,cue:=range snapshot.Delivery.Subtitles{if cue.EndSeconds>float64(seconds)+0.001{return job,productionError("字幕超过本集计划时长，请在字幕编辑中调整")}}
	settings,err:=repository.GetSettings();if err!=nil{return job,err};storage:=normalizePrivateStorageSetting(settings.Private.Storage)
	if !canUseGlobalStorage(ctx,storage){return job,productionError("账号未启用平台文件存储，暂不能保存成片")}
	provider,err:=selectStorageProvider(storage);if err!=nil{return job,productionError("请管理员先启用平台本地或 R2 / S3 存储")}
	usage,err:=CurrentUserStorageUsage(ctx);if err!=nil{return job,err};if usage.RemainingBytes<int64(seconds)*550000+(1<<20){return job,productionError("账号剩余空间不足以容纳本次成片，请先清理文件或扩容")}
	raw,_:=json.Marshal(snapshot)
	stamp:=now();job=model.ProductionRenderJob{ID:newID("render"),UserID:userID,RequestID:input.RequestID,RequestHash:requestHash,WorkspaceID:input.WorkspaceID,EpisodeID:input.EpisodeID,EpisodeTitle:title,Revision:input.Revision,Status:"queued",Seconds:seconds,ShotCount:len(snapshot.Clips),SnapshotJSON:string(raw),ProviderID:provider.ID,CreatedAt:stamp,UpdatedAt:stamp}
	job,err=repository.CreateProductionRender(job,canvasIDs,storageIDs,func(canvases []model.CanvasProject,files []model.StorageObject)error{
		if err:=validateProductionCanvases(validation,canvases);err!=nil{return err}
		if len(files)!=len(expected){return productionError("采用文件不存在、已删除或不属于当前账号")}
		var bytes int64;for _,file:=range files{if !strings.HasPrefix(strings.ToLower(file.MimeType),expected[file.ID]+"/")||file.Bytes<=0{return productionError("采用文件类型不符或文件为空")};if expected[file.ID]=="audio"&&file.Bytes>64<<20{return productionError("背景音轨不能超过 64 MiB，请先压缩音频")};bytes+=file.Bytes}
		if bytes>productionRenderMaxInput{return productionError("本集采用文件合计超过 512 MiB，请拆分分集或先压缩素材")};return nil
	})
	return job,productionRenderError(err)
}

func ActionCurrentUserProductionRender(ctx context.Context,id,action string)(model.ProductionRenderJob,error){
	userID,err:=productionUser(ctx);if err!=nil{return model.ProductionRenderJob{},err}
	if err:=productionID(&id,"成片任务",true);err!=nil{return model.ProductionRenderJob{},err}
	if action!="retry"&&action!="cancel"{return model.ProductionRenderJob{},productionError("仅支持重试或取消成片任务")}
	job,err:=repository.GetProductionRender(userID,id);if err!=nil{return job,productionRenderError(err)}
	ids:=[]string{}
	if action=="retry"{var snapshot productionRenderSnapshot;if json.Unmarshal([]byte(job.SnapshotJSON),&snapshot)!=nil{return job,productionError("任务快照无效，请重新提交成片")};for _,clip:=range snapshot.Clips{id,err:=productionRenderFileID(clip.StorageKey);if err!=nil{return job,err};ids=append(ids,id)};for _,track:=range snapshot.Delivery.AudioTracks{id,err:=productionRenderFileID(track.StorageKey);if err!=nil{return job,err};ids=append(ids,id)}}
	if err:=repository.ActionProductionRender(userID,id,action,now(),ids);err!=nil{return job,productionRenderError(err)}
	return repository.GetProductionRender(userID,id)
}
