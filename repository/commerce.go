package repository

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrPurchaseOrderState = errors.New("purchase order state conflict")
var ErrPurchaseOrderLimit = errors.New("purchase order account limit exceeded")
var ErrPendingPurchaseOrderLimit = errors.New("pending purchase order limit exceeded")
var ErrCommercePlanChanged = errors.New("commerce plan changed before confirmation")

func GetCommerceSettings() (model.CommerceSetting, bool, error) {
	db, err := DB()
	if err != nil {
		return model.CommerceSetting{}, false, err
	}
	var setting model.Setting
	err = db.Where("key = ?", model.SettingKeyCommerce).First(&setting).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.CommerceSetting{}, false, nil
	}
	if err != nil {
		return model.CommerceSetting{}, false, err
	}
	var value model.CommerceSetting
	err = json.Unmarshal(setting.Value, &value)
	return value, true, err
}

func SaveCommerceSettings(value model.CommerceSetting, timestamp string) (model.CommerceSetting, error) {
	db, err := DB()
	if err != nil {
		return value, err
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return value, err
	}
	setting := model.Setting{Key: model.SettingKeyCommerce, Value: encoded, CreatedAt: timestamp, UpdatedAt: timestamp}
	err = db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "key"}}, DoUpdates: clause.AssignmentColumns([]string{"value", "updated_at"})}).Create(&setting).Error
	return value, err
}

func PurchaseOrderForRequest(userID, requestID string) (model.PurchaseOrder, bool, error) {
	db, err := DB()
	if err != nil {
		return model.PurchaseOrder{}, false, err
	}
	var order model.PurchaseOrder
	err = db.Where("user_id = ? AND request_id = ?", userID, requestID).First(&order).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return order, false, nil
	}
	return order, err == nil, err
}

func CreatePurchaseOrder(order model.PurchaseOrder, confirmedPlan model.CommercePlan) (model.PurchaseOrder, error) {
	db, err := DB()
	if err != nil {
		return order, err
	}
	return createPurchaseOrder(db, order, confirmedPlan)
}

func createPurchaseOrder(db *gorm.DB, order model.PurchaseOrder, confirmedPlans ...model.CommercePlan) (model.PurchaseOrder, error) {
	err := db.Transaction(func(tx *gorm.DB) error {
		var user model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, "id = ?", order.UserID).Error; err != nil {
			return err
		}
		var existing model.PurchaseOrder
		err := tx.Where("user_id = ? AND request_id = ?", order.UserID, order.RequestID).First(&existing).Error
		if err == nil {
			order = existing
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if len(confirmedPlans) > 0 {
			var row model.Setting
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, "key = ?", model.SettingKeyCommerce).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrCommercePlanChanged
				}
				return err
			}
			var setting model.CommerceSetting
			if err := json.Unmarshal(row.Value, &setting); err != nil {
				return err
			}
			matched := false
			for _, plan := range setting.Plans {
				if plan.ID == order.PlanID && plan.Enabled && plan == confirmedPlans[0] {
					matched = true
					break
				}
			}
			if !matched {
				return ErrCommercePlanChanged
			}
		}
		var pending int64
		if err := tx.Model(&model.PurchaseOrder{}).Where("user_id = ? AND status = ?", order.UserID, model.PurchaseOrderPending).Count(&pending).Error; err != nil {
			return err
		}
		if pending >= 20 {
			return ErrPendingPurchaseOrderLimit
		}
		return tx.Create(&order).Error
	})
	return order, err
}

func ListPurchaseOrders(userID string, q model.Query) ([]model.PurchaseOrder, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Model(&model.PurchaseOrder{}).Joins("LEFT JOIN users ON users.id = purchase_orders.user_id")
	if userID != "" {
		tx = tx.Where("purchase_orders.user_id = ?", userID)
	}
	if q.Type != "" {
		tx = tx.Where("purchase_orders.status = ?", q.Type)
	}
	if q.Category != "" {
		tx = tx.Where("purchase_orders.kind = ?", q.Category)
	}
	if keyword := strings.TrimSpace(q.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		tx = tx.Where("(purchase_orders.id LIKE ? OR purchase_orders.plan_name LIKE ? OR users.username LIKE ? OR users.display_name LIKE ?)", like, like, like, like)
	}
	if q.Date != "" {
		tx = tx.Where("SUBSTR(purchase_orders.created_at, 1, 10) = ?", q.Date)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := []model.PurchaseOrder{}
	err = tx.Select("purchase_orders.*, COALESCE(NULLIF(users.display_name, ''), users.username) AS user_display_name").Order("purchase_orders.created_at desc, purchase_orders.id desc").Offset(q.Offset()).Limit(q.PageSize).Find(&items).Error
	return items, total, err
}

func ChangePurchaseOrder(id, userID, status, reviewerID, remark, timestamp, creditLogID string) (model.PurchaseOrder, error) {
	db, err := DB()
	if err != nil {
		return model.PurchaseOrder{}, err
	}
	return changePurchaseOrder(db, id, userID, status, reviewerID, remark, timestamp, creditLogID)
}

func changePurchaseOrder(db *gorm.DB, id, userID, status, reviewerID, remark, timestamp, creditLogID string) (model.PurchaseOrder, error) {
	var order model.PurchaseOrder
	err := db.Transaction(func(tx *gorm.DB) error {
		query := tx.Where("id = ?", id)
		if userID != "" {
			query = query.Where("user_id = ?", userID)
		}
		if err := query.First(&order).Error; err != nil {
			return err
		}
		var user model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, "id = ?", order.UserID).Error; err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&order, "id = ?", id).Error; err != nil {
			return err
		}
		if order.Status == status {
			return nil
		}
		if order.Status != model.PurchaseOrderPending {
			return ErrPurchaseOrderState
		}
		patch := map[string]any{"status": status, "updated_at": timestamp}
		if status != model.PurchaseOrderCanceled {
			patch["reviewer_id"], patch["review_remark"], patch["reviewed_at"] = reviewerID, remark, timestamp
		}
		changed := tx.Model(&model.PurchaseOrder{}).Where("id = ? AND status = ?", id, model.PurchaseOrderPending).Updates(patch)
		if changed.Error != nil {
			return changed.Error
		}
		if changed.RowsAffected != 1 {
			return ErrPurchaseOrderState
		}
		if status == model.PurchaseOrderCompleted {
			var update *gorm.DB
			switch order.Kind {
			case model.CommerceKindCredits:
				update = tx.Model(&model.User{}).Where("id = ? AND credits <= CAST(? AS DECIMAL(20,2))", user.ID, 1e12-order.Credits).Updates(map[string]any{"credits": gorm.Expr("ROUND(credits + CAST(? AS DECIMAL(20,2)), 2)", order.Credits), "updated_at": timestamp})
			case model.CommerceKindStorage:
				update = tx.Model(&model.User{}).Where("id = ? AND storage_extra_bytes <= ?", user.ID, int64(1<<50)-order.StorageBytes).Updates(map[string]any{"storage_extra_bytes": gorm.Expr("storage_extra_bytes + ?", order.StorageBytes), "updated_at": timestamp})
			default:
				return ErrPurchaseOrderState
			}
			if update.Error != nil {
				return update.Error
			}
			if update.RowsAffected != 1 {
				return ErrPurchaseOrderLimit
			}
			if order.Kind == model.CommerceKindCredits {
				if err := tx.First(&user, "id = ?", order.UserID).Error; err != nil {
					return err
				}
				log := model.CreditLog{ID: creditLogID, UserID: user.ID, Type: model.CreditLogTypeRecharge, Amount: order.Credits, Balance: user.Credits, RelatedID: order.ID, Remark: "人工收款确认 · " + order.PlanName + "：" + remark, CreatedAt: timestamp}
				if err := tx.Create(&log).Error; err != nil {
					return err
				}
			}
		}
		return tx.First(&order, "id = ?", id).Error
	})
	return order, err
}
