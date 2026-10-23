package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

var productionRenderOnce sync.Once

// StartProductionRenderWorker uses one shared database lease across all API replicas.
func StartProductionRenderWorker(){
	productionRenderOnce.Do(func(){go func(){
		cleanupProductionRenderTemp()
		go func(){for{cleanupProductionRenderUploads();time.Sleep(time.Minute)}}()
		for {
			stamp:=time.Now();workerID:=newID("render-worker")
			job,err:=repository.ClaimProductionRender(workerID,now(),stamp.Unix(),stamp.Add(time.Minute).Unix())
			if err!=nil{log.Printf("production render claim failed: %v",err)}
			if job!=nil{runProductionRender(*job);_ = repository.ReleaseProductionRenderLease(workerID)}
			time.Sleep(3*time.Second)
		}
	}()})
}

func cleanupProductionRenderTemp(){
	entries,err:=os.ReadDir(os.TempDir());if err!=nil{return}
	for _,entry:=range entries{
		if !entry.IsDir()||entry.Type()&os.ModeSymlink!=0||!strings.HasPrefix(entry.Name(),"xiaomeng-render-"){continue}
		info,err:=entry.Info();if err!=nil||time.Since(info.ModTime())<2*time.Hour{continue}
		_ = os.RemoveAll(filepath.Join(os.TempDir(),entry.Name()))
	}
}

func runProductionRender(job model.ProductionRenderJob){
	ctx,cancel:=context.WithTimeout(context.Background(),20*time.Minute);defer cancel()
	done:=make(chan struct{});defer close(done)
	go func(){ticker:=time.NewTicker(3*time.Second);defer ticker.Stop();for{select{
	case <-done:return
	case <-ctx.Done():return
	case <-ticker.C:
		current,err:=repository.GetProductionRender(job.UserID,job.ID)
		if err!=nil||current.Status!="running"||current.WorkerID!=job.WorkerID{cancel();return}
		stamp:=time.Now();if repository.RenewProductionRenderLease(job.WorkerID,stamp.Unix(),stamp.Add(time.Minute).Unix())!=nil{cancel();return}
	}}}()
	err:=executeProductionRender(ctx,job)
	if err!=nil{
		message:="成片失败，请检查素材和存储后重试"
		var safe safeMessageError
		if errors.As(err,&safe){message=safe.message}else if ctx.Err()!=nil{message="成片超时、任务已取消或合成服务中断，请检查后重试"}
		_ = repository.UpdateProductionRender(job,0,message,now())
		log.Printf("production render failed id=%s type=%T",job.ID,err)
	}
}

type renderProbe struct{
	Streams []struct{CodecType string `json:"codec_type"`;Width int `json:"width"`;Height int `json:"height"`;Duration string `json:"duration"`} `json:"streams"`
	Format struct{Duration string `json:"duration"`} `json:"format"`
}

type renderOutputBuffer struct{ bytes.Buffer; limit int }
func(buffer *renderOutputBuffer)Write(value []byte)(int,error){n:=len(value);if buffer.Len()<buffer.limit{keep:=min(n,buffer.limit-buffer.Len());_,_=buffer.Buffer.Write(value[:keep])};return n,nil}

func runRenderCommand(ctx context.Context,program string,args []string,capture bool,directory ...string)([]byte,error){
	cmd:=exec.CommandContext(ctx,program,args...)
	if len(directory)>0{cmd.Dir=directory[0]}
	output:=&renderOutputBuffer{limit:512<<10};stderr:=&renderOutputBuffer{limit:4096}
	if capture{cmd.Stdout=output}else{cmd.Stdout=io.Discard};cmd.Stderr=stderr
	if err:=cmd.Run();err!=nil{return nil,err};return output.Bytes(),nil
}

const renderDemuxers="mov,matroska,avi,mp3,wav,aac,flac,ogg,image2,png_pipe,jpeg_pipe,webp_pipe"

func probeRenderFile(ctx context.Context,filename string)(renderProbe,error){
	var result renderProbe
	raw,err:=runRenderCommand(ctx,"ffprobe",[]string{"-v","error","-protocol_whitelist","file,pipe","-format_whitelist",renderDemuxers,"-show_entries","stream=codec_type,width,height,duration:format=duration","-of","json",filename},true)
	if err!=nil||json.Unmarshal(raw,&result)!=nil{return result,productionError("素材无法识别，请使用常见 MP4/MOV/WebM 视频、PNG/JPEG/WebP 图片或 MP3/WAV 音轨")}
	for _,stream:=range result.Streams{if stream.CodecType=="video"&&(stream.Width<1||stream.Height<1||stream.Width>8192||stream.Height>8192||int64(stream.Width)*int64(stream.Height)>33554432){return result,productionError("素材画面尺寸无效或超过合成限制（单边 8192，像素总量 3355 万）")}}
	return result,nil
}

func downloadRenderFile(ctx context.Context,key,filename string,remaining int64)(int64,error){
	id,err:=productionRenderFileID(key);if err!=nil{return 0,err}
	download,err:=DownloadStorageObject(ctx,id,"","");if err!=nil{return 0,productionError("采用素材读取失败，请确认账号文件仍存在且存储配置可用")}
	defer download.Stream.Close()
	user,_:=UserFromContext(ctx)
	if download.Object.CreatedBy!=user.ID||download.Object.DeletedAt!=""{return 0,productionError("采用素材已删除或不属于当前账号")}
	if download.ContentLength>remaining{return 0,productionError("本集原文件合计超过 512 MiB")}
	done:=make(chan struct{});defer close(done)
	go func(){select{case <-ctx.Done():_ = download.Stream.Close();case <-done:}}()
	file,err:=os.OpenFile(filename,os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600);if err!=nil{return 0,err}
	written,copyErr:=io.Copy(file,io.LimitReader(download.Stream,remaining+1));closeErr:=file.Close()
	if ctx.Err()!=nil{return 0,ctx.Err()};if copyErr!=nil{return 0,productionError("素材下载中断，请检查存储后重试")};if closeErr!=nil{return 0,closeErr}
	if written<1||written>remaining{return 0,productionError("素材为空或本集文件超过 512 MiB")};return written,nil
}

func renderClipArgs(input,output string,clip productionRenderClip,hasAudio bool)[]string{
	seconds:=strconv.Itoa(clip.Seconds)
	args:=[]string{"-hide_banner","-loglevel","error","-nostdin","-y","-threads","2","-protocol_whitelist","file,pipe","-format_whitelist",renderDemuxers}
	if clip.Kind=="image"{args=append(args,"-f","image2","-loop","1","-framerate","24")}
	args=append(args,"-i",input)
	if !hasAudio{args=append(args,"-f","lavfi","-i","anullsrc=channel_layout=stereo:sample_rate=48000")}
	audio:="0:a:0";if !hasAudio{audio="1:a:0"}
	filter:="[0:v:0]scale=720:1280:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,trim=duration="+seconds+",setpts=PTS-STARTPTS[v];["+audio+"]atrim=duration="+seconds+",asetpts=PTS-STARTPTS,apad=whole_dur="+seconds+"[a]"
	return append(args,"-filter_complex_threads","1","-filter_complex",filter,"-map","[v]","-map","[a]","-map_metadata","-1","-t",seconds,"-c:v","libx264","-threads","2","-preset","veryfast","-pix_fmt","yuv420p","-r","24","-crf","23","-maxrate","4M","-bufsize","8M","-c:a","aac","-b:a","128k","-ar","48000","-ac","2","-movflags","+faststart","-fs",strconv.Itoa(productionRenderMaxOutput),output)
}

func executeProductionRender(ctx context.Context,job model.ProductionRenderJob)error{
	user,found,err:=repository.GetUserByID(job.UserID);if err!=nil{return err};if !found||user.Status!=model.UserStatusActive||user.Role==model.UserRoleGuest{return productionError("账号不可用，已停止成片")}
	ctx=WithUser(ctx,model.PublicUser(user))
	var snapshot productionRenderSnapshot
	if json.Unmarshal([]byte(job.SnapshotJSON),&snapshot)!=nil||len(snapshot.Clips)==0||len(snapshot.Clips)>60||job.Seconds<1||job.Seconds>300||math.IsNaN(snapshot.Delivery.OriginalGain)||math.IsInf(snapshot.Delivery.OriginalGain,0)||snapshot.Delivery.OriginalGain<0||snapshot.Delivery.OriginalGain>1||len(snapshot.Delivery.AudioTracks)>64||len(snapshot.Delivery.Subtitles)>500{return productionError("成片任务快照无效，请重新提交")}
	plannedSeconds:=0;for _,clip:=range snapshot.Clips{plannedSeconds+=clip.Seconds};if plannedSeconds!=job.Seconds{return productionError("成片快照时长不一致，请重新提交")}
	validation:=model.ProductionDocument{Episodes:[]model.ProductionEpisode{{ID:job.EpisodeID,Delivery:&snapshot.Delivery}}};for _,clip:=range snapshot.Clips{validation.Shots=append(validation.Shots,model.ProductionShot{ID:clip.ShotID,EpisodeID:job.EpisodeID})};if err:=validateProductionDelivery(validation);err!=nil{return err}
	for _,track:=range snapshot.Delivery.AudioTracks{if track.StartSeconds+track.DurationSeconds>float64(job.Seconds)+0.001{return productionError("音轨超出成片快照范围")}}
	for _,cue:=range snapshot.Delivery.Subtitles{if cue.EndSeconds>float64(job.Seconds)+0.001{return productionError("字幕超出成片快照范围")}}
	directory,err:=os.MkdirTemp("","xiaomeng-render-");if err!=nil{return err};defer os.RemoveAll(directory)
	inputs:=map[string]string{};var bytes int64
	getInput:=func(key string)(string,error){
		if file:=inputs[key];file!=""{return file,nil}
		id,err:=productionRenderFileID(key);if err!=nil{return "",err};info,err:=StorageObjectInfo(ctx,id);if err!=nil||info.CreatedBy!=job.UserID{return "",productionError("素材不属于当前账号或已不可用")}
		ext:=".media";switch strings.ToLower(strings.Split(info.MimeType,";")[0]){case "image/png":ext=".png";case "image/jpeg":ext=".jpg";case "image/webp":ext=".webp";default:if strings.HasPrefix(info.MimeType,"image/"){return "",productionError("成片图片暂支持 PNG、JPEG、WebP，请转换图片后重试")}}
		file:=filepath.Join(directory,fmt.Sprintf("input-%03d%s",len(inputs),ext));count,err:=downloadRenderFile(ctx,key,file,productionRenderMaxInput-bytes);if err!=nil{return "",err};bytes+=count;inputs[key]=file;return file,nil
	}
	audioFiles:=[]string{}
	for _,track:=range snapshot.Delivery.AudioTracks{
		audio,err:=getInput(track.StorageKey);if err!=nil{return err};probe,err:=probeRenderFile(ctx,audio);if err!=nil{return err};hasAudio:=false;for _,stream:=range probe.Streams{if stream.CodecType=="audio"{hasAudio=true}}
		duration,_:=strconv.ParseFloat(probe.Format.Duration,64)
		if !hasAudio||math.IsNaN(duration)||math.IsInf(duration,0)||duration+0.045<track.TrimStartSeconds+track.DurationSeconds{return productionError(track.Label+"：音轨不足以覆盖指定截取范围，请按实际音频时长调整")}
		audioFiles=append(audioFiles,audio)
	}
	var playlist strings.Builder
	var clipBytes int64
	for index,clip:=range snapshot.Clips{
		if ctx.Err()!=nil{return ctx.Err()};if clip.Seconds<1||clip.Seconds>60||clip.Kind!="image"&&clip.Kind!="video"{return productionError("镜头快照参数无效，请重新提交")}
		input,err:=getInput(clip.StorageKey);if err!=nil{return err};probe,err:=probeRenderFile(ctx,input);if err!=nil{return err}
		hasVideo,hasAudio:=false,false;duration:=float64(0)
		for _,stream:=range probe.Streams{if stream.CodecType=="video"{hasVideo=true;if value,_:=strconv.ParseFloat(stream.Duration,64);value>duration{duration=value}};if stream.CodecType=="audio"{hasAudio=true}}
		if duration==0{duration,_=strconv.ParseFloat(probe.Format.Duration,64)}
		if !hasVideo{return productionError(clip.Title+"：素材不包含可用画面")}
		if clip.Kind=="video"&&(math.IsNaN(duration)||math.IsInf(duration,0)||duration+0.045<float64(clip.Seconds)){return productionError(clip.Title+"：原视频短于计划时长或时长未知，请缩短镜头计划或更换采用视频后重新提交")}
		output:=filepath.Join(directory,fmt.Sprintf("clip-%03d.mp4",index))
		if _,err:=runRenderCommand(ctx,"ffmpeg",renderClipArgs(input,output,clip,clip.Kind=="video"&&hasAudio),false);err!=nil{return productionError(clip.Title+"：视频处理失败，请检查文件格式、服务器磁盘或 FFmpeg 编码器")}
		if err:=verifyRenderedFile(ctx,output,clip.Seconds);err!=nil{return err}
		stat,err:=os.Stat(output);if err!=nil{return err};clipBytes+=stat.Size();if clipBytes>=productionRenderMaxOutput{return productionError("本集镜头文件合计达到 256 MiB 上限，请拆分分集")}
		playlist.WriteString(fmt.Sprintf("file 'clip-%03d.mp4'\n",index))
		if err:=repository.UpdateProductionRender(job,5+(index+1)*75/len(snapshot.Clips),"",now());err!=nil{return err}
	}
	listPath:=filepath.Join(directory,"clips.txt");if err:=os.WriteFile(listPath,[]byte(playlist.String()),0600);err!=nil{return err}
	joined:=filepath.Join(directory,"joined.mp4")
	if _,err:=runRenderCommand(ctx,"ffmpeg",[]string{"-hide_banner","-loglevel","error","-nostdin","-y","-protocol_whitelist","file,pipe","-f","concat","-safe","1","-i",listPath,"-map","0:v:0","-map","0:a:0","-map_metadata","-1","-c","copy","-movflags","+faststart","-t",strconv.Itoa(job.Seconds),"-fs",strconv.Itoa(productionRenderMaxOutput),joined},false);err!=nil{return productionError("镜头拼接失败，请检查服务器磁盘或媒体编码")}
	output:=joined
	if len(snapshot.Delivery.AudioTracks)>0||snapshot.Delivery.OriginalGain!=1||snapshot.Delivery.BurnSubtitles&&len(snapshot.Delivery.Subtitles)>0{
		if snapshot.Delivery.BurnSubtitles&&len(snapshot.Delivery.Subtitles)>0{if err:=os.WriteFile(filepath.Join(directory,"captions.ass"),[]byte(productionASS(snapshot.Delivery.Subtitles)),0600);err!=nil{return err}}
		output=filepath.Join(directory,"mixed.mp4")
		if _,err:=runRenderCommand(ctx,"ffmpeg",productionMixArgs(joined,output,audioFiles,snapshot.Delivery,job.Seconds),false,directory);err!=nil{return productionError("音轨混合或字幕烧录失败，请检查音频范围、FFmpeg 字幕滤镜和中文字体")}
	}
	if err:=verifyRenderedFile(ctx,output,job.Seconds);err!=nil{return err}
	if err:=repository.UpdateProductionRender(job,90,"",now());err!=nil{return err}
	return persistProductionRender(ctx,job,output)
}

func verifyRenderedFile(ctx context.Context,filename string,seconds int)error{
	stat,err:=os.Stat(filename);if err!=nil||stat.Size()<1||stat.Size()>=productionRenderMaxOutput{return productionError("成片文件为空或达到 256 MiB 上限，请缩短分集后重新提交")}
	probe,err:=probeRenderFile(ctx,filename);if err!=nil{return err};duration,_:=strconv.ParseFloat(probe.Format.Duration,64)
	if math.IsNaN(duration)||math.IsInf(duration,0)||duration<float64(seconds)-0.1||duration>float64(seconds)+0.2{return productionError("生成文件时长与计划不一致，已停止交付，请检查原始素材")}
	for _,stream:=range probe.Streams{if stream.CodecType=="video"&&stream.Width==720&&stream.Height==1280{return nil}}
	return productionError("生成文件尺寸不符合 720×1280，已停止交付")
}

func persistProductionRender(ctx context.Context,job model.ProductionRenderJob,filename string)error{
	if ctx.Err()!=nil{return ctx.Err()}
	data,err:=os.ReadFile(filename);if err!=nil{return err};if len(data)<1||len(data)>productionRenderMaxOutput{return productionError("成片超出文件大小限制")}
	settings,err:=repository.GetSettings();if err!=nil{return err};storage:=normalizePrivateStorageSetting(settings.Private.Storage)
	if !canUseGlobalStorage(ctx,storage){return productionError("平台文件存储已停用，成片未保存，请启用后重试")}
	providers:=append([]model.StorageProvider{localStorageProvider()},storage.Providers...)
	var provider model.StorageProvider;for _,item:=range providers{if item.ID==job.ProviderID&&item.Enabled&&storageProviderConfigured(item){provider=item;break}}
	if provider.ID==""{return productionError("成片目标存储已停用，请恢复该存储后重试")}
	reservation,err:=reserveStorageUpload(ctx,int64(len(data)));if err!=nil{return err};defer releaseStorageUpload(reservation)
	if provider.Type==model.StorageProviderTypeLocal{localStorageUploadMu.Lock();defer localStorageUploadMu.Unlock();used,err:=repository.StorageBytesForProvider(localStorageProviderID);if err!=nil{return err};if used>storage.CapacityLimitBytes-int64(len(data)){return productionError("服务器本地存储容量不足，成片未保存")}}
	// A late upload from a cancelled/expired worker must never overwrite a newer attempt.
	objectKey:=path.Join(strings.Trim(provider.PathPrefix,"/"),job.UserID,"renders",job.ID,job.WorkerID+".mp4")
	intent:=model.ProductionRenderUpload{ID:job.WorkerID,JobID:job.ID,UserID:job.UserID,ProviderID:provider.ID,ProviderIdentity:renderProviderIdentity(provider),ObjectKey:objectKey,ReservationID:reservation.ID,State:"pending",NextCheckAt:time.Now().Add(time.Hour).Unix()}
	if err:=repository.PrepareProductionRenderUpload(job,intent,time.Now().Unix());err!=nil{return err}
	if ctx.Err()!=nil{return ctx.Err()}
	if err:=putStorageObject(provider,objectKey,"video/mp4",data);err!=nil{return productionError("成片上传存储失败，请检查存储配置后重试")}
	sum:=sha256.Sum256(data)
	object:=model.StorageObject{ID:job.ID,ProviderID:provider.ID,Bucket:provider.Bucket,ObjectKey:objectKey,PublicURL:objectURL(provider,objectKey),MimeType:"video/mp4",Bytes:int64(len(data)),Width:720,Height:1280,SHA256:hex.EncodeToString(sum[:]),CreatedBy:job.UserID,CreatedAt:now()}
	commerce,err:=AccountCommerceSettings();if err==nil{err=ctx.Err()};if err==nil{err=repository.CompleteProductionRender(job,object,reservation.ID,commerce.DefaultStorageBytes,time.Now().Unix(),now())}
	if err!=nil{_ = deleteStorageObjectData(provider,objectKey);return storageQuotaError(err)}
	return nil
}
