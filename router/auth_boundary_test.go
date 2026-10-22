package router

import (
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"github.com/tigerowo/infinite-canvas/service"
)

func TestPublicAndAuthenticatedAPIBoundary(t *testing.T) {
	const marker = "AUTH_BOUNDARY_CHILD"
	if os.Getenv(marker) != "1" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestPublicAndAuthenticatedAPIBoundary$", "-test.timeout=30s")
		cmd.Env = append(os.Environ(), marker+"=1")
		if output, err := cmd.CombinedOutput(); err != nil { t.Fatalf("isolated auth boundary: %v\n%s", err, output) }
		return
	}
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:", JWTSecret: "auth-boundary-test", JWTExpireHours: 24, AILogDir: t.TempDir()}
	db, err := repository.DB()
	if err != nil { t.Fatal(err) }
	if err := db.Create(&model.User{ID: "ordinary", Username: "ordinary", AffCode: "ordinary", Role: model.UserRoleUser, Status: model.UserStatusActive}).Error; err != nil { t.Fatal(err) }
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, service.TokenClaims{UserID: "ordinary", Role: model.UserRoleUser, RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}}).SignedString([]byte(config.Cfg.JWTSecret))
	if err != nil { t.Fatal(err) }
	router := New()
	for _, test := range []struct { method, path string }{
		{http.MethodGet, "/api/assets"}, {http.MethodGet, "/api/assets/example"}, {http.MethodGet, "/api/prompts"}, {http.MethodGet, "/api/agent-skills"}, {http.MethodGet, "/api/agent-skills/example/file"}, {http.MethodGet, "/api/proxy-image?url=https://example.invalid/image.png"},
		{http.MethodPost, "/api/anonymous/files/session"}, {http.MethodPost, "/api/anonymous/files"}, {http.MethodDelete, "/api/anonymous/files/example"}, {http.MethodPost, "/api/files/session"}, {http.MethodPost, "/api/v1/images/generations"}, {http.MethodGet, "/api/v1/canvas/projects"},
	} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(test.method, test.path, nil))
		if response.Code != http.StatusUnauthorized { t.Fatalf("anonymous %s %s = %d", test.method, test.path, response.Code) }
	}
	for _, test := range []struct { method, path, bearer string; cookie bool; status int }{
		{http.MethodGet, "/api/health", "", false, 200},
		{http.MethodGet, "/api/assets", "", true, 200},
		{http.MethodGet, "/api/assets", "invalid", true, 401},
		{http.MethodPost, "/api/v1/files", "", true, 401},
		{http.MethodPost, "/api/files/session", "", true, 401},
		{http.MethodPost, "/api/files/session", token, false, 200},
		{http.MethodGet, "/api/admin/users", token, false, 403},
		{http.MethodGet, "/api/auth/me", token, false, 200},
	} {
		request := httptest.NewRequest(test.method, test.path, nil)
		if test.bearer != "" { request.Header.Set("Authorization", "Bearer "+test.bearer) }
		if test.cookie { request.AddCookie(&http.Cookie{Name: "xiaomeng_storage_viewer", Value: token}) }
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != test.status { t.Fatalf("%s %s = %d, want %d: %s", test.method, test.path, response.Code, test.status, response.Body.String()) }
		if test.path == "/api/auth/me" && len(response.Result().Cookies()) != 0 { t.Fatal("me response must not race a newer media session cookie") }
	}
}
