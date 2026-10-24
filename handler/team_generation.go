package handler

import (
    "net/http"
    "github.com/tigerowo/infinite-canvas/service"
)
func TeamGenerationList(w http.ResponseWriter,r *http.Request,id string){result,err:=service.CurrentTeamGeneration(r.Context(),id,parseQuery(r));teamResponse(w,result,err)}
func TeamGenerationCreate(w http.ResponseWriter,r *http.Request,id string){var input service.TeamGenerationInput;if !decodeTeam(w,r,&input){return};result,err:=service.CreateCurrentTeamGeneration(r.Context(),id,input);teamResponse(w,result,err)}
func TeamGenerationBudget(w http.ResponseWriter,r *http.Request,id string){var input struct{LimitCredits float64 `json:"limitCredits"`};if !decodeTeam(w,r,&input){return};teamResponse(w,nil,service.SetCurrentTeamGenerationBudget(r.Context(),id,input.LimitCredits))}
func TeamGenerationAction(w http.ResponseWriter,r *http.Request,id,approvalID string){var input service.TeamGenerationAction;if !decodeTeam(w,r,&input){return};result,err:=service.ActCurrentTeamGeneration(r.Context(),id,approvalID,input);teamResponse(w,result,err)}
