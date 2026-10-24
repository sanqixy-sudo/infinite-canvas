package service

import (
	"context"
	"math"
	"sort"
	"slices"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

type ProductionTaskQuery struct { Page int; PageSize int; EpisodeID string; Status string }

func CurrentUserProductionTasks(ctx context.Context, workspaceID string, queries ...ProductionTaskQuery) (*model.ProductionTaskList, error) {
	userID, err := productionUser(ctx)
	if err != nil { return nil, err }
	if err := productionID(&workspaceID, "项目", true); err != nil { return nil, err }
	q := ProductionTaskQuery{Page: 1, PageSize: 30, Status: "all"}
	if len(queries) > 0 { q = queries[0] }
	q.Page, q.PageSize = max(1, q.Page), min(100, max(1, q.PageSize))
	if q.Status == "" { q.Status = "all" }
	if !slices.Contains([]string{"all", "running", "failed", "billing"}, q.Status) { return nil, productionError("任务筛选无效") }
	if err := productionID(&q.EpisodeID, "分集", false); err != nil { return nil, err }
	records, links, err := repository.ListProductionTaskHistory(userID, workspaceID, q.EpisodeID)
	if err != nil { return nil, err }
	result := &model.ProductionTaskList{Items: []model.ProductionTask{}, ShotCosts: []model.ProductionShotCost{}, Page: q.Page, PageSize: q.PageSize,
		HistoryScope: "仅记录启用持久任务历史后、已保存镜头绑定上的生成；更早任务不补算。镜头更名、删除、重新绑定后仍保留提交时归属。",
		CostScope: "汇总服务端已关联的扣退流水与最终结算，缺失费用不按免费计算。共用任务在项目/分集总计只算一次；各镜头关联成本不可直接相加。"}
	byRecord := map[string][]model.ProductionTaskLink{}
	for _, link := range links { byRecord[link.RecordID] = append(byRecord[link.RecordID], link) }
	blocked := map[string]bool{}
	parents, err := repository.ListProductionRetryParents(userID, workspaceID)
	if err != nil { return nil, err }
	for _, parent := range parents { blocked[parent] = true }
	approvalIDs, err := repository.ListProductionTeamApprovalTasks(userID, workspaceID)
	if err != nil { return nil, err }
	approvals := map[string]bool{}
	for _, id := range approvalIDs { approvals[id] = true }
	shotCosts := map[string]*model.ProductionShotCost{}
	for _, record := range records {
		addProductionCost(&result.Summary, record)
		item := model.ProductionTask{ProductionTaskRecord: record, WorkspaceID: workspaceID, ShotIDs: []string{}, EpisodeIDs: []string{}, ShotTitles: []string{}}
		for _, link := range byRecord[record.RecordID] {
			item.ShotIDs = append(item.ShotIDs, link.ShotID); item.ShotTitles = append(item.ShotTitles, link.ShotTitle)
			if !slices.Contains(item.EpisodeIDs, link.EpisodeID) { item.EpisodeIDs = append(item.EpisodeIDs, link.EpisodeID) }
			key := link.ProjectID + ":" + link.ShotID
			if shotCosts[key] == nil { shotCosts[key] = &model.ProductionShotCost{ShotID: link.ShotID, EpisodeID: link.EpisodeID, ShotTitle: link.ShotTitle} }
			addProductionCost(&shotCosts[key].ProductionCostSummary, record)
		}
		teamApproval := record.Kind == "video" && approvals[record.ID]
		item.CanRetry = productionRetryable(record) && !blocked[record.RecordID] && !teamApproval
		switch {
		case teamApproval: item.RetryReason = "团队审批任务如需再次生成，请从团队项目重新申请并审批"
		case blocked[record.RecordID]: item.RetryReason = "已有重试任务，请查看该次结果"
		case record.Kind=="audio": item.RetryReason="请在本镜头的配音区查看或重新确认生成；结果未知时先核对原任务"
		case !record.Gateway: item.RetryReason = "该渠道请回到画布检查参数后生成"
		case record.Status == "unknown": item.RetryReason = "结果未知，禁止重复付费提交；请先核对原任务"
		case record.Status != "failed": item.RetryReason = "仅明确失败的任务可重试"
		case record.BillingStatus != "settled" && record.BillingStatus != "released": item.RetryReason = "原任务账务尚未完成，请先等待结算"
		}
		if productionTaskMatches(record, q.Status) { result.Items = append(result.Items, item) }
	}
	for _, cost := range shotCosts { result.ShotCosts = append(result.ShotCosts, *cost) }
	sort.Slice(result.ShotCosts, func(i, j int) bool { return result.ShotCosts[i].ShotID < result.ShotCosts[j].ShotID })
	result.Total = int64(len(result.Items))
	start := min(len(result.Items), (min(q.Page, 1000000)-1)*q.PageSize)
	end := min(len(result.Items), start+q.PageSize)
	result.HasMore = end < len(result.Items)
	result.Items = result.Items[start:end]
	return result, nil
}

func productionRetryable(record model.ProductionTaskRecord) bool {
	return record.Gateway && record.Status == "failed" && (record.BillingStatus == "settled" || record.BillingStatus == "released")
}

func productionTaskMatches(record model.ProductionTaskRecord, status string) bool {
	switch status {
	case "running": return slices.Contains([]string{"queued", "submitting", "processing", "running", "in_progress", "unknown"}, record.Status)
	case "failed": return slices.Contains([]string{"failed", "cancelled", "unknown"}, record.Status)
	case "billing": return record.SettledCredits == nil || slices.Contains([]string{"reserved", "pending_usage", "pending_balance"}, record.BillingStatus)
	default: return true
	}
}

func addProductionCost(summary *model.ProductionCostSummary, record model.ProductionTaskRecord) {
	summary.TaskCount++
	if record.SettledCredits != nil { summary.SettledTaskCount++; summary.SettledCredits += *record.SettledCredits } else {
		if record.ChargedCredits == nil { summary.UnknownTaskCount++ } else { summary.PendingTaskCount++ }
		if record.NetCredits != nil { summary.HeldCredits += *record.NetCredits }
	}
	if record.ChargedCredits != nil { summary.ChargedCredits += *record.ChargedCredits }
	if record.RefundedCredits != nil { summary.RefundedCredits += *record.RefundedCredits }
	summary.SettledCredits = math.Round(summary.SettledCredits*100)/100
	summary.HeldCredits = math.Round(summary.HeldCredits*100)/100
	summary.ChargedCredits = math.Round(summary.ChargedCredits*100)/100
	summary.RefundedCredits = math.Round(summary.RefundedCredits*100)/100
}
