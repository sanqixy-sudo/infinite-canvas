package service

import (
	"context"
	"encoding/json"
	"net/url"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

type ReviewPublishInput struct { WorkspaceID string `json:"workspaceId"`; Revision int64 `json:"revision"`; EpisodeIDs []string `json:"episodeIds"`; IncludeScript bool `json:"includeScript"` }
type ReviewEpisode struct { ID string `json:"id"`; Title string `json:"title"`; Script string `json:"script,omitempty"` }
type ReviewShot struct {
	ID string `json:"id"`; EpisodeID string `json:"episodeId"`; Title string `json:"title"`; SceneTitle string `json:"sceneTitle"`
	Description string `json:"description"`; Dialogue string `json:"dialogue"`; Camera string `json:"camera"`; Seconds int `json:"seconds"`
	ImageURL string `json:"imageUrl,omitempty"`; VideoURL string `json:"videoUrl,omitempty"`; UnavailableMedia bool `json:"unavailableMedia"`
}
type reviewStoredShot struct { ReviewShot; ImageID string `json:"imageObjectId,omitempty"`; VideoID string `json:"videoObjectId,omitempty"` }
type reviewSnapshot struct { Episodes []ReviewEpisode `json:"episodes"`; Shots []reviewStoredShot `json:"shots"` }
type ReviewDetail struct { model.ProductionReview; Episodes []ReviewEpisode `json:"episodes"`; Shots []ReviewShot `json:"shots"`; CanRevoke bool `json:"canRevoke"` }

func reviewAccess(userID string) func(model.ProductionReview, model.Team, []model.TeamMember) error {
	return func(review model.ProductionReview, team model.Team, members []model.TeamMember) error {
		if err := teamMember(userID)(team, members); err != nil { return err }
		if teamRole(members, review.PublisherID) == "" { return ErrStorageAccessDenied }; return nil
	}
}
func decodeReview(review model.ProductionReview) (reviewSnapshot, error) {
	var snapshot reviewSnapshot
	if json.Unmarshal([]byte(review.Snapshot), &snapshot) != nil { return snapshot, productionError("审片快照无法读取，请发布者重新发布") }; return snapshot, nil
}
func reviewShotCheck(review model.ProductionReview, shotID string) error {
	snapshot, err := decodeReview(review); if err != nil { return err }
	for _, shot := range snapshot.Shots { if shot.ID == shotID { return nil } }; return productionError("镜头不属于此审片版本")
}
func buildReviewSnapshot(doc model.ProductionDocument, objects []model.StorageObject, input ReviewPublishInput) (reviewSnapshot, []string, error) {
	result := reviewSnapshot{Episodes: []ReviewEpisode{}, Shots: []reviewStoredShot{}}
	if input.Revision != doc.Revision { return result, nil, productionError("制作计划版本已变化，请重新读取后确认发布") }
	selected := map[string]bool{}; for _, id := range input.EpisodeIDs { selected[id] = true }
	if len(selected) == 0 || len(selected) != len(input.EpisodeIDs) || len(selected) > 100 { return result, nil, productionError("请选择不重复的分集") }
	for _, episode := range doc.Episodes { if selected[episode.ID] { text := ""; if input.IncludeScript { text = episode.Script }; result.Episodes = append(result.Episodes, ReviewEpisode{episode.ID, episode.Title, text}) } }
	if len(result.Episodes) != len(selected) { return result, nil, productionError("所选分集已不存在，请重新选择") }
	files := map[string]model.StorageObject{}; for _, object := range objects { files["server:"+object.ID] = object }
	scenes := map[string]string{}; for _, scene := range doc.Scenes { scenes[scene.ID] = scene.Title }
	ids := []string{}; seen := map[string]bool{}
	for _, shot := range doc.Shots {
		if !selected[shot.EpisodeID] { continue }
		entry := reviewStoredShot{ReviewShot: ReviewShot{ID: shot.ID, EpisodeID: shot.EpisodeID, Title: shot.Title, SceneTitle: scenes[shot.SceneID], Description: shot.Description, Dialogue: shot.Dialogue, Camera: shot.Camera, Seconds: shot.Seconds}}
		for kind, candidateID := range map[string]string{"image": shot.SelectedImageCandidateID, "video": shot.SelectedVideoCandidateID} {
			if candidateID == "" { continue }
			found := false
			for _, candidate := range shot.Candidates {
				if candidate.ID != candidateID || candidate.Kind != kind { continue }
				object, ok := files[candidate.StorageKey]
				if !ok || object.CreatedBy != doc.UserID || object.DeletedAt != "" || !strings.HasPrefix(object.MimeType, kind+"/") { continue }
				if kind == "image" { entry.ImageID = object.ID } else { entry.VideoID = object.ID }
				if !seen[object.ID] { ids = append(ids, object.ID); seen[object.ID] = true }; found = true
			}
			if !found { entry.UnavailableMedia = true }
		}
		result.Shots = append(result.Shots, entry)
	}
	if len(result.Shots) == 0 { return result, nil, productionError("所选分集尚无镜头，请先保存镜头计划") }
	return result, ids, nil
}
func CurrentTeamReviews(ctx context.Context, teamID string, q model.Query) (TeamListResult[model.ProductionReview], error) {
	user, err := accountDataUser(ctx); if err != nil { return TeamListResult[model.ProductionReview]{}, err }
	rows, total, err := repository.TeamReviews(teamID, teamQuery(q), teamMember(user.ID)); return TeamListResult[model.ProductionReview]{rows, total}, teamLookupError(err)
}
func PublishCurrentTeamReview(ctx context.Context, teamID string, input ReviewPublishInput) (model.ProductionReview, error) {
	user, err := accountDataUser(ctx); if err != nil { return model.ProductionReview{}, err }
	if err := productionID(&input.WorkspaceID, "项目", true); err != nil { return model.ProductionReview{}, err }
	review, err := repository.CreateProductionReview(teamID, user.ID, input.WorkspaceID, teamMember(user.ID), func(doc model.ProductionDocument, objects []model.StorageObject) (model.ProductionReview, error) {
		sortProduction(&doc)
		snapshot, ids, err := buildReviewSnapshot(doc, objects, input); if err != nil { return model.ProductionReview{}, err }
		raw, err := json.Marshal(snapshot); if err != nil { return model.ProductionReview{}, err }
		if len(raw) > ProductionMaxBodyBytes { return model.ProductionReview{}, productionError("审片快照超过 4 MiB，请减少分集") }
		return model.ProductionReview{ID: newID("review"), TeamID: teamID, PublisherID: user.ID, WorkspaceID: input.WorkspaceID, Title: doc.Title, SourceRevision: doc.Revision, Snapshot: string(raw), MediaObjectIDs: ids, CreatedAt: now()}, nil
	},newTeamAudit(teamID,user.ID,"review.publish","","发布审片快照"))
	return review, teamLookupError(err)
}
func CurrentProductionReview(ctx context.Context, id string) (ReviewDetail, error) {
	user, err := accountDataUser(ctx); if err != nil { return ReviewDetail{}, err }; canRevoke := false
	review, err := repository.ReadProductionReview(id, func(review model.ProductionReview, team model.Team, members []model.TeamMember) error {
		if err := reviewAccess(user.ID)(review, team, members); err != nil { return err }
		role := teamRole(members, user.ID); canRevoke = review.PublisherID == user.ID || role == "owner" || role == "admin"; return nil
	}); if err != nil { return ReviewDetail{}, teamLookupError(err) }
	snapshot, err := decodeReview(review); if err != nil { return ReviewDetail{}, err }
	result := ReviewDetail{ProductionReview: review, Episodes: snapshot.Episodes, Shots: []ReviewShot{}, CanRevoke: canRevoke}
	for _, stored := range snapshot.Shots {
		shot := stored.ReviewShot
		base := "/api/team-reviews/"+url.PathEscape(id)+"/media/"+url.PathEscape(shot.ID)+"/"
		if stored.ImageID != "" { shot.ImageURL = base+"image" }; if stored.VideoID != "" { shot.VideoURL = base+"video" }
		result.Shots = append(result.Shots, shot)
	}; return result, nil
}
func RevokeCurrentProductionReview(ctx context.Context, id string) error {
	user, err := accountDataUser(ctx); if err != nil { return err }
	return teamLookupError(repository.RevokeProductionReview(id, now(), func(review model.ProductionReview, team model.Team, members []model.TeamMember) error {
		if err := reviewAccess(user.ID)(review, team, members); err != nil { return err }
		if review.PublisherID == user.ID { return nil }; return teamManager(user.ID)(team, members)
	},newTeamAudit("",user.ID,"review.revoke",id,"撤销审片快照")))
}
func CurrentReviewComments(ctx context.Context, id, shotID string, q model.Query) (TeamListResult[model.ProductionReviewComment], error) {
	user, err := accountDataUser(ctx); if err != nil { return TeamListResult[model.ProductionReviewComment]{}, err }
	rows, total, err := repository.ReviewComments(id, shotID, teamQuery(q), func(review model.ProductionReview, team model.Team, members []model.TeamMember) error { if err := reviewAccess(user.ID)(review, team, members); err != nil { return err }; return reviewShotCheck(review, shotID) })
	return TeamListResult[model.ProductionReviewComment]{rows, total}, teamLookupError(err)
}
func AddCurrentReviewComment(ctx context.Context, id, shotID, body string) error {
	user, err := accountDataUser(ctx); if err != nil { return err }; if err := productionText(&body, "审片意见", 2000, true); err != nil { return err }
	comment := model.ProductionReviewComment{ID: newID("comment"), ReviewID: id, ShotID: shotID, AuthorID: user.ID, Body: body, CreatedAt: now()}
	return teamLookupError(repository.CreateReviewComment(comment, func(review model.ProductionReview, team model.Team, members []model.TeamMember) error { if err := reviewAccess(user.ID)(review, team, members); err != nil { return err }; return reviewShotCheck(review, shotID) },newTeamAudit("",user.ID,"comment.create",comment.ID,"添加镜头审片意见")))
}
func DeleteCurrentReviewComment(ctx context.Context, id, commentID string) error {
	user, err := accountDataUser(ctx); if err != nil { return err }
	return teamLookupError(repository.DeleteReviewComment(id, commentID, func(review model.ProductionReview, team model.Team, members []model.TeamMember, comment model.ProductionReviewComment) error {
		if err := reviewAccess(user.ID)(review, team, members); err != nil { return err }
		if comment.AuthorID == user.ID || review.PublisherID == user.ID { return nil }; return teamManager(user.ID)(team, members)
	},newTeamAudit("",user.ID,"comment.delete",commentID,"删除镜头审片意见")))
}
func CurrentReviewMedia(ctx context.Context, id, shotID, kind, rangeHeader string) (DownloadedStorageObject, error) {
	user, err := accountDataUser(ctx); if err != nil { return DownloadedStorageObject{}, err }
	review, err := repository.ReadProductionReview(id, reviewAccess(user.ID)); if err != nil { return DownloadedStorageObject{}, teamLookupError(err) }
	snapshot, err := decodeReview(review); if err != nil { return DownloadedStorageObject{}, err }
	objectID := ""
	for _, shot := range snapshot.Shots { if shot.ID == shotID { if kind == "image" { objectID = shot.ImageID }; if kind == "video" { objectID = shot.VideoID } } }
	if objectID == "" { return DownloadedStorageObject{}, ErrStorageAccessDenied }
	object, err := repository.GetStorageObject(objectID); if err != nil { return DownloadedStorageObject{}, teamLookupError(err) }
	if object.CreatedBy != review.PublisherID || object.DeletedAt != "" || !strings.HasPrefix(object.MimeType, kind+"/") { return DownloadedStorageObject{}, ErrStorageAccessDenied }
	return downloadStoredObject(object, rangeHeader)
}
