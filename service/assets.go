package service

import (
	"errors"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

var ErrPublicAssetNotFound = errors.New("素材已下架或不存在")

func PublicAsset(id string) (model.Asset, error) {
	item, found, err := repository.GetAsset(id)
	if err != nil {
		return model.Asset{}, err
	}
	if !found {
		return model.Asset{}, ErrPublicAssetNotFound
	}
	item.CoverURL = refreshPublishedStorageURL(item.CoverURL)
	item.URL = refreshPublishedStorageURL(item.URL)
	return item, nil
}

func ListAssets(q model.Query) (model.AssetList, error) {
	items, total, err := repository.ListAssets(q)
	if err != nil {
		return model.AssetList{}, err
	}
	for i := range items {
		items[i].CoverURL = refreshPublishedStorageURL(items[i].CoverURL)
		items[i].URL = refreshPublishedStorageURL(items[i].URL)
	}
	tags, categories, err := repository.ListAssetFilters(q)
	if err != nil {
		return model.AssetList{}, err
	}
	return model.AssetList{Items: items, Tags: tags, Categories: categories, Total: int(total)}, nil
}

func SaveAsset(item model.Asset) (model.Asset, error) {
	now := time.Now().Format(time.RFC3339)
	if item.Type == "" {
		item.Type = model.AssetTypeText
	}
	if item.ID == "" {
		item.ID = newID("asset")
		item.CreatedAt = now
	}
	item.UpdatedAt = now
	if item.CoverURL == "" {
		item.CoverURL = assetCoverURL(item)
	}
	return repository.SaveAsset(item)
}

func DeleteAsset(id string) error {
	return repository.DeleteAsset(id)
}

func assetCoverURL(item model.Asset) string {
	if item.CoverURL != "" {
		return item.CoverURL
	}
	if item.Type == model.AssetTypeImage {
		return item.URL
	}
	return ""
}
