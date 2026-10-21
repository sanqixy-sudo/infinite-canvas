package service

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

func TestCloudModelPolicyRejectsPersonalSources(t *testing.T) {
	if UserCanUseRemoteModelChannel(model.AuthUser{Role: model.UserRoleAdmin}) {
		t.Fatal("an account without an identity cannot use platform models")
	}
	if _, err := ResolveWorkflowForUser(model.AuthUser{ID: "user"}, WorkflowRef{Scope: "personal", ChannelID: "channel", WorkflowID: "workflow"}); err == nil {
		t.Fatal("personal workflows must be rejected before loading saved credentials")
	}
	for _, request := range []WorkflowAgentDraftRequest{
		{ChannelMode: "local"}, {BaseURL: "https://personal.invalid"}, {APIKey: "personal-key"}, {Protocol: "openai"},
	} {
		if _, err := workflowDraftChannel(request, "model"); err == nil {
			t.Fatal("personal agent channel input must be rejected")
		}
	}
}

func TestAutoDLMetadataUsesSavedSystemChannel(t *testing.T) {
	const marker = "CLOUD_AUTODL_METADATA_CHILD"
	if os.Getenv(marker) != "1" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestAutoDLMetadataUsesSavedSystemChannel$", "-test.timeout=30s")
		cmd.Env = append(os.Environ(), marker+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("isolated metadata policy: %v\n%s", err, output)
		}
		return
	}
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:"}
	allowed := true
	channel := model.ModelChannel{ID: "platform", Protocol: "autodl", BaseURL: "https://platform.invalid", APIKey: "platform-secret", Models: []string{"indextts2-v1", "private-model"}, Enabled: true, Weight: 1}
	settings := model.Settings{Private: model.PrivateSetting{Channels: []model.ModelChannel{channel}}, Public: model.PublicSetting{ModelChannel: model.PublicModelChannelSetting{AllowUserRemoteChannel: &allowed, AvailableModels: []string{"indextts2-v1"}}}}
	if _, err := repository.SaveSettings(settings, "fixture"); err != nil {
		t.Fatal(err)
	}
	ctx := WithUser(context.Background(), model.AuthUser{ID: "user"})
	for key, value := range map[string]string{
		channel.BaseURL + autoDLAPIPath + "/workflows/indextts2-v1": `{"uuid":"indextts2-v1","name":"云端音频","input_rules":{"text":{"type":"string"}}}`,
		channel.BaseURL + autoDLAPIPath + `/workflows{"page_index":1,"page_size":100}`: `{"list":[{"uuid":"indextts2-v1","name":"云端音频"},{"uuid":"private-model","name":"未公开"}],"max_page":1}`,
	} {
		autoDLMetadataCache.items[key] = autoDLMetadataEntry{data: json.RawMessage(value), expires: time.Now().Add(time.Minute)}
	}
	result, err := CurrentUserAutoDLWorkflows(ctx, channel.ID, "indextts2-v1")
	if workflow, ok := result.(AutoDLWorkflow); err != nil || !ok || workflow.UUID != "indextts2-v1" || workflow.Kind != "audio" {
		t.Fatalf("platform workflow detail unavailable: %v", err)
	}
	result, err = CurrentUserAutoDLWorkflows(ctx, channel.ID, "")
	if workflows, ok := result.([]AutoDLWorkflow); err != nil || !ok || len(workflows) != 1 || workflows[0].UUID != "indextts2-v1" {
		t.Fatalf("platform workflow list not filtered: %v", err)
	}
	for _, item := range [][2]string{{"missing", "indextts2-v1"}, {"platform", "private-model"}} {
		if _, err := CurrentUserAutoDLWorkflows(ctx, item[0], item[1]); err == nil {
			t.Fatalf("unconfigured or unpublished workflow was accepted: %v", item)
		}
	}
	if _, err := CurrentUserAutoDLWorkflows(context.Background(), channel.ID, "indextts2-v1"); err == nil {
		t.Fatal("anonymous metadata access must be rejected")
	}
}

func TestPublicUserModelConfigDoesNotExposeRetiredCredentials(t *testing.T) {
	raw := `{"localChannels":[{"apiKey":"retired-key"}],"workflowChannels":[{}],"channelTranslations":[{}],"apiKey":"retired-key","baseUrl":"https://private.invalid","publicChannels":[{}],"channelMode":"local","model":"platform-model","imageWorkflowRef":{"scope":"personal"},"videoWorkflowRef":{"scope":"system","channelId":"platform"},"syncStorageConfig":true}`
	result := publicUserModelConfig(raw)
	if strings.Contains(string(result), "retired-") || strings.Contains(string(result), "private.invalid") || strings.Contains(string(result), "personal") {
		t.Fatal("retired channel data leaked")
	}
	var config map[string]any
	if json.Unmarshal(result, &config) != nil || config["channelMode"] != "remote" || config["model"] != "platform-model" || config["syncStorageConfig"] != true || config["videoWorkflowRef"] == nil {
		t.Fatal("ordinary platform preferences were lost")
	}
	for _, key := range privateModelConfigKeys {
		if _, exists := config[key]; exists {
			t.Fatalf("private key remained in payload: %s", key)
		}
	}
}
