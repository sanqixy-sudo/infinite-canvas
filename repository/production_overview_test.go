package repository

import (
	"github.com/tigerowo/infinite-canvas/model"
	"testing"
)

func TestProductionOverviewAndDeliveryOwnership(t *testing.T) {
	db := commerceTestDB(t)
	if err := db.AutoMigrate(&model.ProductionProject{}, &model.ProductionEpisode{}, &model.ProductionShot{}, &model.ProductionAsset{}, &model.ProductionRenderJob{}, &model.StorageObject{}); err != nil {
		t.Fatal(err)
	}
	rows := []any{
		&model.ProductionProject{ID: "mine", UserID: "buyer", WorkspaceID: "root", Title: "我的短片", UpdatedAt: "2026-01-02"},
		&model.ProductionProject{ID: "other", UserID: "other", WorkspaceID: "other-root", Title: "别人的短片", UpdatedAt: "2026-01-03"},
		&model.ProductionEpisode{ProjectID: "mine", ID: "ep"},
		&model.ProductionShot{ProjectID: "mine", ID: "shot", SelectedImageCandidateID: "candidate"},
		&model.ProductionShot{ProjectID: "other", ID: "other-shot", SelectedImageCandidateID: "private"},
		&model.ProductionAsset{ProjectID: "mine", ID: "asset"},
		&model.ProductionRenderJob{ID: "r1", UserID: "buyer", RequestID: "request1", WorkspaceID: "root", EpisodeTitle: "第一集", Status: "completed", OutputStorageKey: "server:owned", CreatedAt: "2026-01-04", SnapshotJSON: "private"},
		&model.ProductionRenderJob{ID: "r2", UserID: "buyer", RequestID: "request2", WorkspaceID: "root", EpisodeTitle: "第二集", Status: "completed", OutputStorageKey: "server:foreign", CreatedAt: "2026-01-03"},
		&model.ProductionRenderJob{ID: "r3", UserID: "buyer", RequestID: "request3", WorkspaceID: "root", EpisodeTitle: "第三集", Status: "failed", CreatedAt: "2026-01-02"},
		&model.ProductionRenderJob{ID: "foreign-job", UserID: "other", RequestID: "other", WorkspaceID: "other-root", Status: "completed"},
		&model.StorageObject{ID: "owned", CreatedBy: "buyer", ObjectKey: "owned.mp4", MimeType: "video/mp4"},
		&model.StorageObject{ID: "foreign", CreatedBy: "other", ObjectKey: "foreign.mp4", MimeType: "video/mp4"},
	}
	for _, row := range rows {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	q := model.Query{Page: 1, PageSize: 12}
	result, err := listUserProductionOverview(db, "buyer", q)
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != 1 || len(result.Items) != 1 {
		t.Fatalf("ownership: %+v", result)
	}
	item := result.Items[0]
	if item.ID != "mine" || item.EpisodeCount != 1 || item.ShotCount != 1 || item.AssetCount != 1 || item.SelectedShotCount != 1 || item.RenderCount != 2 {
		t.Fatalf("stats: %+v", item)
	}
	q.Keyword = "别人的"
	result, err = listUserProductionOverview(db, "buyer", q)
	if err != nil || result.Total != 0 {
		t.Fatalf("search isolation: %+v %v", result, err)
	}
	q = model.Query{Page: 1, PageSize: 1, Type: "completed"}
	deliveries, err := listUserProductionDeliveries(db, "buyer", q, "")
	if err != nil {
		t.Fatal(err)
	}
	if deliveries.Total != 2 || len(deliveries.Items) != 1 || !deliveries.Items[0].FileAvailable || deliveries.Items[0].ProjectTitle != "我的短片" {
		t.Fatalf("delivery: %+v", deliveries)
	}
	q.Page = 2
	deliveries, err = listUserProductionDeliveries(db, "buyer", q, "")
	if err != nil || len(deliveries.Items) != 1 || deliveries.Items[0].FileAvailable {
		t.Fatalf("foreign file should be unavailable: %+v %v", deliveries, err)
	}
	q.Page = 1
	deliveries, err = listUserProductionDeliveries(db, "buyer", q, "other-root")
	if err != nil || deliveries.Total != 0 {
		t.Fatalf("foreign workspace: %+v %v", deliveries, err)
	}
	if err := db.Model(&model.StorageObject{}).Where("id = ?", "owned").Update("deleted_at", "deleted").Error; err != nil {
		t.Fatal(err)
	}
	deliveries, err = listUserProductionDeliveries(db, "buyer", q, "root")
	if err != nil || len(deliveries.Items) != 1 || deliveries.Items[0].FileAvailable {
		t.Fatalf("deleted file: %+v %v", deliveries, err)
	}
}
