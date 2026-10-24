package service

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

var canvasTaskRuns sync.Map

type canvasTaskRun struct {
	cancel context.CancelFunc
}

func canvasTaskModel(kind string) (any, error) {
	switch kind {
	case "image":
		return &model.CanvasImageTask{}, nil
	case "video":
		return &model.VideoTask{}, nil
	case "audio":
		return &model.CanvasAudioTask{}, nil
	}
	return nil, errors.New("不支持的任务类型")
}

func CanvasTaskContext(kind, userID, id string) (context.Context, func(), error) {
	task, err := canvasTaskModel(kind)
	if err != nil {
		return nil, nil, err
	}
	ctx, cancel := context.WithCancel(WithTaskCreditReference(context.Background(), kind, id))
	key := kind + ":" + userID + ":" + id
	run := &canvasTaskRun{cancel: cancel}
	canvasTaskRuns.Store(key, run)
	cleanup := func() {
		canvasTaskRuns.CompareAndDelete(key, run)
		cancel()
	}
	stopped, err := repository.CanvasTaskStopped(userID, id, task)
	if err != nil || stopped {
		cleanup()
		if err == nil {
			err = context.Canceled
		}
	}
	return ctx, cleanup, err
}

func StopCanvasTask(userID, kind, id string, workflow bool, source string) (bool, error) {
	source = strings.TrimSpace(source)
	if source == "" {
		source = "canvas"
	}
	if source != "canvas" && (kind != "video" || source != "video-workbench") {
		return false, errors.New("不支持的任务来源")
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return false, errors.New("缺少任务 ID")
	}
	if kind == "video" && !workflow {
		lookup := id
		if strings.HasPrefix(id,"client_video_task_") { lookup="gateway_"+gatewayHash([]string{userID,id}) }
		if video,found,err:=repository.GetUserVideoTask(userID,lookup);err!=nil{return false,err}else if found && video.GatewaySnapshot!="" {
			return false,safeMessageError{message:"该渠道暂不支持取消已提交任务，任务会在后台继续生成并按实际用量结算"}
		}
	}
	task, err := canvasTaskModel(kind)
	if err != nil {
		return false, err
	}
	current := time.Now().UTC()
	if kind=="audio"&&!workflow&&strings.HasPrefix(id,"production_voice_") { if len(id)>128||strings.ContainsAny(id,"/:\\\x00\r\n"){return false,errors.New("配音任务 ID 无效")};if err:=repository.EnsureCancelledAudioRequest(userID,id,current.Format(time.RFC3339Nano));err!=nil{return false,err} }
	if workflow {
		id = workflowTaskID(userID, kind, id)
	} else if kind == "video" && strings.HasPrefix(id, "client_video_task_") {
		stamp := current.Format(time.RFC3339Nano)
		task = &model.VideoTask{ID: id, UserID: userID, Source: source, Status: "cancelled", CreatedAt: stamp, UpdatedAt: stamp, CompletedAt: stamp}
	}
	stopped, comfyCleanup, err := repository.StopCanvasTask(userID, id, source, task, current)
	if err != nil {
		return false, err
	}
	if stopped {
		if run, ok := canvasTaskRuns.Load(kind + ":" + userID + ":" + id); ok {
			run.(*canvasTaskRun).cancel()
		}
		if comfyCleanup {
			WakeComfyBridgePoller()
		}
	}
	return stopped, nil
}
