package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tigerowo/infinite-canvas/model"
)

func TestCloudModelChannelRequiresAccountAndRejectsPersonalHeader(t *testing.T) {
	for _, test := range []struct {
		user model.AuthUser
		channel string
		message string
	}{
		{user: model.AuthUser{}, message: "请先登录"},
		{user: model.AuthUser{ID: "user", Role: model.UserRoleAdmin}, channel: "personal", message: "仅支持平台云端模型"},
	} {
		if _, _, err := selectAIRequestChannel(test.user, "model", "system", test.channel, true); err == nil || err.Error() != test.message {
			t.Fatalf("unexpected channel policy: %v", err)
		}
	}
	w := httptest.NewRecorder()
	PersonalModelChannelDisabled(w, httptest.NewRequest(http.MethodPost, "/api/ai/direct-request", nil))
	if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "仅支持平台云端模型") {
		t.Fatalf("personal helper endpoint remained available: %d %s", w.Code, w.Body)
	}
}

func TestAutoDLMetadataRejectsCallerSuppliedUpstream(t *testing.T) {
	w := httptest.NewRecorder()
	AutoDLWorkflows(w, httptest.NewRequest(http.MethodPost, "/api/ai/autodl/workflows", strings.NewReader(`{"channelId":"platform","baseUrl":"https://personal.invalid","workflowId":"indextts2-v1"}`)))
	if !strings.Contains(w.Body.String(), "参数格式错误") {
		t.Fatalf("caller-supplied upstream was accepted: %s", w.Body)
	}
}
