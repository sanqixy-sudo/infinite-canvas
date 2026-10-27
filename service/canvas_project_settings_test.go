package service

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCanvasWorkspaceSettingsSelectors(t *testing.T) {
	project := func(settings string) json.RawMessage {
		return json.RawMessage(`{"id":"root","createdAt":"now","updatedAt":"now","workspaceSettings":` + settings + `}`)
	}
	valid := []string{`{}`, `null`, `{"defaultModels":{"video":{"model":"seedance-fixed-portrait","channelId":"published"}},"cover":{"canvasId":"child","nodeId":"image"}}`}
	for _, input := range valid {
		raw := project(input)
		saved, err := canvasProjectFromRaw("owner", raw)
		if err != nil || saved.UserID != "owner" || saved.ProjectData != string(raw) {
			t.Fatalf("selectors must retain exact model/channel without copying media: %s %v", input, err)
		}
	}
	invalid := []string{
		`{"defaultModels":{"unknown":{"model":"m","channelId":"c"}}}`,
		`{"defaultModels":{"video":{"model":"m","channelId":""}}}`,
		`{"defaultModels":{"video":{"model":"m","channelId":"c","apiKey":"secret"}}}`,
		`{"defaultModels":{"video":{"model":"` + strings.Repeat("x", 257) + `","channelId":"c"}}}`,
		`{"cover":{"canvasId":"child"}}`,
		`{"cover":{"canvasId":"child","nodeId":"node","url":"https://external.example/private.png"}}`,
		`{"baseUrl":"https://external.example"}`, `[]`,
	}
	for _, input := range invalid {
		if _, err := canvasProjectFromRaw("owner", project(input)); err == nil {
			t.Errorf("accepted invalid settings: %s", input)
		}
	}
	if err := validateCanvasWorkspaceSettings(json.RawMessage(`{"workspaceId":"root","workspaceSettings":{"defaultModels":{}}}`)); err == nil {
		t.Error("child canvas cannot redefine project settings")
	}
	if err := validateCanvasWorkspaceSettings(json.RawMessage(`{"workspaceId":"root"}`)); err != nil {
		t.Fatal(err)
	}
}
