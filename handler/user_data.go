package handler

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/tigerowo/infinite-canvas/service"
)

func UserConfig(w http.ResponseWriter, r *http.Request) {
	config, err := service.CurrentUserConfig(r.Context())
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, config)
}

func SaveUserModelConfig(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Config json.RawMessage `json:"config"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 129<<20)).Decode(&request); err != nil || len(request.Config) == 0 {
		Fail(w, "配置内容不能为空")
		return
	}
	config, err := service.SaveCurrentUserModelConfig(r.Context(), request.Config)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, config)
}

func DeleteUserCanvasProjects(w http.ResponseWriter, r *http.Request) {
	var request struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil ||
		len(request.IDs) == 0 {
		Fail(w, "画布项目参数无效")
		return
	}
	if err := service.DeleteCurrentUserCanvasProjects(
		r.Context(),
		request.IDs,
	); err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, map[string]bool{"deleted": true})
}

func UserImageHistory(w http.ResponseWriter, r *http.Request) {
	data, err := service.CurrentUserImageHistory(r.Context())
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, json.RawMessage(data))
}

func SaveUserImageHistory(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || len(request.Data) == 0 {
		Fail(w, "数据内容不能为空")
		return
	}
	data, err := service.SaveCurrentUserImageHistory(r.Context(), request.Data)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, json.RawMessage(data))
}

func UserAssetData(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	data, err := service.CurrentUserAssetData(r.Context())
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, json.RawMessage(data))
}

func SaveUserAssetData(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	FailWithStatus(w, http.StatusMethodNotAllowed, "素材列表批量覆盖已停用，请使用单条素材接口")
}

func UserStoragePreferences(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	result, err := service.CurrentUserStoragePreferences(r.Context())
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func SaveUserStoragePreferences(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	var request struct {
		AutoSaveAssetsToCloud *bool `json:"autoSaveAssetsToCloud"`
	}
	if !decodeUserDataBody(w, r, &request, 4096) {
		return
	}
	if request.AutoSaveAssetsToCloud == nil {
		Fail(w, "请提供布尔类型的存储设置")
		return
	}
	result, err := service.SaveCurrentUserStoragePreferences(r.Context(), *request.AutoSaveAssetsToCloud)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func SaveUserAssetItem(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	var request struct {
		Asset json.RawMessage `json:"asset"`
	}
	if !decodeUserDataBody(w, r, &request, 1<<20) {
		return
	}
	result, err := service.SaveCurrentUserAssetItem(r.Context(), request.Asset)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func DeleteUserAssetItem(w http.ResponseWriter, r *http.Request, id string) {
	w.Header().Set("Cache-Control", "private, no-store")
	result, err := service.DeleteCurrentUserAssetItem(r.Context(), id)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func decodeUserDataBody(w http.ResponseWriter, r *http.Request, value any, limit int64) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		Fail(w, "参数格式错误")
		return false
	}
	if decoder.Decode(new(any)) != io.EOF {
		Fail(w, "请求内容无效")
		return false
	}
	return true
}
