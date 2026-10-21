package repository

import (
	"errors"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ListUsers 分页查询用户。
func ListUsers(q model.Query) ([]model.User, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Model(&model.User{})
	if keyword := strings.TrimSpace(q.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		tx = tx.Where("username LIKE ? OR display_name LIKE ? OR email LIKE ? OR linux_do_id LIKE ?", like, like, like, like)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var users []model.User
	err = tx.Order("created_at desc").Offset(q.Offset()).Limit(q.PageSize).Find(&users).Error
	return users, total, err
}

// CountUsers 返回用户总数。
func CountUsers() (int64, error) {
	db, err := DB()
	if err != nil {
		return 0, err
	}
	var total int64
	return total, db.Model(&model.User{}).Count(&total).Error
}

// HasAdmin 判断系统中是否存在管理员。
func HasAdmin() (bool, error) {
	db, err := DB()
	if err != nil {
		return false, err
	}
	var total int64
	err = db.Model(&model.User{}).Where("role = ?", model.UserRoleAdmin).Count(&total).Error
	return total > 0, err
}

// GetUserByID 根据 ID 查询用户。
func GetUserByID(id string) (model.User, bool, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, false, err
	}
	return findUser(db, "id = ?", id)
}

// GetUserByUsername 根据用户名查询用户。
func GetUserByUsername(username string) (model.User, bool, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, false, err
	}
	return findUser(db, "username = ?", username)
}

// SaveUser 保存用户信息。
func SaveUser(user model.User) (model.User, error) {
	db, err := DB()
	if err != nil {
		return user, err
	}
	return user, db.Save(&user).Error
}

// AdjustUserCredits 在同一事务中更新余额并记录管理员调整流水。
func AdjustUserCredits(id string, credits float64, timestamp string, log model.CreditLog) (model.User, bool, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, false, err
	}
	var user model.User
	found := false
	err = db.Transaction(func(tx *gorm.DB) error {
		result := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).First(&user)
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil
		}
		if result.Error != nil {
			return result.Error
		}
		found = true
		if user.Credits == credits {
			return nil
		}
		log.Amount = credits - user.Credits
		log.Balance = credits
		if err := tx.Model(&user).Updates(map[string]any{"credits": credits, "updated_at": timestamp}).Error; err != nil {
			return err
		}
		user.Credits = credits
		user.UpdatedAt = timestamp
		return tx.Create(&log).Error
	})
	return user, found, err
}

func ConsumeUserCredits(id string, credits float64, now string, log model.CreditLog, task any) (model.User, bool, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, false, err
	}
	if credits <= 0 {
		user, ok, err := GetUserByID(id)
		return user, ok, err
	}
	var user model.User
	consumed := false
	err = db.Transaction(func(tx *gorm.DB) error {
		update := tx.Model(&model.User{}).Where("id = ? AND credits >= CAST(? AS DECIMAL(20,2))", id, credits).Updates(map[string]any{
			"credits":    gorm.Expr("ROUND(credits - CAST(? AS DECIMAL(20,2)), 2)", credits),
			"updated_at": now,
		})
		if update.Error != nil || update.RowsAffected == 0 {
			return update.Error
		}
		current, found, err := findUser(tx, "id = ?", id)
		if err != nil {
			return err
		}
		if !found {
			return gorm.ErrRecordNotFound
		}
		user, consumed = current, true
		log.Balance = user.Credits
		if err := tx.Save(&log).Error; err != nil {
			return err
		}
		if task != nil {
			return tx.Create(task).Error
		}
		return nil
	})
	return user, consumed, err
}

func RefundUserCredits(id string, credits float64, now string, log model.CreditLog) (model.User, bool, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, false, err
	}
	return refundUserCreditsWithLog(db, id, credits, now, log)
}

func refundUserCreditsWithLog(db *gorm.DB, id string, credits float64, now string, log model.CreditLog) (model.User, bool, error) {
	if credits <= 0 {
		return findUser(db, "id = ?", id)
	}
	var user model.User
	var found bool
	err := db.Transaction(func(tx *gorm.DB) error {
		var refundErr error
		user, found, refundErr = refundUserCredits(tx, id, credits, now)
		if refundErr != nil || !found {
			return refundErr
		}
		log.Balance = user.Credits
		return tx.Create(&log).Error
	})
	return user, found, err
}

func refundUserCredits(db *gorm.DB, id string, credits float64, now string) (model.User, bool, error) {
	if credits <= 0 {
		return findUser(db, "id = ?", id)
	}
	tx := db.Model(&model.User{}).Where("id = ?", id).Updates(map[string]any{
		"credits":    gorm.Expr("ROUND(credits + CAST(? AS DECIMAL(20,2)), 2)", credits),
		"updated_at": now,
	})
	if tx.Error != nil {
		return model.User{}, false, tx.Error
	}
	user, ok, err := findUser(db, "id = ?", id)
	return user, ok && tx.RowsAffected > 0, err
}

// SaveCreditLog 保存算力点变更流水。
func SaveCreditLog(log model.CreditLog) (model.CreditLog, error) {
	db, err := DB()
	if err != nil {
		return log, err
	}
	return log, db.Save(&log).Error
}

func ListCreditLogs(q model.Query) ([]model.CreditLog, int64, error) {
	return listCreditLogs(q, "")
}

func ListUserCreditLogs(userID string, q model.Query) ([]model.CreditLog, int64, error) {
	return listCreditLogs(q, userID)
}

func listCreditLogs(q model.Query, userID string) ([]model.CreditLog, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Model(&model.CreditLog{}).Joins("LEFT JOIN users ON users.id = credit_logs.user_id")
	if userID != "" {
		tx = tx.Where("credit_logs.user_id = ?", userID)
	}
	if q.Type != "" {
		tx = tx.Where("credit_logs.type = ?", q.Type)
	}
	if keyword := strings.TrimSpace(q.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		tx = tx.Where("(credit_logs.user_id LIKE ? OR credit_logs.type LIKE ? OR remark LIKE ? OR related_id LIKE ? OR users.username LIKE ? OR users.display_name LIKE ?)", like, like, like, like, like, like)
	}
	if q.Date != "" {
		tx = tx.Where("SUBSTR(credit_logs.created_at, 1, 10) = ?", q.Date)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var logs []model.CreditLog
	order := "credit_logs.created_at desc"
	if db.Dialector.Name() == "sqlite" {
		order += ", credit_logs.rowid desc"
	}
	err = tx.Select("credit_logs.*, COALESCE(NULLIF(users.display_name, ''), users.username) AS user_display_name").Order(order).Offset(q.Offset()).Limit(q.PageSize).Find(&logs).Error
	return logs, total, err
}

func DeleteCreditLog(id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Delete(&model.CreditLog{}, "id = ?", id).Error
}

// DeleteUser 删除指定用户。
func DeleteUser(id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Delete(&model.User{}, "id = ?", id).Error
}

// GetUserByLinuxDoID 根据 Linux.do ID 查询用户。
func GetUserByLinuxDoID(id string) (model.User, bool, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, false, err
	}
	return findUser(db, "linux_do_id = ?", id)
}

// findUser 查询单个用户，并将未命中转换为 ok=false。
func findUser(db *gorm.DB, query string, args ...any) (model.User, bool, error) {
	user := model.User{}
	err := db.Where(query, args...).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.User{}, false, nil
	}
	return user, err == nil, err
}
