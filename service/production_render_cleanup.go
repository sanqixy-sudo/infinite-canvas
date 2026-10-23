package service

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"time"
	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

func renderProviderIdentity(provider model.StorageProvider)string{root:="";if provider.Type==model.StorageProviderTypeLocal{root=config.Cfg.LocalStorageDir};raw,_:=json.Marshal([]string{provider.ID,provider.Type,provider.Endpoint,provider.Bucket,root});sum:=sha256.Sum256(raw);return hex.EncodeToString(sum[:])}

func cleanupProductionRenderUploads(){
	stamp:=time.Now();rows,err:=repository.DueProductionRenderUploads(stamp.Unix());if err!=nil||len(rows)==0{return}
	settings,err:=repository.GetSettings();if err!=nil{return};storage:=normalizePrivateStorageSetting(settings.Private.Storage)
	providers:=append([]model.StorageProvider{localStorageProvider()},storage.Providers...)
	for _,row:=range rows{
		claimed,err:=repository.ClaimProductionRenderCleanup(row,stamp.Unix(),stamp.Add(time.Hour).Unix());if err!=nil||!claimed{continue}
		for _,provider:=range providers{
			if provider.ID!=row.ProviderID||renderProviderIdentity(provider)!=row.ProviderIdentity||!storageProviderConfigured(provider){continue}
			if deleteStorageObjectData(provider,row.ObjectKey)==nil{_ = repository.ReleaseUserStorageUpload(row.ReservationID,row.UserID);_ = repository.FinishProductionRenderCleanup(row.ID)}
			break
		}
	}
}
