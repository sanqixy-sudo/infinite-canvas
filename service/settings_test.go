package service

import (
	"math"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/tigerowo/infinite-canvas/model"
)

func TestPublicModelSelectionRequiresConfiguredChannelAndExplicitAllowlist(t *testing.T) {
	channel := model.ModelChannel{ID: "channel-1", Protocol: "openai", Enabled: true, BaseURL: "https://models.example.com", APIKey: "secret", Models: []string{"image-1"}}
	if got := normalizePublicSettingWithChannels(model.PublicSetting{}, []model.ModelChannel{channel}); len(got.ModelChannel.AvailableModels) != 0 {
		t.Fatalf("empty allowlist exposed models: %#v", got.ModelChannel.AvailableModels)
	}
	if got := publicChannelInfos([]model.ModelChannel{channel}, nil, nil); len(got) != 0 {
		t.Fatalf("empty allowlist exposed channels: %#v", got)
	}
	selected := model.PublicSetting{ModelChannel: model.PublicModelChannelSetting{AvailableModels: []string{"image-1"}}}
	if got := normalizePublicSettingWithChannels(selected, []model.ModelChannel{channel}); !reflect.DeepEqual(got.ModelChannel.AvailableModels, []string{"image-1"}) {
		t.Fatalf("selected models = %#v", got.ModelChannel.AvailableModels)
	}
	channel.APIKey = ""
	if got := normalizePublicSettingWithChannels(selected, []model.ModelChannel{channel}); len(got.ModelChannel.AvailableModels) != 0 {
		t.Fatalf("channel without API key exposed models: %#v", got.ModelChannel.AvailableModels)
	}
}

func TestValidateModelCosts(t *testing.T) {
	if err := validateModelCosts([]model.ModelCost{{Model: "image-1", Credits: 0}, {Model: "video-1", Credits: 0.29}}); err != nil {
		t.Fatalf("valid prices rejected: %v", err)
	}
	for _, costs := range [][]model.ModelCost{
		{{Model: "", Credits: 1}},
		{{Model: "image-1", Credits: -1}},
		{{Model: "image-1", Credits: 0.001}},
		{{Model: "image-1", Credits: math.NaN()}},
		{{Model: "image-1", Credits: math.Inf(1)}},
		{{Model: "image-1", Credits: 1}, {Model: " image-1 ", Credits: 2}},
	} {
		if err := validateModelCosts(costs); err == nil {
			t.Fatalf("invalid prices accepted: %#v", costs)
		}
	}
}

func TestSavedSecretsMatchProviderIdentity(t *testing.T) {
	channels := []model.ModelChannel{{ID: "old", Protocol: "openai", Name: "old", BaseURL: "https://old.example.com", APIKey: "old-key"}}
	if _, found := findSavedChannel(model.ModelChannel{ID: "new", Protocol: "openai", Name: "new", BaseURL: "https://new.example.com"}, channels); found {
		t.Fatal("unrelated model channel inherited an API key")
	}
	if got, found := findSavedChannel(model.ModelChannel{ID: "old", Protocol: "openai"}, channels); !found || got.APIKey != "old-key" {
		t.Fatal("same model channel lost its API key")
	}
	providers := []model.StorageProvider{{ID: "old", Type: model.StorageProviderTypeS3, Bucket: "old", SecretAccessKey: "old-secret"}}
	if _, found := findSavedStorageProvider(model.StorageProvider{ID: "new", Type: model.StorageProviderTypeS3, Bucket: "new"}, providers); found {
		t.Fatal("unrelated R2 provider inherited a secret")
	}
	if got, found := findSavedStorageProvider(model.StorageProvider{ID: "old", Type: model.StorageProviderTypeS3}, providers); !found || got.SecretAccessKey != "old-secret" {
		t.Fatal("same R2 provider lost its secret")
	}
}

func TestFetchAdminChannelModelsParsesOpenAIModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"z-model"},{"id":"a-model"},{"id":""}]}`))
	}))
	defer server.Close()

	models, err := fetchAdminChannelModels(model.ModelChannel{
		BaseURL: server.URL,
		APIKey:  "test-key",
	})
	if err != nil {
		t.Fatalf("fetchAdminChannelModels returned error: %v", err)
	}
	if want := []string{"a-model", "z-model"}; !reflect.DeepEqual(models, want) {
		t.Fatalf("models = %#v, want %#v", models, want)
	}
}

func TestFetchAdminChannelModelsReportsArkPlanModelsUnsupported(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/plan/v3/models" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	_, err := fetchAdminChannelModels(model.ModelChannel{
		Protocol: "ark",
		BaseURL: server.URL + "/api/plan/v3/contents/generations/tasks",
		APIKey:  "test-key",
	})
	if err == nil {
		t.Fatal("expected unsupported /models error")
	}
	if !strings.Contains(err.Error(), "Agent Plan 未提供 OpenAI /models") {
		t.Fatalf("error = %q", err.Error())
	}
}

func TestBuildModelChannelURLNormalizesArkPlanTaskPath(t *testing.T) {
	got := BuildModelChannelURL(model.ModelChannel{BaseURL: "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks?debug=1"}, "/models")
	want := "https://ark.cn-beijing.volces.com/api/plan/v3/models"
	if got != want {
		t.Fatalf("BuildModelChannelURL = %q, want %q", got, want)
	}
}

func TestBuildModelChannelURLZhipuV4(t *testing.T) {
	tests := []struct {
		baseURL string
		path    string
		want    string
	}{
		{"https://open.bigmodel.cn/api/paas/v4", "/chat/completions", "https://open.bigmodel.cn/api/paas/v4/chat/completions"},
		{"https://open.bigmodel.cn/api/paas/v4/", "/models", "https://open.bigmodel.cn/api/paas/v4/models"},
		{"https://open.bigmodel.cn/api/paas/v4", "/images/generations", "https://open.bigmodel.cn/api/paas/v4/images/generations"},
		{"https://ark.cn-beijing.volces.com/api/plan/v3", "/chat/completions", "https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions"},
		{"https://api.openai.com", "/chat/completions", "https://api.openai.com/v1/chat/completions"},
	}
	for _, tt := range tests {
		got := BuildModelChannelURL(model.ModelChannel{BaseURL: tt.baseURL}, tt.path)
		if got != tt.want {
			t.Fatalf("BuildModelChannelURL(%q, %q) = %q, want %q", tt.baseURL, tt.path, got, tt.want)
		}
	}
}
