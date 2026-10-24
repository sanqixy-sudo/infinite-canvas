package handler

import (
	"net/http"

	"github.com/tigerowo/infinite-canvas/service"
)

func UserCreditLogs(w http.ResponseWriter, r *http.Request) {
	logs, err := service.CurrentUserCreditLogs(r.Context(), parseQuery(r))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, logs)
}
