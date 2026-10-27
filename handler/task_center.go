package handler

import (
	"net/http"
	"strconv"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

func UserTaskCenter(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	size, _ := strconv.Atoi(q.Get("pageSize"))
	result, err := service.CurrentUserTaskCenter(r.Context(), model.Query{Page: page, PageSize: size, Keyword: q.Get("keyword"), Type: q.Get("type")}, q.Get("status"))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}
