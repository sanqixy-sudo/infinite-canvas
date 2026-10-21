package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tigerowo/infinite-canvas/config"
)

func TestStorageReadSessionIsScopedAndHttpOnly(t *testing.T) {
	savedHours := config.Cfg.JWTExpireHours
	config.Cfg.JWTExpireHours = 24
	t.Cleanup(func() { config.Cfg.JWTExpireHours = savedHours })
	request := httptest.NewRequest(http.MethodGet, "https://studio.example.com/api/files/file-1", nil)
	request.Header.Set("Authorization", "Bearer session-token")
	response := httptest.NewRecorder()
	setStorageReadSession(response, request)
	cookies := response.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("cookies = %#v", cookies)
	}
	cookie := cookies[0]
	if cookie.Path != "/api/files" || !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode || cookie.MaxAge != 24*3600 {
		t.Fatalf("unsafe media cookie: %#v", cookie)
	}
	cleared := httptest.NewRecorder()
	ClearStorageSession(cleared, request)
	deleted := cleared.Result().Cookies()[0]
	if deleted.Path != cookie.Path || deleted.Name != cookie.Name || deleted.MaxAge != -1 {
		t.Fatalf("logout did not clear the scoped cookie: %#v", deleted)
	}
}
