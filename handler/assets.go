package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

func PublicAsset(w http.ResponseWriter, r *http.Request, id string) {
	item, err := service.PublicAsset(id)
	if errors.Is(err, service.ErrPublicAssetNotFound) {
		FailWithStatus(w, http.StatusNotFound, "素材已下架或不存在")
		return
	}
	if err != nil {
		FailError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	OK(w, item)
}

func Assets(w http.ResponseWriter, r *http.Request) {
	result, err := service.ListAssets(parseQuery(r))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func AdminAssets(w http.ResponseWriter, r *http.Request) {
	result, err := service.ListAssets(parseQuery(r))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func AdminSaveAsset(w http.ResponseWriter, r *http.Request) {
	var item model.Asset
	_ = json.NewDecoder(r.Body).Decode(&item)
	result, err := service.SaveAsset(item)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func AdminDeleteAsset(w http.ResponseWriter, r *http.Request, id string) {
	if err := service.DeleteAsset(id); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}
