package service

import (
	"context"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/repository"
)

const GatewayMediaLimit int64 = 256 << 20
const gatewayMediaLifetime = 72 * time.Hour
var gatewayMediaMu sync.Mutex
var gatewayMediaCleanupOnce sync.Once

type gatewayMediaClaims struct { MIME string `json:"mime"`; jwt.RegisteredClaims }

func gatewayMediaDir() string { return filepath.Join(filepath.Dir(config.Cfg.LocalStorageDir),"gateway-inputs") }

func StartGatewayMediaCleanup() {
	gatewayMediaCleanupOnce.Do(func(){go func(){
		for {
			gatewayMediaMu.Lock()
			dir:=gatewayMediaDir();entries,_:=os.ReadDir(dir)
			for _,e:=range entries{if e.IsDir(){continue};info,err:=e.Info();if err==nil && time.Since(info.ModTime())>gatewayMediaLifetime{_=os.Remove(filepath.Join(dir,e.Name()))}}
			gatewayMediaMu.Unlock()
			time.Sleep(time.Hour)
		}
	}()})
}

func UploadGatewayMedia(ctx context.Context, file multipart.File, header *multipart.FileHeader) (map[string]any,error) {
	user,err:=commerceUser(ctx,false);if err!=nil{return nil,err}
	s,err:=repository.GetSettings();if err!=nil{return nil,err}
	base,err:=url.Parse(s.Private.Gateway.MediaBaseURL)
	if err!=nil || base==nil || base.Host=="" || base.Scheme!="https" { return nil,safeMessageError{message:"管理员须配置可由上游读取的 HTTPS 素材访问域名"} }
	if header.Size<=0 || header.Size>GatewayMediaLimit { return nil,safeMessageError{message:"临时参考素材须小于 256 MB"} }
	prefix:=make([]byte,512); n,readErr:=file.Read(prefix)
	if readErr!=nil && readErr!=io.EOF{return nil,readErr}
	mime:=http.DetectContentType(prefix[:n])
	allowed:=map[string]bool{"image/jpeg":true,"image/png":true,"image/webp":true,"image/gif":true,"video/mp4":true,"video/webm":true,"video/quicktime":true,"audio/mpeg":true,"audio/wave":true,"audio/wav":true,"audio/x-wav":true,"audio/ogg":true,"application/ogg":true,"audio/mp4":true}
	if !allowed[mime] { return nil,safeMessageError{message:"请上传常见图片、MP4/WebM 视频或 MP3/WAV/OGG 音频文件"} }
	if _,err=file.Seek(0,io.SeekStart);err!=nil{return nil,err}
	gatewayMediaMu.Lock();defer gatewayMediaMu.Unlock()
	dir:=gatewayMediaDir();if err=os.MkdirAll(dir,0700);err!=nil{return nil,err}
	owner:=gatewayHash(user.ID)[:24]+"_"
	entries,err:=os.ReadDir(dir);if err!=nil{return nil,err}
	var used int64
	for _,e:=range entries { if e.IsDir(){continue}; info,eerr:=e.Info();if eerr!=nil{continue};if time.Since(info.ModTime())>gatewayMediaLifetime { _=os.Remove(filepath.Join(dir,e.Name()));continue };if strings.HasPrefix(e.Name(),owner){used+=info.Size()} }
	if used+header.Size>1<<30 { return nil,safeMessageError{message:"临时参考素材已达 1 GB，请等待临时文件过期后重试"} }
	id:=owner+newID("ref")
	path:=filepath.Join(dir,id)
	out,err:=os.OpenFile(path,os.O_WRONLY|os.O_CREATE|os.O_EXCL,0600);if err!=nil{return nil,err}
	size,copyErr:=io.Copy(out,io.LimitReader(file,GatewayMediaLimit+1));closeErr:=out.Close()
	if copyErr!=nil || closeErr!=nil || size!=header.Size || size>GatewayMediaLimit { _=os.Remove(path);return nil,errors.New("临时文件写入未完成") }
	expires:=time.Now().Add(gatewayMediaLifetime)
	claims:=gatewayMediaClaims{MIME:mime,RegisteredClaims:jwt.RegisteredClaims{Subject:id,Audience:jwt.ClaimStrings{"gateway-media"},ExpiresAt:jwt.NewNumericDate(expires)}}
	token,err:=jwt.NewWithClaims(jwt.SigningMethodHS256,claims).SignedString([]byte(config.Cfg.JWTSecret));if err!=nil{_=os.Remove(path);return nil,err}
	return map[string]any{"url":strings.TrimRight(base.String(),"/")+"/api/model-gateway/media/"+url.PathEscape(id)+"/content?token="+url.QueryEscape(token),"expiresAt":expires.Format(time.RFC3339)},nil
}

func OpenGatewayMedia(id,token string)(*os.File,string,error){
	if id=="" || filepath.Base(id)!=id || strings.ContainsAny(id,"/\\") {return nil,"",errors.New("无效文件")}
	var claims gatewayMediaClaims
	_,err:=jwt.ParseWithClaims(token,&claims,func(_ *jwt.Token)(any,error){return []byte(config.Cfg.JWTSecret),nil},jwt.WithValidMethods([]string{"HS256"}),jwt.WithAudience("gateway-media"),jwt.WithExpirationRequired())
	if err!=nil || claims.Subject!=id{return nil,"",errors.New("临时素材链接已过期或无效")}
	f,err:=os.Open(filepath.Join(gatewayMediaDir(),id));return f,claims.MIME,err
}

func GatewayVideoContent(ctx context.Context,id,byteRange string)(*http.Response,bool,error){
	user,err:=commerceUser(ctx,false);if err!=nil{return nil,false,err}
	task,found,err:=repository.GetUserVideoTask(user.ID,id)
	if err!=nil || !found || task.GatewaySnapshot==""{return nil,false,err}
	if task.Status!="completed" || task.VideoURL==""{return nil,true,errors.New("视频结果尚未就绪")}
	req,err:=http.NewRequestWithContext(ctx,http.MethodGet,task.VideoURL,nil);if err!=nil{return nil,true,err}
	if byteRange!=""{req.Header.Set("Range",byteRange)}
	response,err:=SafeProxyHTTPClient().Do(req)
	return response,true,err
}
