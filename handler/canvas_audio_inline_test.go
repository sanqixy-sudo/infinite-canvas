package handler

import (
    "strings"
    "testing"
)

func TestCanvasInlineAudioPreservesKnownPCM(t *testing.T){
    payload:=[]byte(`{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"audio/L16;codec=pcm;rate=24000","data":"AAAAAA=="}}]}}]}`)
    url,mimeType,size,ok:=canvasInlineAudio(payload)
    if !ok||size!=4||mimeType!="audio/l16;rate=24000"||!strings.HasSuffix(url,"AAAAAA=="){t.Fatalf("PCM not retained: %s %s %d %v",url,mimeType,size,ok)}
    for _,raw:=range []string{strings.ReplaceAll(string(payload),"24000","48000"),strings.ReplaceAll(string(payload),"AAAAAA==","AA=="),strings.ReplaceAll(string(payload),"AAAAAA==","invalid!")}{if _,_,_,ok:=canvasInlineAudio([]byte(raw));ok{t.Fatal("unsupported PCM accepted")}}
}
