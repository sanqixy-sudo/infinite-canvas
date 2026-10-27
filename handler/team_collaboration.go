package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"github.com/tigerowo/infinite-canvas/service"
)

func TeamProjects(w http.ResponseWriter,r *http.Request,id string){result,err:=service.CurrentTeamProjects(r.Context(),id,parseQuery(r));teamResponse(w,result,err)}
func TeamProjectShare(w http.ResponseWriter,r *http.Request,id string){var input struct{WorkspaceID string `json:"workspaceId"`;Revision int64 `json:"revision"`;EditAllowed bool `json:"editAllowed"`};if !decodeTeam(w,r,&input){return};result,err:=service.ShareCurrentTeamProject(r.Context(),id,input.WorkspaceID,input.Revision,input.EditAllowed);teamResponse(w,result,err)}
func TeamProjectDetail(w http.ResponseWriter,r *http.Request,id string){result,err:=service.CurrentTeamProject(r.Context(),id);teamResponse(w,result,err)}
func TeamProjectSave(w http.ResponseWriter,r *http.Request,id string){
	r.Body=http.MaxBytesReader(w,r.Body,service.ProductionMaxBodyBytes);var input service.TeamPlan;decoder:=json.NewDecoder(r.Body);decoder.DisallowUnknownFields();if decoder.Decode(&input)!=nil||decoder.Decode(new(any))!=io.EOF{Fail(w,"制作计划格式无效或超过 4 MiB");return};result,err:=service.SaveCurrentTeamProject(r.Context(),id,input);teamResponse(w,result,err)
}
func TeamProjectPermissions(w http.ResponseWriter,r *http.Request,id string){var input struct{EditAllowed bool `json:"editAllowed"`};if !decodeTeam(w,r,&input){return};teamResponse(w,nil,service.ChangeCurrentTeamProject(r.Context(),id,input.EditAllowed,false))}
func TeamProjectRevoke(w http.ResponseWriter,r *http.Request,id string){teamResponse(w,nil,service.ChangeCurrentTeamProject(r.Context(),id,false,true))}
func TeamAssets(w http.ResponseWriter,r *http.Request,id string){result,err:=service.CurrentTeamAssets(r.Context(),id,parseQuery(r));teamResponse(w,result,err)}
func TeamAssetShare(w http.ResponseWriter,r *http.Request,id string){var input struct{ObjectID string `json:"objectId"`;Title string `json:"title"`};if !decodeTeam(w,r,&input){return};result,err:=service.ShareCurrentTeamAsset(r.Context(),id,input.ObjectID,input.Title);teamResponse(w,result,err)}
func TeamAssetRevoke(w http.ResponseWriter,r *http.Request,id string){teamResponse(w,nil,service.RevokeCurrentTeamAsset(r.Context(),id))}
func TeamAssetMedia(w http.ResponseWriter,r *http.Request,id string){
	w.Header().Set("Cache-Control","private, no-store");download,err:=service.CurrentTeamAssetMedia(r.Context(),id,r.Header.Get("Range"));if err!=nil{teamResponse(w,nil,err);return};defer download.Stream.Close()
	w.Header().Set("Content-Type",download.Object.MimeType);w.Header().Set("X-Content-Type-Options","nosniff");w.Header().Set("Content-Security-Policy","default-src 'none'; sandbox")
	if download.AcceptRanges{w.Header().Set("Accept-Ranges","bytes")};if download.ContentRange!=""{w.Header().Set("Content-Range",download.ContentRange)};if download.ContentLength>=0{w.Header().Set("Content-Length",strconv.FormatInt(download.ContentLength,10))};w.WriteHeader(download.StatusCode);if r.Method!=http.MethodHead{_,_=io.Copy(w,download.Stream)}
}
func TeamCostPermission(w http.ResponseWriter,r *http.Request,id,userID string){var input struct{CanViewCosts bool `json:"canViewCosts"`};if !decodeTeam(w,r,&input){return};teamResponse(w,nil,service.SetCurrentTeamCostPermission(r.Context(),id,userID,input.CanViewCosts))}
func TeamTransfer(w http.ResponseWriter,r *http.Request,id string){var input struct{UserID string `json:"userId"`;Confirmation string `json:"confirmation"`};if !decodeTeam(w,r,&input){return};teamResponse(w,nil,service.TransferCurrentTeamOwner(r.Context(),id,input.UserID,input.Confirmation))}
func TeamAudits(w http.ResponseWriter,r *http.Request,id string){result,err:=service.CurrentTeamAudits(r.Context(),id,parseQuery(r));teamResponse(w,result,err)}
