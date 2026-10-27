package service

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"
)

// Project JSON stores only selectors. Channel authorization remains enforced at generation.
func validateCanvasWorkspaceSettings(raw json.RawMessage) error {
	var project struct {
		WorkspaceID string          `json:"workspaceId"`
		Settings    json.RawMessage `json:"workspaceSettings"`
	}
	if err := json.Unmarshal(raw, &project); err != nil {
		return errors.New("画布项目设置无效")
	}
	if len(project.Settings) == 0 || bytes.Equal(bytes.TrimSpace(project.Settings), []byte("null")) {
		return nil
	}
	if strings.TrimSpace(project.WorkspaceID) != "" {
		return errors.New("项目设置只能保存在项目的首张画布中")
	}
	var settings struct {
		DefaultModels map[string]struct {
			Model     string `json:"model"`
			ChannelID string `json:"channelId"`
		} `json:"defaultModels"`
		Cover *struct {
			CanvasID string `json:"canvasId"`
			NodeID   string `json:"nodeId"`
		} `json:"cover"`
	}
	decoder := json.NewDecoder(bytes.NewReader(project.Settings))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&settings); err != nil {
		return errors.New("项目设置仅允许默认模型与封面引用")
	}
	validID := func(value string) bool {
		return strings.TrimSpace(value) == value && value != "" && utf8.RuneCountInString(value) <= 256
	}
	for capability, selection := range settings.DefaultModels {
		if capability != "text" && capability != "image" && capability != "video" && capability != "audio" {
			return errors.New("项目默认模型类型无效")
		}
		if !validID(selection.Model) || !validID(selection.ChannelID) {
			return errors.New("项目默认模型或渠道编号无效")
		}
	}
	if settings.Cover != nil && (!validID(settings.Cover.CanvasID) || !validID(settings.Cover.NodeID)) {
		return errors.New("项目封面引用无效")
	}
	return nil
}
