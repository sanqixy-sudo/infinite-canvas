package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/tigerowo/infinite-canvas/service"
)

func teamResponse(w http.ResponseWriter, value any, err error) {
	w.Header().Set("Cache-Control", "private, no-store")
	if errors.Is(err, service.ErrStorageAccessDenied) { FailWithStatus(w, http.StatusForbidden, "无权访问此团队或审片，成员资格可能已撤销"); return }
	if err != nil { FailError(w, err); return }; OK(w, value)
}
func decodeTeam(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	decoder := json.NewDecoder(r.Body); decoder.DisallowUnknownFields()
	if decoder.Decode(target) != nil || decoder.Decode(new(any)) != io.EOF { Fail(w, "团队请求格式无效，内容不能超过 64 KiB"); return false }; return true
}
func TeamList(w http.ResponseWriter, r *http.Request) { result, err := service.CurrentUserTeams(r.Context(), parseQuery(r)); teamResponse(w, result, err) }
func TeamCreate(w http.ResponseWriter, r *http.Request) {
	var input struct { Name string `json:"name"` }; if !decodeTeam(w, r, &input) { return }
	result, err := service.CreateCurrentUserTeam(r.Context(), input.Name); teamResponse(w, result, err)
}
func TeamDetail(w http.ResponseWriter, r *http.Request, id string) { result, err := service.CurrentUserTeam(r.Context(), id); teamResponse(w, result, err) }
func TeamUpdate(w http.ResponseWriter, r *http.Request, id string) {
	var input struct { Name string `json:"name"` }; if !decodeTeam(w, r, &input) { return }
	teamResponse(w, nil, service.UpdateCurrentUserTeam(r.Context(), id, input.Name, false))
}
func TeamDelete(w http.ResponseWriter, r *http.Request, id string) { teamResponse(w, nil, service.UpdateCurrentUserTeam(r.Context(), id, "", true)) }
func TeamJoin(w http.ResponseWriter, r *http.Request) {
	var input struct { Code string `json:"code"` }; if !decodeTeam(w, r, &input) { return }
	id, err := service.JoinCurrentTeam(r.Context(), input.Code); teamResponse(w, map[string]string{"teamId": id}, err)
}
func TeamMemberUpdate(w http.ResponseWriter, r *http.Request, id string) {
	var input struct { UserID string `json:"userId"`; Role string `json:"role"` }; if !decodeTeam(w, r, &input) { return }
	if input.Role == "" { Fail(w, "请选择成员角色"); return }; teamResponse(w, nil, service.ChangeCurrentTeamMember(r.Context(), id, input.UserID, input.Role))
}
func TeamMemberDelete(w http.ResponseWriter, r *http.Request, id, userID string) { teamResponse(w, nil, service.ChangeCurrentTeamMember(r.Context(), id, userID, "")) }
func TeamInvites(w http.ResponseWriter, r *http.Request, id string) { result, err := service.CurrentTeamInvites(r.Context(), id); teamResponse(w, result, err) }
func TeamInviteCreate(w http.ResponseWriter, r *http.Request, id string) { result, err := service.CreateCurrentTeamInvite(r.Context(), id); teamResponse(w, result, err) }
func TeamInviteDelete(w http.ResponseWriter, r *http.Request, id, inviteID string) { teamResponse(w, nil, service.RevokeCurrentTeamInvite(r.Context(), id, inviteID)) }
func TeamReviews(w http.ResponseWriter, r *http.Request, id string) { result, err := service.CurrentTeamReviews(r.Context(), id, parseQuery(r)); teamResponse(w, result, err) }
func TeamReviewCreate(w http.ResponseWriter, r *http.Request, id string) {
	var input service.ReviewPublishInput; if !decodeTeam(w, r, &input) { return }
	result, err := service.PublishCurrentTeamReview(r.Context(), id, input); teamResponse(w, result, err)
}
func ProductionReviewDetail(w http.ResponseWriter, r *http.Request, id string) { result, err := service.CurrentProductionReview(r.Context(), id); teamResponse(w, result, err) }
func ProductionReviewDelete(w http.ResponseWriter, r *http.Request, id string) { teamResponse(w, nil, service.RevokeCurrentProductionReview(r.Context(), id)) }
func ProductionReviewComments(w http.ResponseWriter, r *http.Request, id string) { result, err := service.CurrentReviewComments(r.Context(), id, r.URL.Query().Get("shotId"), parseQuery(r)); teamResponse(w, result, err) }
func ProductionReviewCommentCreate(w http.ResponseWriter, r *http.Request, id string) {
	var input struct { ShotID string `json:"shotId"`; Body string `json:"body"` }; if !decodeTeam(w, r, &input) { return }
	teamResponse(w, nil, service.AddCurrentReviewComment(r.Context(), id, input.ShotID, input.Body))
}
func ProductionReviewCommentDelete(w http.ResponseWriter, r *http.Request, id, commentID string) { teamResponse(w, nil, service.DeleteCurrentReviewComment(r.Context(), id, commentID)) }
func ProductionReviewMedia(w http.ResponseWriter, r *http.Request, id, shotID, kind string) {
	w.Header().Set("Cache-Control", "private, no-store")
	download, err := service.CurrentReviewMedia(r.Context(), id, shotID, kind, r.Header.Get("Range")); if err != nil { teamResponse(w, nil, err); return }
	defer download.Stream.Close()
	w.Header().Set("Content-Type", download.Object.MimeType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	if download.AcceptRanges { w.Header().Set("Accept-Ranges", "bytes") }
	if download.ContentRange != "" { w.Header().Set("Content-Range", download.ContentRange) }
	if download.ContentLength >= 0 { w.Header().Set("Content-Length", strconv.FormatInt(download.ContentLength, 10)) }
	w.WriteHeader(download.StatusCode)
	if r.Method != http.MethodHead { _, _ = io.Copy(w, download.Stream) }
}
