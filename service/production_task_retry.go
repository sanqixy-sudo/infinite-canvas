package service

import (
	"context"
	"encoding/json"
	"slices"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

type ProductionRetryInput struct {
	WorkspaceID string `json:"workspaceId"`
	RecordID string `json:"recordId"`
	RequestID string `json:"requestId"`
	QuoteID string `json:"quoteId"`
}

// Replays only the frozen application request, never exposes the private gateway snapshot.
func RetryCurrentUserProductionTask(ctx context.Context, input ProductionRetryInput) (map[string]any, error) {
	userID, err := productionUser(ctx); if err != nil { return nil, err }
	if err := productionID(&input.WorkspaceID, "项目", true); err != nil { return nil, err }
	if err := productionID(&input.RequestID, "重试请求", true); err != nil { return nil, err }
	if len(input.RecordID) > 256 || input.RecordID == "" { return nil, productionError("原任务标识无效") }
	record, links, err := repository.GetProductionTaskHistory(userID, input.WorkspaceID, input.RecordID)
	if err != nil { return nil, productionError("原任务不存在或无权访问") }
	// Resolve an accepted retry before quote expiry or the original binding is checked again.
	newID := "gateway_" + gatewayHash([]string{userID, input.RequestID})
	if existing, found, err := repository.GetUserVideoTask(userID, newID); err != nil { return nil, err } else if found {
		if existing.RetryOf != record.RecordID { return nil, productionError("该重试标识属于另一条任务") }
		return map[string]any{"task": VideoTaskResponse(existing), "accepted": true}, nil
	}
	if !productionRetryable(record) { return nil, productionError("仅已明确失败并完成结算的中间件任务可重试，结果未知时不能再次提交") }
	original, found, err := repository.GetUserVideoTask(userID, record.ID)
	if original.TeamApprovalID != "" { return nil, productionError("团队审批任务重试需要重新申请，请从团队项目的生成审批入口发起") }
	if err != nil { return nil, err }; if !found || original.GatewaySnapshot == "" { return nil, productionError("原请求已不可用，请返回画布检查参数后生成") }
	var snapshot gatewayTaskSnapshot
	if json.Unmarshal([]byte(original.GatewaySnapshot), &snapshot) != nil { return nil, productionError("原请求快照不可用") }
	doc, err := CurrentUserProduction(ctx, input.WorkspaceID); if err != nil { return nil, err }
	bound := false
	if doc != nil {
		for _, shot := range doc.Shots {
			if shot.CanvasID == record.CanvasID && shot.VideoNodeID == record.NodeID && slices.ContainsFunc(links, func(link model.ProductionTaskLink) bool { return link.ProjectID == doc.ID && link.ShotID == shot.ID }) { bound = true }
		}
	}
	if !bound { return nil, productionError("原镜头已删除或重新绑定，请回画布确认当前参数") }
	if blocked, err := repository.HasPendingProductionRetry(userID, record.RecordID); err != nil { return nil, err } else if blocked { return nil, productionError("该任务已有重试结果或尚在执行，请查看已提交的重试任务") }
	req := snapshot.Request
	req.RequestID = input.RequestID
	// Use the current capability revision; the current model must still accept every old parameter.
	settings, err := repository.GetSettings(); if err != nil { return nil, err }
	for _, def := range settings.Private.Gateway.Catalog { if def.ID == req.Model { req.Revision = def.Revision } }
	if input.QuoteID == "" {
		quote, err := QuoteGatewayTask(ctx, req); if err != nil { return nil, err }
		quote["requestId"], quote["model"], quote["recordId"], quote["attempt"] = input.RequestID, req.Model, record.RecordID, record.Attempt + 1
		quote["accepted"] = false
		return quote, nil
	}
	result, err := SubmitGatewayTask(ctx, GatewaySubmit{Request: req, QuoteID: input.QuoteID, Source: "canvas", SourceID: record.NodeID, CanvasID: record.CanvasID, retryOf: record.RecordID, attempt: record.Attempt + 1})
	if err != nil { return nil, err }
	return map[string]any{"task": result, "accepted": true}, nil
}
