package service

import (
	"context"
	"encoding/json"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

func CurrentUserCreditLogs(ctx context.Context, q model.Query) (model.AccountCreditLogList, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" || user.Role == model.UserRoleGuest {
		return model.AccountCreditLogList{}, safeMessageError{message: "请先登录"}
	}
	if q.Type != "" && q.Type != string(model.CreditLogTypeAdminAdjust) && q.Type != string(model.CreditLogTypeAIConsume) && q.Type != string(model.CreditLogTypeAIRefund) {
		return model.AccountCreditLogList{}, safeMessageError{message: "流水类型无效"}
	}
	logs, total, err := repository.ListUserCreditLogs(user.ID, q)
	if err != nil {
		return model.AccountCreditLogList{}, err
	}
	result := model.AccountCreditLogList{Items: make([]model.AccountCreditLog, 0, len(logs)), Total: int(total)}
	for _, log := range logs {
		var extra struct {
			Model string `json:"model"`
		}
		_ = json.Unmarshal([]byte(log.Extra), &extra)
		result.Items = append(result.Items, model.AccountCreditLog{ID: log.ID, Type: log.Type, Amount: log.Amount, Balance: log.Balance, RelatedID: log.RelatedID, Model: extra.Model, Remark: log.Remark, CreatedAt: log.CreatedAt})
	}
	return result, nil
}
