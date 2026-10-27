package service

import (
	"context"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"strings"
	"unicode/utf8"
)

func normalizeProductionList(q *model.Query) error {
	q.Normalize()
	if q.PageSize > 50 {
		q.PageSize = 50
	}
	q.Keyword = strings.TrimSpace(q.Keyword)
	if q.Page > 100000 || utf8.RuneCountInString(q.Keyword) > 100 {
		return productionError("查询范围过大，请缩短关键词或重新选择页码")
	}
	return nil
}

func CurrentUserProductionOverview(ctx context.Context, q model.Query) (model.ProductionOverviewList, error) {
	userID, err := productionUser(ctx)
	if err != nil {
		return model.ProductionOverviewList{}, err
	}
	if err := normalizeProductionList(&q); err != nil {
		return model.ProductionOverviewList{}, err
	}
	return repository.ListUserProductionOverview(userID, q)
}

func CurrentUserProductionDeliveries(ctx context.Context, q model.Query, workspaceID string) (model.ProductionDeliveryList, error) {
	userID, err := productionUser(ctx)
	if err != nil {
		return model.ProductionDeliveryList{}, err
	}
	if err := normalizeProductionList(&q); err != nil {
		return model.ProductionDeliveryList{}, err
	}
	if err := productionID(&workspaceID, "项目", false); err != nil {
		return model.ProductionDeliveryList{}, err
	}
	switch q.Type {
	case "", "queued", "running", "completed", "failed", "cancelled":
	default:
		return model.ProductionDeliveryList{}, productionError("成片状态无效")
	}
	return repository.ListUserProductionDeliveries(userID, q, workspaceID)
}
