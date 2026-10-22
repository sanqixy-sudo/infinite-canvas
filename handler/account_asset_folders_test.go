package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAssetFolderAndOrganizationInputBoundaries(t *testing.T) {
	for _, test := range []struct { name string; handler http.HandlerFunc; body string }{
		{"folder unknown identity", SaveUserAssetFolder, `{"name":"目录","userId":"other"}`},
		{"folder wrong type", SaveUserAssetFolder, `{"name":123}`},
		{"folder trailing json", SaveUserAssetFolder, `{"name":"目录"} {}`},
		{"organize forbidden media mutation", OrganizeUserAssets, `{"ids":["asset"],"storageKey":"server:other"}`},
		{"organize wrong ids", OrganizeUserAssets, `{"ids":"asset"}`},
		{"organize wrong folders", OrganizeUserAssets, `{"ids":["asset"],"folderIds":"folder"}`},
		{"organize trailing json", OrganizeUserAssets, `{"ids":["asset"]} {}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			test.handler(response, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(test.body)))
			if response.Header().Get("Cache-Control") != "private, no-store" || !strings.Contains(response.Body.String(), `"code":1`) || strings.Contains(response.Body.String(), "请先登录") { t.Fatalf("invalid request reached service or was cached: %s", response.Body.String()) }
		})
	}
}
