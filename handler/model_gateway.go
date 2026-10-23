package handler

import (
	"encoding/json"
	"io"
	"net/http"

	gm "github.com/tigerowo/infinite-canvas/gateway/model"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

func AdminGatewaySettings(w http.ResponseWriter,r *http.Request){
	w.Header().Set("Cache-Control","no-store")
	if r.Method==http.MethodPut {
		var cfg model.GatewaySettings
		if json.NewDecoder(http.MaxBytesReader(w,r.Body,2<<20)).Decode(&cfg)!=nil {Fail(w,"配置格式错误");return}
		result,err:=service.SaveGatewaySettings(r.Context(),cfg);if err!=nil{FailError(w,err);return};OK(w,result);return
	}
	result,err:=service.AdminGatewaySettings(r.Context());if err!=nil{FailError(w,err);return};OK(w,result)
}

func AdminSyncGatewayModels(w http.ResponseWriter,r *http.Request){
	result,err:=service.SyncGatewayModels(r.Context());if err!=nil{FailError(w,err);return};OK(w,result)
}

func QuoteGatewayTask(w http.ResponseWriter,r *http.Request){
	var req gm.Request
	if json.NewDecoder(http.MaxBytesReader(w,r.Body,2<<20)).Decode(&req)!=nil{Fail(w,"请求格式错误");return}
	result,err:=service.QuoteGatewayTask(r.Context(),req);if err!=nil{FailError(w,err);return};OK(w,result)
}

func SubmitGatewayTask(w http.ResponseWriter,r *http.Request){
	var req service.GatewaySubmit
	if json.NewDecoder(http.MaxBytesReader(w,r.Body,2<<20)).Decode(&req)!=nil{Fail(w,"请求格式错误");return}
	result,err:=service.SubmitGatewayTask(r.Context(),req);if err!=nil{FailError(w,err);return};OK(w,result)
}

func GatewayTaskByRequest(w http.ResponseWriter,r *http.Request,id string){
	result,found,err:=service.GatewayTaskByRequest(r.Context(),id)
	if err!=nil{FailError(w,err);return};if !found{FailWithStatus(w,http.StatusNotFound,"任务不存在");return};OK(w,result)
}

func UploadGatewayMedia(w http.ResponseWriter,r *http.Request){
	r.Body=http.MaxBytesReader(w,r.Body,service.GatewayMediaLimit+(1<<20))
	if err:=r.ParseMultipartForm(8<<20);err!=nil{Fail(w,"文件过大或上传格式错误");return}
	if r.MultipartForm!=nil{defer r.MultipartForm.RemoveAll()}
	file,header,err:=r.FormFile("file");if err!=nil{Fail(w,"请选择参考素材");return};defer file.Close()
	result,err:=service.UploadGatewayMedia(r.Context(),file,header);if err!=nil{FailError(w,err);return};OK(w,result)
}

func GatewayMediaContent(w http.ResponseWriter,r *http.Request,id string){
	file,mime,err:=service.OpenGatewayMedia(id,r.URL.Query().Get("token"));if err!=nil{http.NotFound(w,r);return};defer file.Close()
	info,err:=file.Stat();if err!=nil{http.NotFound(w,r);return}
	w.Header().Set("Content-Type",mime);w.Header().Set("X-Content-Type-Options","nosniff");w.Header().Set("Cache-Control","private, no-store")
	http.ServeContent(w,r,"reference",info.ModTime(),file)
}

func serveGatewayVideoContent(w http.ResponseWriter,r *http.Request,id string) bool {
	response,handled,err:=service.GatewayVideoContent(r.Context(),id,r.Header.Get("Range"))
	if !handled{return false};if err!=nil{FailError(w,err);return true};defer response.Body.Close()
	for _,key:=range []string{"Content-Type","Content-Length","Content-Range","Accept-Ranges"}{if value:=response.Header.Get(key);value!=""{w.Header().Set(key,value)}}
	w.Header().Set("Cache-Control","private, no-store");w.WriteHeader(response.StatusCode);_,_=io.Copy(w,response.Body);return true
}
