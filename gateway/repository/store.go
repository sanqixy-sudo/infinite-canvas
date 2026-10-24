package repository

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"

	"github.com/libtnb/sqlite"
	"github.com/tigerowo/infinite-canvas/gateway/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Store struct { db *gorm.DB }

var ErrModelChanged = errors.New("模型配置已被其他管理员更新，请刷新后重新核对")

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil { return nil, err }
	db, err := gorm.Open(sqlite.Open(path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_txlock=immediate"), &gorm.Config{})
	if err != nil { return nil, err }
	sqlDB, err := db.DB()
	if err != nil { return nil, err }
	sqlDB.SetMaxOpenConns(1)
	if err = db.AutoMigrate(&model.Channel{}, &model.ModelRecord{}, &model.Task{}); err != nil { return nil, err }
	if err = os.Chmod(path, 0600); err != nil { return nil, err }
	return &Store{db: db}, nil
}

func (s *Store) Close() error { db, err := s.db.DB(); if err != nil { return err }; return db.Close() }
func (s *Store) Channels() (rows []model.Channel, err error) { err = s.db.Order("id").Find(&rows).Error; return }
func (s *Store) Channel(id string) (row model.Channel, err error) { err = s.db.First(&row, "id = ?", id).Error; return }
func (s *Store) SaveChannel(row *model.Channel) error { return s.db.Save(row).Error }
func (s *Store) ChannelReferences(id string) (int64, error) {
	var count int64
	err := s.db.Model(&model.ModelRecord{}).Where("channel_id = ?", id).Count(&count).Error
	if err != nil || count > 0 { return count, err }
	err = s.db.Model(&model.Task{}).Where("channel_id = ?", id).Count(&count).Error
	return count, err
}
func (s *Store) DeleteChannel(id string) error { return s.db.Delete(&model.Channel{}, "id = ?", id).Error }
func (s *Store) Models(enabledOnly bool) (rows []model.ModelRecord, err error) {
	q := s.db.Order("id")
	if enabledOnly { q = q.Where("enabled = ?", true) }
	err = q.Find(&rows).Error; return
}
func (s *Store) Model(id string) (row model.ModelRecord, err error) { err = s.db.First(&row, "id = ?", id).Error; return }
func (s *Store) SaveModel(config model.ModelConfig) error {
	data, err := json.Marshal(config); if err != nil { return err }
	return s.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name:"id"}}, DoUpdates: clause.AssignmentColumns([]string{"channel_id", "enabled", "config_json", "updated_at"})}).Create(&model.ModelRecord{ID:config.ID, ChannelID:config.ChannelID, Enabled:config.Enabled, ConfigJSON:string(data)}).Error
}

// A published revision must never be overwritten from another editor's stale snapshot.
func (s *Store) SaveModelIfUnchanged(config model.ModelConfig, expectedJSON string) error {
	data,err:=json.Marshal(config);if err!=nil{return err}
	var result *gorm.DB
	if expectedJSON=="" {
		result=s.db.Clauses(clause.OnConflict{DoNothing:true}).Create(&model.ModelRecord{ID:config.ID,ChannelID:config.ChannelID,Enabled:config.Enabled,ConfigJSON:string(data)})
	}else{
		result=s.db.Model(&model.ModelRecord{}).Where("id = ? AND config_json = ?",config.ID,expectedJSON).Updates(map[string]any{"channel_id":config.ChannelID,"enabled":config.Enabled,"config_json":string(data),"updated_at":time.Now()})
	}
	if result.Error!=nil{return result.Error};if result.RowsAffected!=1{return ErrModelChanged};return nil
}
func (s *Store) DeleteModel(id string) error { return s.db.Delete(&model.ModelRecord{}, "id = ?", id).Error }
func (s *Store) Task(id string) (row model.Task, err error) { err = s.db.First(&row, "id = ?", id).Error; return }
func (s *Store) TaskByRequest(id string) (row model.Task, err error) { err = s.db.First(&row, "request_id = ?", id).Error; return }
func (s *Store) CreateTask(row *model.Task) (bool, error) {
	r := s.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name:"request_id"}}, DoNothing:true}).Create(row)
	return r.RowsAffected == 1, r.Error
}
func (s *Store) SaveTask(row *model.Task) error { return s.db.Save(row).Error }
func (s *Store) ResolveTask(row *model.Task) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&model.Task{}).Where("channel_id = ? AND upstream_id = ? AND id <> ?",row.ChannelID,row.UpstreamID,row.ID).Count(&count).Error; err != nil { return err }
		if count > 0 { return errors.New("该上游任务已关联其他请求，不能重复认领") }
		update := tx.Model(&model.Task{}).Where("id = ? AND status = ?",row.ID,"submission_unknown").Updates(map[string]any{"upstream_id":row.UpstreamID,"status":row.Status,"error":"","next_poll_at":row.NextPollAt})
		if update.Error != nil { return update.Error }
		if update.RowsAffected != 1 { return errors.New("任务状态已变化，请重新查询") }
		return tx.First(row,"id = ?",row.ID).Error
	})
}
func (s *Store) RecoverSubmissions() error {
	return s.db.Model(&model.Task{}).Where("status = ?", "submitting").Updates(map[string]any{"status":"submission_unknown", "billing_status":"pending", "error":"服务在提交期间中断，需管理员核实上游任务；不会自动再次生成"}).Error
}
func (s *Store) DueTasks(now time.Time) (rows []model.Task, err error) {
	err = s.db.Where("upstream_id <> '' AND next_poll_at <= ? AND (status IN ? OR billing_status = ?)", now, []string{"queued","running"}, "pending_usage").Order("next_poll_at").Limit(40).Find(&rows).Error
	return
}
