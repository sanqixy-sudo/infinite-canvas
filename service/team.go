package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"gorm.io/gorm"
)

type TeamListResult[T any] struct { Items []T `json:"items"`; Total int64 `json:"total"` }
type TeamDetail struct { model.Team; Members []model.TeamMember `json:"members"`; MyRole string `json:"myRole"` }

func teamRole(members []model.TeamMember, userID string) string {
	for _, member := range members { if member.UserID == userID { return member.Role } }; return ""
}
func teamMember(userID string) repository.TeamValidator {
	return func(_ model.Team, members []model.TeamMember) error {
		if teamRole(members, userID) == "" { return ErrStorageAccessDenied }; return nil
	}
}
func teamManager(userID string) repository.TeamValidator {
	return func(_ model.Team, members []model.TeamMember) error {
		role := teamRole(members, userID); if role != "owner" && role != "admin" { return ErrStorageAccessDenied }; return nil
	}
}
func teamLookupError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) { return ErrStorageAccessDenied }; return err
}
func teamQuery(q model.Query) model.Query { q.Normalize(); if q.PageSize > 50 { q.PageSize = 50 }; if q.Page > 1000000 { q.Page = 1000000 }; return q }

func CurrentUserTeams(ctx context.Context, q model.Query) (TeamListResult[model.Team], error) {
	user, err := accountDataUser(ctx); if err != nil { return TeamListResult[model.Team]{}, err }
	rows, total, err := repository.UserTeams(user.ID, teamQuery(q)); return TeamListResult[model.Team]{rows, total}, err
}
func CreateCurrentUserTeam(ctx context.Context, name string) (model.Team, error) {
	user, err := accountDataUser(ctx); if err != nil { return model.Team{}, err }
	if err := productionText(&name, "团队名称", 180, true); err != nil { return model.Team{}, err }
	team := model.Team{ID: newID("team"), Name: name, OwnerID: user.ID, CreatedAt: now()}
	err = repository.CreateTeam(team, model.TeamMember{TeamID: team.ID, UserID: user.ID, Role: "owner", JoinedAt: team.CreatedAt},newTeamAudit(team.ID,user.ID,"team.create",team.ID,"创建团队"))
	return team, err
}
func CurrentUserTeam(ctx context.Context, id string) (TeamDetail, error) {
	user, err := accountDataUser(ctx); if err != nil { return TeamDetail{}, err }
	team, members, err := repository.GetTeam(id); if err != nil { return TeamDetail{}, teamLookupError(err) }
	if err := teamMember(user.ID)(team, members); err != nil { return TeamDetail{}, err }
	return TeamDetail{team, members, teamRole(members, user.ID)}, nil
}
func UpdateCurrentUserTeam(ctx context.Context, id, name string, remove bool) error {
	user, err := accountDataUser(ctx); if err != nil { return err }
	stamp := ""; validate := teamManager(user.ID)
	if remove { stamp = now(); validate = func(team model.Team, _ []model.TeamMember) error { if team.OwnerID != user.ID { return ErrStorageAccessDenied }; return nil } } else if err := productionText(&name, "团队名称", 180, true); err != nil { return err }
	action,summary:="team.rename","修改团队名称";if remove{action,summary="team.delete","解散团队"};return teamLookupError(repository.UpdateTeam(id, validate, name, stamp,newTeamAudit(id,user.ID,action,id,summary)))
}
func ChangeCurrentTeamMember(ctx context.Context, teamID, targetID, role string) error {
	user, err := accountDataUser(ctx); if err != nil { return err }
	if role != "" && role != "admin" && role != "member" { return productionError("成员角色只能是管理员或成员") }
	return teamLookupError(repository.ChangeTeamMember(teamID, targetID, role, now(), func(team model.Team, members []model.TeamMember) error {
		actor, target := teamRole(members, user.ID), teamRole(members, targetID)
		if actor == "" || target == "" || targetID == team.OwnerID { return ErrStorageAccessDenied }
		if role != "" { if actor != "owner" { return ErrStorageAccessDenied }; return nil }
		if user.ID != targetID && actor != "owner" && !(actor == "admin" && target == "member") { return ErrStorageAccessDenied }
		return nil
	},newTeamAudit(teamID,user.ID,"member.change",targetID,"变更成员角色或移除成员")))
}
func CurrentTeamInvites(ctx context.Context, id string) ([]model.TeamInvite, error) {
	user, err := accountDataUser(ctx); if err != nil { return nil, err }
	rows, err := repository.TeamInvites(id, teamManager(user.ID)); return rows, teamLookupError(err)
}
func CreateCurrentTeamInvite(ctx context.Context, id string) (struct { model.TeamInvite; Code string `json:"code"` }, error) {
	var result struct { model.TeamInvite; Code string `json:"code"` }
	user, err := accountDataUser(ctx); if err != nil { return result, err }
	random := make([]byte, 24); if _, err := rand.Read(random); err != nil { return result, err }
	result.Code = base64.RawURLEncoding.EncodeToString(random); digest := sha256.Sum256([]byte(result.Code))
	result.TeamInvite = model.TeamInvite{ID: newID("invite"), TeamID: id, CodeHash: hex.EncodeToString(digest[:]), CreatedBy: user.ID, ExpiresAt: time.Now().UTC().Add(24*time.Hour).Format(time.RFC3339), CreatedAt: now()}
	err = repository.CreateTeamInvite(result.TeamInvite, func(team model.Team, members []model.TeamMember) error { if err := teamManager(user.ID)(team, members); err != nil { return err }; if len(members) >= 100 { return productionError("每个团队最多 100 名成员") }; return nil },newTeamAudit(id,user.ID,"invite.create",result.ID,"创建一次性邀请"))
	return result, teamLookupError(err)
}
func RevokeCurrentTeamInvite(ctx context.Context, teamID, inviteID string) error {
	user, err := accountDataUser(ctx); if err != nil { return err }
	return teamLookupError(repository.RevokeTeamInvite(teamID, inviteID, now(), teamManager(user.ID),newTeamAudit(teamID,user.ID,"invite.revoke",inviteID,"撤销邀请")))
}
func JoinCurrentTeam(ctx context.Context, code string) (string, error) {
	user, err := accountDataUser(ctx); if err != nil { return "", err }
	code = strings.TrimSpace(code); if len(code) != 32 { return "", productionError("邀请码无效、过期或已被使用") }
	digest := sha256.Sum256([]byte(code))
	id, err := repository.JoinTeam(hex.EncodeToString(digest[:]), user.ID, now(), func(invite model.TeamInvite, members []model.TeamMember) error {
		expiry, parseErr := time.Parse(time.RFC3339, invite.ExpiresAt)
		issuer := teamRole(members, invite.CreatedBy)
		if invite.RevokedAt != "" || parseErr != nil || !expiry.After(time.Now()) || (issuer != "owner" && issuer != "admin") { return productionError("邀请码无效、过期或已被使用") }
		if teamRole(members, user.ID) != "" { return nil }
		if invite.UsedAt != "" { return productionError("邀请码无效、过期或已被使用") }
		if len(members) >= 100 { return productionError("每个团队最多 100 名成员") }; return nil
	},newTeamAudit("",user.ID,"member.join",user.ID,"使用邀请加入团队"))
	if errors.Is(err, gorm.ErrRecordNotFound) { return "", productionError("邀请码无效、过期或已被使用") }; return id, err
}
