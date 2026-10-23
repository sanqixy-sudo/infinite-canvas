package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

func UserProduction(w http.ResponseWriter, r *http.Request) {
	doc, err := service.CurrentUserProduction(r.Context(), r.URL.Query().Get("workspaceId"))
	if err != nil { FailError(w, err); return }
	OK(w, doc)
}

func UserProductionTasks(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page")); size, _ := strconv.Atoi(q.Get("pageSize")); if size == 0 { size = 30 }
	tasks, err := service.CurrentUserProductionTasks(r.Context(), q.Get("workspaceId"), service.ProductionTaskQuery{Page: page, PageSize: size, EpisodeID: q.Get("episodeId"), Status: q.Get("status")})
	if err != nil { FailError(w, err); return }
	OK(w, tasks)
}

func RetryUserProductionTask(w http.ResponseWriter, r *http.Request) {
	var request service.ProductionRetryInput
	if !decodeProduction(w, r, &request) { return }
	result, err := service.RetryCurrentUserProductionTask(r.Context(), request)
	if err != nil { FailError(w, err); return }
	OK(w, result)
}

func CreateUserProduction(w http.ResponseWriter, r *http.Request) {
	var request struct {
		WorkspaceID string `json:"workspaceId"`
		Title       string `json:"title"`
	}
	if !decodeProduction(w, r, &request) { return }
	doc, err := service.CreateCurrentUserProduction(r.Context(), request.WorkspaceID, request.Title)
	if err != nil { FailError(w, err); return }
	OK(w, doc)
}

func SaveUserProduction(w http.ResponseWriter, r *http.Request) {
	var doc model.ProductionDocument
	if !decodeProduction(w, r, &doc) { return }
	saved, err := service.SaveCurrentUserProduction(r.Context(), doc)
	if err != nil { FailError(w, err); return }
	OK(w, saved)
}

func DeleteUserProduction(w http.ResponseWriter, r *http.Request) {
	revision, err := strconv.ParseInt(r.URL.Query().Get("revision"), 10, 64)
	if err != nil { Fail(w, "制作计划版本无效，请重新加载"); return }
	if err := service.DeleteCurrentUserProduction(r.Context(), r.URL.Query().Get("id"), revision); err != nil { FailError(w, err); return }
	OK(w, nil)
}

func decodeProduction(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, service.ProductionMaxBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		Fail(w, "制作计划参数无效，内容不能超过 4 MiB，排序和时长必须为整数")
		return false
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		Fail(w, "制作计划请求必须是一份完整 JSON 文档")
		return false
	}
	return true
}
