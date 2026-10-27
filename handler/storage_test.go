package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/service"
)

func TestStorageReadSessionIsScopedAndHttpOnly(t *testing.T) {
	savedHours := config.Cfg.JWTExpireHours
	savedSecret := config.Cfg.JWTSecret
	config.Cfg.JWTExpireHours = 24
	config.Cfg.JWTSecret = "storage-read-test"
	t.Cleanup(func() { config.Cfg.JWTExpireHours = savedHours; config.Cfg.JWTSecret = savedSecret })
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, service.TokenClaims{UserID: "owner", RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(time.Now().Add(30 * time.Minute))}}).SignedString([]byte(config.Cfg.JWTSecret))
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "https://studio.example.com/api/files/file-1", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	setStorageReadSession(response, request)
	cookies := response.Result().Cookies()
	if len(cookies) != 2 {
		t.Fatalf("cookies = %#v", cookies)
	}
	cookie := cookies[1]
	if cookies[0].Path != "/api/files" || cookies[0].MaxAge != -1 || cookie.Path != "/api" || !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode || cookie.MaxAge > 30*60 || cookie.MaxAge < 29*60 {
		t.Fatalf("unsafe media cookie: %#v", cookie)
	}
	cleared := httptest.NewRecorder()
	ClearStorageSession(cleared, request)
	deleted := cleared.Result().Cookies()[1]
	if deleted.Path != cookie.Path || deleted.Name != cookie.Name || deleted.MaxAge != -1 {
		t.Fatalf("logout did not clear the scoped cookie: %#v", deleted)
	}
}
