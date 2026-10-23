package service

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"github.com/google/uuid"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

type CanvasAudioTaskCreateInput struct {
	UserID          string
	UserDisplayName string
	SourceID        string
	NodeID          string
	ClientTaskID    string
	Model           string
	ChannelID       string
	UserChannelID   string
	ChannelName     string
	WorkflowRef     string
	Credits         float64
	BillingName     string
	BillingPath     string
	Prompt          string
	Endpoint        string
	ContentType     string
	RequestBody     string
	RawRequest      []byte
	MaxCredits      *float64
}

func CreateCanvasAudioTask(input CanvasAudioTaskCreateInput) (model.CanvasAudioTask, error) {
	if input.MaxCredits!=nil&&(math.IsNaN(*input.MaxCredits)||math.IsInf(*input.MaxCredits,0)||*input.MaxCredits<0){return model.CanvasAudioTask{},fmt.Errorf("确认算力无效")}
	current := now()
	task := model.CanvasAudioTask{
		ID:              firstVideoTaskValue(input.ClientTaskID, "canvas_audio_task_"+uuid.NewString()),
		UserID:          strings.TrimSpace(input.UserID),
		UserDisplayName: strings.TrimSpace(input.UserDisplayName),
		Source:          "canvas",
		SourceID:        strings.TrimSpace(input.SourceID),
		NodeID:          strings.TrimSpace(input.NodeID),
		Model:           strings.TrimSpace(input.Model),
		ChannelID:       strings.TrimSpace(input.ChannelID),
		UserChannelID:   strings.TrimSpace(input.UserChannelID),
		ChannelName:     strings.TrimSpace(input.ChannelName),
		WorkflowRef:     input.WorkflowRef,
		Credits:         input.Credits,
		Status:          "queued",
		Progress:        0,
		Prompt:          strings.TrimSpace(input.Prompt),
		Endpoint:        strings.TrimSpace(input.Endpoint),
		ContentType:     strings.TrimSpace(input.ContentType),
		RequestBody:     input.RequestBody,
		MaxCredits:      input.MaxCredits,
		CreatedAt:       current,
		UpdatedAt:       current,
	}
	body:=input.RawRequest;if len(body)==0{body=[]byte(input.RequestBody)}
	fingerprint,_:=json.Marshal([]any{task.UserID,task.Model,task.ChannelID,task.UserChannelID,task.Endpoint,task.ContentType,task.SourceID,task.NodeID,task.Prompt,string(body),input.MaxCredits})
	hash:=sha256.Sum256(fingerprint);task.RequestHash=hex.EncodeToString(hash[:])
	saved := task
	var err error
	ids, err := taskStorageReferenceIDs(task)
	if err != nil {
		return task, err
	}
	if input.WorkflowRef != "" {
		err = ConsumeUserCredits(task.UserID, input.BillingName, task.Credits, input.BillingPath, &task)
	} else {
		saved, err = repository.SaveCanvasAudioTask(task, ids...)
	}
	if err == nil {
		WakeVideoTaskPoller()
	}
	return saved, storageReferenceError(err)
}

func GetUserCanvasAudioTask(userID string, id string) (model.CanvasAudioTask, bool, error) {
	return repository.GetUserCanvasAudioTask(strings.TrimSpace(userID), strings.TrimSpace(id))
}

func SaveCanvasAudioTask(task model.CanvasAudioTask) (model.CanvasAudioTask, error) {
	task.UpdatedAt = now()
	ids, err := taskStorageReferenceIDs(task)
	if err != nil {
		return task, err
	}
	saved, err := repository.UpdateCanvasAudioTask(task, ids...)
	return saved, storageReferenceError(err)
}

func CanvasAudioTaskResponse(task model.CanvasAudioTask) map[string]any {
	result := map[string]any{
		"id":           task.ID,
		"object":       "canvas.audio.task",
		"source":       task.Source,
		"source_id":    task.SourceID,
		"node_id":      task.NodeID,
		"model":        task.Model,
		"status":       task.Status,
		"progress":     task.Progress,
		"prompt":       task.Prompt,
		"created_at":   task.CreatedAt,
		"updated_at":   task.UpdatedAt,
		"started_at":   task.StartedAt,
		"completed_at": task.CompletedAt,
		"createdAt":    task.CreatedAt,
		"updatedAt":    task.UpdatedAt,
	}
	if task.AudioURL != "" {
		result["url"] = task.AudioURL
		result["audio_url"] = task.AudioURL
		result["storageKey"] = task.StorageKey
		result["mimeType"] = task.MimeType
		result["bytes"] = task.Bytes
	}
	if task.Error != "" || task.ErrorDetail != "" {
		result["error"] = map[string]any{"message": firstVideoTaskValue(task.Error, task.ErrorDetail)}
		result["error_detail"] = task.ErrorDetail
	}
	return result
}
