package model

const SettingKeyCommerce SettingKey = "commerce"
const CreditLogTypeRecharge CreditLogType = "recharge"

const (
	CommerceKindCredits    = "credits"
	CommerceKindStorage    = "storage"
	PurchaseOrderPending   = "pending"
	PurchaseOrderCompleted = "completed"
	PurchaseOrderRejected  = "rejected"
	PurchaseOrderCanceled  = "canceled"
)

type CommercePlan struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Kind         string  `json:"kind"`
	PriceCents   int64   `json:"priceCents"`
	Credits      float64 `json:"credits"`
	StorageBytes int64   `json:"storageBytes"`
	Description  string  `json:"description"`
	Enabled      bool    `json:"enabled"`
}

type CommerceSetting struct {
	DefaultStorageBytes int64          `json:"defaultStorageBytes"`
	ContactText         string         `json:"contactText"`
	Instructions        string         `json:"instructions"`
	Plans               []CommercePlan `json:"plans"`
}

type PurchaseOrder struct {
	ID              string  `json:"id" gorm:"primaryKey;size:80"`
	UserID          string  `json:"userId" gorm:"size:80;index;uniqueIndex:idx_purchase_orders_user_request,priority:1"`
	RequestID       string  `json:"requestId" gorm:"size:64;uniqueIndex:idx_purchase_orders_user_request,priority:2"`
	PlanID          string  `json:"planId" gorm:"size:80"`
	PlanName        string  `json:"planName"`
	Kind            string  `json:"kind" gorm:"size:20"`
	PriceCents      int64   `json:"priceCents"`
	Credits         float64 `json:"credits" gorm:"type:decimal(20,2)"`
	StorageBytes    int64   `json:"storageBytes"`
	PaymentMethod   string  `json:"paymentMethod" gorm:"size:20"`
	Status          string  `json:"status" gorm:"size:20;index"`
	ReviewerID      string  `json:"reviewerId"`
	ReviewRemark    string  `json:"reviewRemark"`
	ReviewedAt      string  `json:"reviewedAt"`
	CreatedAt       string  `json:"createdAt" gorm:"index"`
	UpdatedAt       string  `json:"updatedAt"`
	UserDisplayName string  `json:"userDisplayName" gorm:"->;-:migration"`
}

type PurchaseOrderList struct {
	Items []PurchaseOrder `json:"items"`
	Total int             `json:"total"`
}

type CommerceWallet struct {
	Credits  float64         `json:"credits"`
	Storage  StorageUsage    `json:"storage"`
	Commerce CommerceSetting `json:"commerce"`
}
