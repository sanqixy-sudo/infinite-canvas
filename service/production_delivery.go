package service

import (
	"encoding/json"
	"math"
	"strings"
	"github.com/tigerowo/infinite-canvas/model"
)

func validateProductionDelivery(doc model.ProductionDocument) error {
	for _, episode := range doc.Episodes {
		edit := episode.Delivery
		if edit == nil { continue }
		if math.IsNaN(edit.OriginalGain)||math.IsInf(edit.OriginalGain,0)||edit.OriginalGain<0||edit.OriginalGain>1||len(edit.AudioTracks)>64||len(edit.Subtitles)>500 { return productionError("分集交付最多 64 段音轨、500 条字幕，原声音量须为 0～1") }
		seen:=map[string]bool{}
		check:=func(id,shotID string)error{
			if err:=productionID(&id,"交付片段",true);err!=nil{return err};if seen[id]{return productionError("音轨或字幕标识重复")};seen[id]=true
			if shotID!="" { found:=false;for _,shot:=range doc.Shots{if shot.ID==shotID&&shot.EpisodeID==episode.ID{found=true;break}};if !found{return productionError("音轨或字幕引用了本集之外或已删除的镜头，请解除关联")}}
			return nil
		}
		for index:=range edit.AudioTracks {
			track:=&edit.AudioTracks[index]
			if err:=check(track.ID,track.ShotID);err!=nil{return err};if err:=productionText(&track.Label,"音轨名称",180,true);err!=nil{return err}
			if _,err:=productionRenderFileID(track.StorageKey);err!=nil{return err}
			for _,value:=range []float64{track.StartSeconds,track.TrimStartSeconds,track.DurationSeconds,track.Gain}{if math.IsNaN(value)||math.IsInf(value,0)||value<0{return productionError("音轨时间或音量无效")}}
			if track.Gain>1||track.StartSeconds+track.DurationSeconds>300||track.DurationSeconds<=0||track.TrimStartSeconds+track.DurationSeconds>3600{return productionError("音轨须落在 300 秒成片内，源文件截取范围不超过 3600 秒")}
		}
		for index:=range edit.Subtitles {
			cue:=&edit.Subtitles[index]
			if err:=check(cue.ID,cue.ShotID);err!=nil{return err};if err:=productionText(&cue.Text,"字幕内容",500,true);err!=nil{return err}
			if math.IsNaN(cue.StartSeconds)||math.IsInf(cue.StartSeconds,0)||math.IsNaN(cue.EndSeconds)||math.IsInf(cue.EndSeconds,0)||cue.StartSeconds<0||cue.EndSeconds<=cue.StartSeconds||cue.EndSeconds>300{return productionError("字幕起止时间须落在 0～300 秒内，结束须晚于开始")}
		}
	}
	return nil
}

func productionDeliveryStorageIDs(doc model.ProductionDocument) []string {
	ids:=[]string{};seen:=map[string]bool{}
	for _,episode:=range doc.Episodes{if episode.Delivery==nil{continue};for _,track:=range episode.Delivery.AudioTracks{id:=strings.TrimPrefix(track.StorageKey,"server:");if !seen[id]{seen[id]=true;ids=append(ids,id)}}}
	return ids
}

func productionDeliveryJSON(edit *model.ProductionDeliveryEdit) string { raw,_:=json.Marshal(edit);return string(raw) }
