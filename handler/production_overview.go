package handler

import (
	"github.com/tigerowo/infinite-canvas/service"
	"net/http"
)

func UserProductionOverview(w http.ResponseWriter, r *http.Request) {
	result, err := service.CurrentUserProductionOverview(r.Context(), parseQuery(r))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func UserProductionDeliveries(w http.ResponseWriter, r *http.Request) {
	result, err := service.CurrentUserProductionDeliveries(r.Context(), parseQuery(r), r.URL.Query().Get("workspaceId"))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}
