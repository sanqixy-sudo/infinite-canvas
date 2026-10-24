package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

func CurrentUserWallet(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	result, err := service.CurrentUserWallet(r.Context())
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func UserPurchaseOrders(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	result, err := service.ListCurrentUserPurchaseOrders(r.Context(), purchaseOrderQuery(r))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func CreateUserPurchaseOrder(w http.ResponseWriter, r *http.Request) {
	var request struct {
		PlanID       string `json:"planId"`
		RequestID    string `json:"requestId"`
		Confirmation string `json:"confirmation"`
	}
	if !decodeCommerceBody(w, r, &request) {
		return
	}
	result, err := service.CreateCurrentUserPurchaseOrder(r.Context(), request.PlanID, request.RequestID, request.Confirmation)
	if err != nil {
		if errors.Is(err, service.ErrCommercePlanChanged) {
			FailWithStatus(w, http.StatusConflict, service.ErrCommercePlanChanged.SafeMessage())
			return
		}
		FailError(w, err)
		return
	}
	OK(w, result)
}

func CancelUserPurchaseOrder(w http.ResponseWriter, r *http.Request, id string) {
	result, err := service.CancelCurrentUserPurchaseOrder(r.Context(), id)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func AdminCommerceSettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	result, err := service.AdminCommerceSettings(r.Context())
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func AdminSaveCommerceSettings(w http.ResponseWriter, r *http.Request) {
	var request model.CommerceSetting
	if !decodeCommerceBody(w, r, &request) {
		return
	}
	result, err := service.SaveCommerceSettings(r.Context(), request)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func AdminPurchaseOrders(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	result, err := service.ListPurchaseOrders(r.Context(), purchaseOrderQuery(r))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func AdminReviewPurchaseOrder(w http.ResponseWriter, r *http.Request, id string) {
	var request struct {
		Action string `json:"action"`
		Remark string `json:"remark"`
	}
	if !decodeCommerceBody(w, r, &request) {
		return
	}
	result, err := service.ReviewPurchaseOrder(r.Context(), id, request.Action, request.Remark)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func purchaseOrderQuery(r *http.Request) model.Query {
	q := parseQuery(r)
	q.Type, q.Category = r.URL.Query().Get("status"), r.URL.Query().Get("kind")
	return q
}

func decodeCommerceBody(w http.ResponseWriter, r *http.Request, value any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		Fail(w, "订单或套餐参数无效")
		return false
	}
	if decoder.Decode(new(any)) != io.EOF {
		Fail(w, "请求内容无效")
		return false
	}
	return true
}
