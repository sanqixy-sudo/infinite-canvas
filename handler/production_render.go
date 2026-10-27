package handler

import (
	"net/http"
	"github.com/tigerowo/infinite-canvas/service"
)

func UserProductionRenders(w http.ResponseWriter,r *http.Request){
	jobs,err:=service.CurrentUserProductionRenders(r.Context(),r.URL.Query().Get("workspaceId"));if err!=nil{FailError(w,err);return};OK(w,jobs)
}
func UserProductionRenderRequest(w http.ResponseWriter,r *http.Request){
	job,err:=service.CurrentUserProductionRenderRequest(r.Context(),r.URL.Query().Get("requestId"));if err!=nil{FailError(w,err);return};OK(w,job)
}
func CreateUserProductionRender(w http.ResponseWriter,r *http.Request){
	var input service.ProductionRenderInput;if !decodeProduction(w,r,&input){return}
	job,err:=service.CreateCurrentUserProductionRender(r.Context(),input);if err!=nil{FailError(w,err);return};OK(w,job)
}
func ActionUserProductionRender(w http.ResponseWriter,r *http.Request){
	var input struct{ID string `json:"id"`;Action string `json:"action"`;RequestID string `json:"requestId"`};if !decodeProduction(w,r,&input){return}
	if input.Action=="cancel-request"{job,err:=service.CancelCurrentUserProductionRenderRequest(r.Context(),input.RequestID);if err!=nil{FailError(w,err);return};OK(w,job);return}
	job,err:=service.ActionCurrentUserProductionRender(r.Context(),input.ID,input.Action);if err!=nil{FailError(w,err);return};OK(w,job)
}
