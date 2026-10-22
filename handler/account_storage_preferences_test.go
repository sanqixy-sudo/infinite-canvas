package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestStoragePreferenceRequestValidationAndNoStore(t *testing.T) {
	for _, body := range []string{`{}`, `null`, `{"autoSaveAssetsToCloud":null}`, `{"autoSaveAssetsToCloud":"true"}`, `{"autoSaveAssetsToCloud":1}`, `{"autoSaveAssetsToCloud":true,"userId":"other"}`, `{"autoSaveAssetsToCloud":true} {}`} {
		response := httptest.NewRecorder()
		SaveUserStoragePreferences(response, httptest.NewRequest(http.MethodPost, "/api/v1/storage-preferences", strings.NewReader(body)))
		result := response.Body.String()
		if !strings.Contains(result, `"code":1`) || strings.Contains(result, "请先登录") || !strings.Contains(response.Header().Get("Cache-Control"), "no-store") { t.Fatalf("invalid preference body reached service: %s %s", body, result) }
	}
	for _, body := range []string{`{"autoSaveAssetsToCloud":false}`, `{"autoSaveAssetsToCloud":true}`} {
		response := httptest.NewRecorder()
		SaveUserStoragePreferences(response, httptest.NewRequest(http.MethodPost, "/api/v1/storage-preferences", strings.NewReader(body)))
		if !strings.Contains(response.Body.String(), "请先登录") { t.Fatalf("valid boolean did not reach identity check: %s", response.Body.String()) }
	}
	response := httptest.NewRecorder()
	UserStoragePreferences(response, httptest.NewRequest(http.MethodGet, "/api/v1/storage-preferences", nil))
	if !strings.Contains(response.Header().Get("Cache-Control"), "no-store") { t.Fatal("preference GET could be cached") }
}

func TestAccountAssetBulkOverwriteIsDisabled(t *testing.T) {
	response := httptest.NewRecorder()
	SaveUserAssetData(response, httptest.NewRequest(http.MethodPost, "/api/v1/user-data/assets", strings.NewReader(`{"data":{"assets":[]}}`)))
	if response.Code != http.StatusMethodNotAllowed || !strings.Contains(response.Header().Get("Cache-Control"), "no-store") { t.Fatalf("bulk asset overwrite remained available: %d %s", response.Code, response.Body.String()) }
	response = httptest.NewRecorder()
	SaveUserAssetItem(response, httptest.NewRequest(http.MethodPost, "/api/v1/user-data/assets/item", strings.NewReader(`{"asset":{},"userId":"other"}`)))
	if !strings.Contains(response.Body.String(), "参数格式错误") || !strings.Contains(response.Header().Get("Cache-Control"), "no-store") { t.Fatalf("asset request accepted caller identity: %s", response.Body.String()) }
}
