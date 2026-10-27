package service

import (
	"context"
	"math"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

func CurrentUserTaskCenter(ctx context.Context, q model.Query, status string) (*model.TaskCenterList, error) {
	userID, err := productionUser(ctx)
	if err != nil {
		return nil, err
	}
	q.Normalize()
	q.PageSize = min(q.PageSize, 50)
	q.Page = min(q.Page, 1000000)
	q.Keyword = strings.TrimSpace(q.Keyword)
	if utf8.RuneCountInString(q.Keyword) > 100 {
		return nil, productionError("搜索内容最多 100 个字")
	}
	if !slices.Contains([]string{"", "image", "video", "audio", "render"}, q.Type) {
		return nil, productionError("任务类型无效")
	}
	if !slices.Contains([]string{"", "all", "active", "attention", "completed", "failed", "cancelled", "unknown"}, status) {
		return nil, productionError("任务状态筛选无效")
	}
	result, err := repository.ListUserTaskCenter(userID, q, status)
	if err != nil {
		return nil, err
	}
	for i := range result.Items {
		prepareTaskCenterItem(&result.Items[i])
	}
	return result, nil
}

func prepareTaskCenterItem(item *model.TaskCenterItem) {
	item.Progress = max(0, min(100, item.Progress))
	active := slices.Contains([]string{"queued", "submitting", "processing", "running", "in_progress"}, item.Status)
	item.CanStop = !item.Archived && !item.Gateway && (active || (item.Kind == "audio" && item.Status == "unknown")) && (item.Source == "canvas" || (item.Kind == "video" && item.Source == "video-workbench") || (item.Kind == "render" && item.Source == "production"))
	for _, value := range []**float64{&item.ReservedCredits, &item.SettledCredits, &item.ChargedCredits, &item.RefundedCredits, &item.NetCredits} {
		if *value != nil && (math.IsNaN(**value) || math.IsInf(**value, 0) || **value < 0) {
			*value = nil
		}
	}
	// Upstream error strings may contain signed URLs or credentials. Expose a classification only.
	raw := strings.ToLower(item.Error)
	item.Error = ""
	if raw != "" && (item.Status == "failed" || item.Status == "unknown") {
		switch {
		case strings.Contains(raw, "timeout"), strings.Contains(raw, "超时"):
			item.Error = "请求超时，请核对原任务状态后再操作"
		case strings.Contains(raw, "余额"), strings.Contains(raw, "quota"), strings.Contains(raw, "insufficient"):
			item.Error = "额度或余额不足，请检查账户与渠道配置"
		case strings.Contains(raw, "storage"), strings.Contains(raw, "空间"), strings.Contains(raw, "存储"):
			item.Error = "素材存储未完成，请检查空间与文件状态"
		case strings.Contains(raw, "moderation"), strings.Contains(raw, "safety"), strings.Contains(raw, "审核"):
			item.Error = "内容审核未通过，请检查输入素材和描述"
		default:
			item.Error = "任务未完成，请返回原入口检查参数或联系管理员"
		}
	}
	if item.Status == "unknown" && item.Error == "" {
		item.Error = "执行结果尚未确认，请先核对原任务，避免重复提交"
	}
}
