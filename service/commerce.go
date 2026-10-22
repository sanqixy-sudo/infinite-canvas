package service

import (
	"context"
	"errors"
	"math"
	"strings"
	"unicode/utf8"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"gorm.io/gorm"
)

func AccountCommerceSettings() (model.CommerceSetting, error) {
	setting, found, err := repository.GetCommerceSettings()
	if err != nil {
		return setting, err
	}
	if !found {
		setting.DefaultStorageBytes = 1 << 30
	}
	if setting.Plans == nil {
		setting.Plans = []model.CommercePlan{}
	}
	return setting, nil
}

func AdminCommerceSettings(ctx context.Context) (model.CommerceSetting, error) {
	if _, err := commerceUser(ctx, true); err != nil {
		return model.CommerceSetting{}, err
	}
	return AccountCommerceSettings()
}

func SaveCommerceSettings(ctx context.Context, setting model.CommerceSetting) (model.CommerceSetting, error) {
	if _, err := commerceUser(ctx, true); err != nil {
		return setting, err
	}
	setting, err := validateCommerceSettings(setting)
	if err != nil {
		return setting, err
	}
	return repository.SaveCommerceSettings(setting, now())
}

func validateCommerceSettings(setting model.CommerceSetting) (model.CommerceSetting, error) {
	setting.ContactText, setting.Instructions = strings.TrimSpace(setting.ContactText), strings.TrimSpace(setting.Instructions)
	if setting.DefaultStorageBytes < 0 || setting.DefaultStorageBytes > 1<<50 || utf8.RuneCountInString(setting.ContactText) > 2000 || utf8.RuneCountInString(setting.Instructions) > 6000 || len(setting.Plans) > 100 {
		return setting, safeMessageError{message: "套餐配置超出允许范围"}
	}
	setting.Plans = append([]model.CommercePlan{}, setting.Plans...)
	ids := map[string]bool{}
	for i := range setting.Plans {
		plan := &setting.Plans[i]
		plan.ID, plan.Name, plan.Description = strings.TrimSpace(plan.ID), strings.TrimSpace(plan.Name), strings.TrimSpace(plan.Description)
		if plan.ID == "" {
			plan.ID = newID("plan")
		}
		if !validCommerceID(plan.ID, 80) || ids[plan.ID] || plan.Name == "" || utf8.RuneCountInString(plan.Name) > 80 || utf8.RuneCountInString(plan.Description) > 1000 || plan.PriceCents <= 0 || plan.PriceCents > 100_000_000 {
			return setting, safeMessageError{message: "套餐 ID、名称或金额无效，金额须为正整数分且不超过 100000000 分"}
		}
		ids[plan.ID] = true
		switch plan.Kind {
		case model.CommerceKindCredits:
			if math.IsNaN(plan.Credits) || math.IsInf(plan.Credits, 0) || plan.Credits <= 0 || plan.Credits > 1e9 || math.Abs(plan.Credits*100-math.Round(plan.Credits*100)) > 0.000001 || plan.StorageBytes != 0 {
				return setting, safeMessageError{message: "算力套餐须配置正数算力点，最多两位小数且不超过十亿点，不能同时增加存储"}
			}
			plan.Credits = normalizeCredits(plan.Credits)
		case model.CommerceKindStorage:
			if plan.StorageBytes <= 0 || plan.StorageBytes > 1<<50 || plan.Credits != 0 {
				return setting, safeMessageError{message: "存储套餐须配置正整数容量且不超过 1 PiB，不能同时增加算力点"}
			}
		default:
			return setting, safeMessageError{message: "套餐类型只能为算力或存储"}
		}
	}
	return setting, nil
}

func CurrentUserWallet(ctx context.Context) (model.CommerceWallet, error) {
	account, err := commerceUser(ctx, false)
	if err != nil {
		return model.CommerceWallet{}, err
	}
	user, found, err := repository.GetUserByID(account.ID)
	if err != nil {
		return model.CommerceWallet{}, err
	}
	if !found {
		return model.CommerceWallet{}, safeMessageError{message: "用户不存在"}
	}
	usage, err := CurrentUserStorageUsage(ctx)
	if err != nil {
		return model.CommerceWallet{}, err
	}
	setting, err := AccountCommerceSettings()
	if err != nil {
		return model.CommerceWallet{}, err
	}
	plans := []model.CommercePlan{}
	for _, plan := range setting.Plans {
		if plan.Enabled {
			plans = append(plans, plan)
		}
	}
	setting.Plans = plans
	return model.CommerceWallet{Credits: user.Credits, Storage: usage, Commerce: setting}, nil
}

func ListCurrentUserPurchaseOrders(ctx context.Context, q model.Query) (model.PurchaseOrderList, error) {
	user, err := commerceUser(ctx, false)
	if err != nil {
		return model.PurchaseOrderList{}, err
	}
	return listPurchaseOrders(user.ID, q)
}

func ListPurchaseOrders(ctx context.Context, q model.Query) (model.PurchaseOrderList, error) {
	if _, err := commerceUser(ctx, true); err != nil {
		return model.PurchaseOrderList{}, err
	}
	return listPurchaseOrders("", q)
}

func listPurchaseOrders(userID string, q model.Query) (model.PurchaseOrderList, error) {
	items, total, err := repository.ListPurchaseOrders(userID, q)
	return model.PurchaseOrderList{Items: items, Total: int(total)}, err
}

func CreateCurrentUserPurchaseOrder(ctx context.Context, planID, requestID string) (model.PurchaseOrder, error) {
	user, err := commerceUser(ctx, false)
	if err != nil {
		return model.PurchaseOrder{}, err
	}
	planID, requestID = strings.TrimSpace(planID), strings.TrimSpace(requestID)
	if !validCommerceID(planID, 80) || !validCommerceID(requestID, 64) {
		return model.PurchaseOrder{}, safeMessageError{message: "请选择有效套餐并提供有效请求编号"}
	}
	if existing, found, err := repository.PurchaseOrderForRequest(user.ID, requestID); err != nil {
		return existing, err
	} else if found {
		if existing.PlanID != planID {
			return model.PurchaseOrder{}, safeMessageError{message: "该请求编号已用于其他套餐，请刷新后重试"}
		}
		return existing, nil
	}
	setting, err := AccountCommerceSettings()
	if err != nil {
		return model.PurchaseOrder{}, err
	}
	var selected *model.CommercePlan
	for i := range setting.Plans {
		if setting.Plans[i].ID == planID && setting.Plans[i].Enabled {
			selected = &setting.Plans[i]
			break
		}
	}
	if selected == nil {
		return model.PurchaseOrder{}, safeMessageError{message: "套餐已停用或不存在，请刷新后选择"}
	}
	if _, err := validateCommerceSettings(model.CommerceSetting{Plans: []model.CommercePlan{*selected}}); err != nil {
		return model.PurchaseOrder{}, err
	}
	timestamp := now()
	order := model.PurchaseOrder{ID: newID("order"), UserID: user.ID, RequestID: requestID, PlanID: selected.ID, PlanName: selected.Name, Kind: selected.Kind, PriceCents: selected.PriceCents, Credits: selected.Credits, StorageBytes: selected.StorageBytes, PaymentMethod: "manual", Status: model.PurchaseOrderPending, CreatedAt: timestamp, UpdatedAt: timestamp}
	order, err = repository.CreatePurchaseOrder(order)
	if err == nil && order.PlanID != planID {
		return model.PurchaseOrder{}, safeMessageError{message: "该请求编号已用于其他套餐，请刷新后重试"}
	}
	return order, commerceOrderError(err)
}

func CancelCurrentUserPurchaseOrder(ctx context.Context, id string) (model.PurchaseOrder, error) {
	user, err := commerceUser(ctx, false)
	if err != nil {
		return model.PurchaseOrder{}, err
	}
	order, err := repository.ChangePurchaseOrder(strings.TrimSpace(id), user.ID, model.PurchaseOrderCanceled, "", "", now(), "")
	return order, commerceOrderError(err)
}

func ReviewPurchaseOrder(ctx context.Context, id, action, remark string) (model.PurchaseOrder, error) {
	admin, err := commerceUser(ctx, true)
	if err != nil {
		return model.PurchaseOrder{}, err
	}
	remark = strings.TrimSpace(remark)
	if remark == "" || utf8.RuneCountInString(remark) > 1000 {
		return model.PurchaseOrder{}, safeMessageError{message: "请填写审核备注，最多 1000 字"}
	}
	status := model.PurchaseOrderCompleted
	if action == "reject" {
		status = model.PurchaseOrderRejected
	} else if action != "complete" {
		return model.PurchaseOrder{}, safeMessageError{message: "审核操作无效"}
	}
	order, err := repository.ChangePurchaseOrder(strings.TrimSpace(id), "", status, admin.ID, remark, now(), newID("credit"))
	return order, commerceOrderError(err)
}

func commerceUser(ctx context.Context, admin bool) (model.AuthUser, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" || user.Role == model.UserRoleGuest {
		return model.AuthUser{}, safeMessageError{message: "请先登录"}
	}
	if admin && user.Role != model.UserRoleAdmin {
		return model.AuthUser{}, safeMessageError{message: "需要管理员权限"}
	}
	return user, nil
}

func commerceOrderError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return safeMessageError{message: "订单或用户不存在"}
	}
	if errors.Is(err, repository.ErrPurchaseOrderState) {
		return safeMessageError{message: "订单状态已改变，无法执行此操作，请刷新后重试"}
	}
	if errors.Is(err, repository.ErrPurchaseOrderLimit) {
		return safeMessageError{message: "账户算力或存储余额已达到上限，请联系管理员"}
	}
	if errors.Is(err, repository.ErrPendingPurchaseOrderLimit) {
		return safeMessageError{message: "待审核订单已达 20 笔，请先取消不需要的订单或联系管理员处理"}
	}
	return err
}

func validCommerceID(value string, max int) bool {
	if value == "" || len(value) > max {
		return false
	}
	for _, char := range value {
		if char != '-' && char != '_' && (char < 'a' || char > 'z') && (char < 'A' || char > 'Z') && (char < '0' || char > '9') {
			return false
		}
	}
	return true
}
