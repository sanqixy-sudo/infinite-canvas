package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/service"
)

// StorageConfig 返回公开存储配置。
func StorageConfig(w http.ResponseWriter, r *http.Request) {
	config, err := service.PublicStorageConfig()
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, config)
}

// SaveUserStorageProvider 保存用户配置的存储提供商。
func SaveUserStorageProvider(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Provider service.UserStorageProviders `json:"provider"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		Fail(w, "配置内容格式错误")
		return
	}
	config, err := service.SaveCurrentUserStorageProvider(r.Context(), request.Provider)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, config)
}

// MeasureUserStorageProvider 统计用户存储提供商的已用容量。
func MeasureUserStorageProvider(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Provider service.StorageObjectProviderInput `json:"provider"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		Fail(w, "配置内容格式错误")
		return
	}
	result, err := service.MeasureUserStorageProvider(r.Context(), request.Provider)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

// UploadFile 上传文件到对象存储。
func UploadFile(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 129<<20)
	file, header, err := r.FormFile("file")
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	if err != nil {
		Fail(w, "请选择文件，单个文件不能超过 128 MB")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, (128<<20)+1))
	if err != nil || len(data) > 128<<20 {
		Fail(w, "读取文件失败，单个文件不能超过 128 MB")
		return
	}
	contentType := header.Header.Get("Content-Type")
	if strings.TrimSpace(contentType) == "" {
		contentType = http.DetectContentType(data)
	}
	var provider *service.StorageObjectProviderInput
	if raw := strings.TrimSpace(r.FormValue("provider")); raw != "" {
		var parsed service.StorageObjectProviderInput
		if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
			Fail(w, "用户对象存储配置格式错误")
			return
		}
		provider = &parsed
	}
	object, err := service.UploadStorageObjectWithProvider(r.Context(), header.Filename, contentType, data, provider)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, object)
}

// RegisterDirectFile 登记浏览器已直传至用户 WebDAV 的文件。
func RegisterDirectFile(w http.ResponseWriter, r *http.Request) {
	var request service.DirectStorageObjectInput
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		Fail(w, "文件信息格式错误")
		return
	}
	object, err := service.RegisterDirectStorageObject(r.Context(), request)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, object)
}

// DeleteFile 删除文件。
func DeleteFile(w http.ResponseWriter, r *http.Request, id string) {
	w.Header().Set("Cache-Control", "no-store")
	var request struct {
		Provider           *service.StorageObjectProviderInput `json:"provider"`
		RemoveAssetRecords bool                                `json:"removeAssetRecords"`
	}
	if r.Body != nil {
		r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil && !errors.Is(err, io.EOF) {
			Fail(w, "删除请求格式无效")
			return
		}
		if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
			Fail(w, "删除请求只能包含一个 JSON 对象")
			return
		}
	}
	result, err := service.DeleteCurrentUserStorageFile(r.Context(), id, request.RemoveAssetRecords, request.Provider)
	if err != nil {
		if errors.Is(err, service.ErrStorageAccessDenied) {
			FailWithStatus(w, http.StatusForbidden, "无权删除该文件")
			return
		}
		FailError(w, err)
		return
	}
	OK(w, result)
}

func UserStorageFiles(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	result, err := service.CurrentUserStorageFiles(r.Context(), parseQuery(r))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func UserStorageFileReferences(w http.ResponseWriter, r *http.Request, id string) {
	w.Header().Set("Cache-Control", "no-store")
	result, err := service.CurrentUserStorageFileReferences(r.Context(), id)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

// DeleteDirectFileRecord 删除浏览器已直接删除的 WebDAV 文件索引。
func DeleteDirectFileRecord(w http.ResponseWriter, r *http.Request, id string) {
	w.Header().Set("Cache-Control", "no-store")
	if err := service.DeleteDirectStorageObjectRecord(r.Context(), id); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}

// FileContent 获取文件内容。
func FileContent(w http.ResponseWriter, r *http.Request, id string) {
	download, err := service.DownloadStorageObject(r.Context(), id, r.Header.Get("Range"), r.URL.Query().Get("access"))
	if err != nil {
		if errors.Is(err, service.ErrStorageAccessDenied) {
			FailWithStatus(w, http.StatusForbidden, "无权访问该文件或访问凭证已过期")
			return
		}
		FailError(w, err)
		return
	}
	defer download.Stream.Close()
	w.Header().Set("Content-Type", download.Object.MimeType)
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	if !strings.HasPrefix(download.Object.MimeType, "image/") && !strings.HasPrefix(download.Object.MimeType, "video/") && !strings.HasPrefix(download.Object.MimeType, "audio/") {
		w.Header().Set("Content-Disposition", "attachment")
	}
	if download.AcceptRanges {
		w.Header().Set("Accept-Ranges", "bytes")
	}
	if download.ContentRange != "" {
		w.Header().Set("Content-Range", download.ContentRange)
	}
	if download.ContentLength >= 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(download.ContentLength, 10))
	}
	if download.StatusCode != 0 {
		w.WriteHeader(download.StatusCode)
	}
	if r.Method == http.MethodHead {
		return
	}
	_, _ = io.Copy(w, download.Stream)
}

// FileInfo 获取文件元数据。
func FileInfo(w http.ResponseWriter, r *http.Request, id string) {
	object, err := service.StorageObjectInfo(r.Context(), id)
	if err != nil {
		if errors.Is(err, service.ErrStorageAccessDenied) {
			FailWithStatus(w, http.StatusForbidden, "无权访问该文件")
			return
		}
		FailError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	OK(w, object)
}

func setStorageReadSession(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	setStorageReadToken(w, r, token)
}

func setStorageReadToken(w http.ResponseWriter, r *http.Request, token string) {
	if token == "" {
		return
	}
	claims, err := service.ParseToken(token)
	if err != nil || claims.ExpiresAt == nil {
		return
	}
	maxAge := int(time.Until(claims.ExpiresAt.Time).Seconds())
	if maxAge <= 0 {
		return
	}
	storageReadCookie(w, r, "", "/api/files", -1)
	storageReadCookie(w, r, token, "/api", maxAge)
}

func ClearStorageSession(w http.ResponseWriter, r *http.Request) {
	storageReadCookie(w, r, "", "/api/files", -1)
	storageReadCookie(w, r, "", "/api", -1)
	OK(w, true)
}

func SetStorageSession(w http.ResponseWriter, r *http.Request) {
	setStorageReadSession(w, r)
	w.Header().Set("Cache-Control", "private, no-store")
	OK(w, true)
}

func storageReadCookie(w http.ResponseWriter, r *http.Request, value, path string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: "xiaomeng_storage_viewer", Value: value, Path: path, MaxAge: maxAge, HttpOnly: true, Secure: r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https"), SameSite: http.SameSiteLaxMode})
}

// AdminMeasureStorageProvider 管理员统计存储容量。
func AdminMeasureStorageProvider(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Index int `json:"index"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		Fail(w, "配置内容格式错误")
		return
	}
	result, err := service.MeasureAdminStorageProvider(request.Index)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

// ProxyImage 代理图片请求（解决跨域和机器人检测问题）。
func ProxyImage(w http.ResponseWriter, r *http.Request) {
	targetURL := r.URL.Query().Get("url")
	if targetURL == "" {
		Fail(w, "url 参数不能为空")
		return
	}
	if !strings.HasPrefix(targetURL, "http://") && !strings.HasPrefix(targetURL, "https://") {
		Fail(w, "无效的 url")
		return
	}
	client := service.SafeProxyHTTPClient()
	req, err := http.NewRequest(http.MethodGet, targetURL, nil)
	if err != nil {
		FailError(w, err)
		return
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Pragma", "no-cache")

	resp, err := client.Do(req)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "代理图片请求失败")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		FailWithStatus(w, http.StatusBadGateway, "代理图片请求失败: "+resp.Status)
		return
	}
	contentType := resp.Header.Get("Content-Type")
	isImage := strings.HasPrefix(contentType, "image/")
	var data []byte
	if isImage {
		data, err = io.ReadAll(resp.Body)
		if err != nil {
			FailWithStatus(w, http.StatusBadGateway, "代理图片请求失败")
			return
		}
	}
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	} else {
		w.Header().Set("Content-Type", "application/octet-stream")
	}
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(resp.StatusCode)
	if isImage {
		_, _ = w.Write(data)
		return
	}
	_, _ = io.Copy(w, resp.Body)
}
