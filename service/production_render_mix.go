package service

import (
	"fmt"
	"strconv"
	"strings"
	"github.com/tigerowo/infinite-canvas/model"
)

func productionASS(cues []model.ProductionSubtitle) string {
	var result strings.Builder
	result.WriteString("[Script Info]\nScriptType: v4.00+\nPlayResX: 720\nPlayResY: 1280\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Noto Sans CJK SC,34,&H00FFFFFF,&H00FFFFFF,&H00202020,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,48,48,80,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
	stamp:=func(value float64)string{centiseconds:=int(value*100+0.5);return fmt.Sprintf("%d:%02d:%02d.%02d",centiseconds/360000,centiseconds/6000%60,centiseconds/100%60,centiseconds%100)}
	for _,cue:=range cues{safe:=strings.NewReplacer("\\","＼","{","｛","}","｝","\r","","\n","\\N").Replace(cue.Text);result.WriteString(fmt.Sprintf("Dialogue: 0,%s,%s,Default,,0,0,0,,%s\n",stamp(cue.StartSeconds),stamp(cue.EndSeconds),safe))}
	return result.String()
}

func productionMixArgs(input,output string,audioFiles []string,edit model.ProductionDeliveryEdit,seconds int)[]string{
	args:=[]string{"-hide_banner","-loglevel","error","-nostdin","-y","-threads","2","-protocol_whitelist","file,pipe","-format_whitelist",renderDemuxers,"-i",input}
	for _,file:=range audioFiles{args=append(args,"-threads","2","-protocol_whitelist","file,pipe","-format_whitelist",renderDemuxers,"-i",file)}
	filters:=[]string{fmt.Sprintf("[0:a:0]volume=%.3f[original]",edit.OriginalGain)};mix:="[original]"
	for index,track:=range edit.AudioTracks{
		filters=append(filters,fmt.Sprintf("[%d:a:0]atrim=start=%.3f:duration=%.3f,asetpts=PTS-STARTPTS,volume=%.3f,adelay=%d:all=1[track%d]",index+1,track.TrimStartSeconds,track.DurationSeconds,track.Gain,int(track.StartSeconds*1000+0.5),index));mix+=fmt.Sprintf("[track%d]",index)
	}
	filters=append(filters,fmt.Sprintf("%samix=inputs=%d:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[a]",mix,len(edit.AudioTracks)+1))
	video:="0:v:0";burn:=edit.BurnSubtitles&&len(edit.Subtitles)>0
	if burn{filters=append(filters,"[0:v:0]subtitles=filename=captions.ass[v]");video="[v]"}
	args=append(args,"-filter_complex_threads","1","-filter_complex",strings.Join(filters,";"),"-map",video,"-map","[a]","-map_metadata","-1")
	if burn{args=append(args,"-c:v","libx264","-threads","2","-preset","veryfast","-pix_fmt","yuv420p","-crf","23","-maxrate","4M","-bufsize","8M")}else{args=append(args,"-c:v","copy")}
	return append(args,"-c:a","aac","-b:a","128k","-ar","48000","-ac","2","-t",strconv.Itoa(seconds),"-fs",strconv.Itoa(productionRenderMaxOutput),"-movflags","+faststart",output)
}
