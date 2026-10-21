package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

const localStorageProviderID = "storage-local"

var ErrStorageAccessDenied = errors.New("无权访问该文件")

type StorageObjectDetails struct {
	model.StorageObject
	ContentURL string `json:"contentUrl"`
}

func localStorageProvider() model.StorageProvider {
	return model.StorageProvider{ID: localStorageProviderID, Name: "服务器本地", Type: model.StorageProviderTypeLocal, Enabled: true, Weight: 1}
}

func publicStorageSetting(storage model.PrivateStorageSetting) model.PublicStorageSetting {
	return model.PublicStorageSetting{Mode: storage.Mode, AllowUserProvider: storage.AllowUserProvider, AllowUserGlobalProvider: storage.AllowUserGlobalProvider}
}

func validateStorageMode(storage model.PrivateStorageSetting) error {
	if storage.Mode != "local" && storage.Mode != "r2" {
		return safeMessageError{message: "存储模式只支持本地或 R2 / S3"}
	}
	if storage.Mode == "r2" && !HasAdminStorageProvider(storage) {
		return safeMessageError{message: "切换 R2 前请先配置并启用完整的 R2 / S3 存储"}
	}
	return nil
}

// 切换模式不迁移文件；有文件引用的旧渠道必须保留，才能继续读取和删除。
func protectStoredProviderLocations(saved, incoming model.PrivateStorageSetting) error {
	for _, old := range saved.Providers {
		unchanged := false
		for _, next := range incoming.Providers {
			if next.ID == old.ID && next.Type == old.Type && next.Endpoint == old.Endpoint && next.Bucket == old.Bucket {
				unchanged = true
				break
			}
		}
		if unchanged {
			continue
		}
		count, err := repository.CountStorageObjectsForProvider(old.ID)
		if err != nil {
			return err
		}
		if count > 0 {
			return safeMessageError{message: "该存储仍有文件引用，请保留原配置；可停用新上传，但不能删除配置或修改地址和存储桶"}
		}
	}
	return nil
}

func storageObjectOwnedBy(ctx context.Context, object model.StorageObject) bool {
	user, ok := UserFromContext(ctx)
	return ok && user.ID != "" && (user.ID == object.CreatedBy || user.Role == model.UserRoleAdmin)
}

// 媒体标签和模型供应商不能携带登录请求头，使用一小时、仅对单文件有效的访问凭证。
func storageContentURL(object model.StorageObject) (string, error) {
	claims := jwt.RegisteredClaims{Issuer: "xiaomeng-storage", Subject: object.ID, Audience: jwt.ClaimStrings{object.CreatedBy}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(config.Cfg.JWTSecret))
	if err != nil {
		return "", err
	}
	return "/api/files/" + url.PathEscape(object.ID) + "/content?access=" + url.QueryEscape(token), nil
}

// 管理员已发布到公共素材/提示词库的文件，每次列表读取时更新访问凭证。
func refreshPublishedStorageURL(value string) string {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host != "" {
		return value
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) != 4 || parts[0] != "api" || parts[1] != "files" || parts[3] != "content" {
		return value
	}
	object, err := repository.GetStorageObject(parts[2])
	if err != nil {
		return value
	}
	if signed, err := storageContentURL(object); err == nil {
		return signed
	}
	return value
}

func validStorageContentToken(object model.StorageObject, value string) bool {
	if value == "" || config.Cfg.JWTSecret == "" {
		return false
	}
	claims := jwt.RegisteredClaims{}
	token, err := jwt.ParseWithClaims(value, &claims, func(token *jwt.Token) (any, error) {
		return []byte(config.Cfg.JWTSecret), nil
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer("xiaomeng-storage"), jwt.WithSubject(object.ID), jwt.WithAudience(object.CreatedBy), jwt.WithExpirationRequired())
	return err == nil && token.Valid
}

func localStorageDirectory() string {
	if strings.TrimSpace(config.Cfg.LocalStorageDir) != "" {
		return config.Cfg.LocalStorageDir
	}
	return "data/storage"
}

func openLocalStorageRoot() (*os.Root, error) {
	directory := localStorageDirectory()
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, err
	}
	return os.OpenRoot(directory)
}

func localObjectPath(key string) (string, error) {
	if strings.ContainsAny(key, "\\:\x00") || strings.HasPrefix(key, "/") {
		return "", errors.New("本地文件路径无效")
	}
	clean, err := cleanStoragePath(key)
	if err != nil || clean != key || !filepath.IsLocal(filepath.FromSlash(clean)) {
		return "", errors.New("本地文件路径无效")
	}
	return filepath.FromSlash(clean), nil
}

func putLocalObject(key string, data []byte) error {
	name, err := localObjectPath(key)
	if err != nil {
		return err
	}
	root, err := openLocalStorageRoot()
	if err != nil {
		return err
	}
	defer root.Close()
	if err := root.MkdirAll(filepath.Dir(name), 0o700); err != nil {
		return err
	}
	file, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	_, writeErr := file.Write(data)
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		_ = root.Remove(name)
		return errors.Join(writeErr, closeErr)
	}
	return nil
}

func getLocalObjectStream(key, rangeHeader string) (storageObjectStream, error) {
	name, err := localObjectPath(key)
	if err != nil {
		return storageObjectStream{}, err
	}
	root, err := openLocalStorageRoot()
	if err != nil {
		return storageObjectStream{}, err
	}
	defer root.Close()
	file, err := root.Open(name)
	if err != nil {
		return storageObjectStream{}, err
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		_ = file.Close()
		return storageObjectStream{}, errors.New("本地文件不可用")
	}
	size := info.Size()
	if strings.TrimSpace(rangeHeader) == "" {
		return storageObjectStream{Body: file, StatusCode: http.StatusOK, ContentLength: size, AcceptRanges: true}, nil
	}
	byteRange, ok := parseStorageByteRange(rangeHeader, size)
	if !ok {
		_ = file.Close()
		return storageObjectStream{Body: io.NopCloser(strings.NewReader("")), StatusCode: http.StatusRequestedRangeNotSatisfiable, ContentLength: 0, ContentRange: fmt.Sprintf("bytes */%d", size), AcceptRanges: true}, nil
	}
	if _, err := file.Seek(byteRange.offset, io.SeekStart); err != nil {
		_ = file.Close()
		return storageObjectStream{}, err
	}
	return storageObjectStream{Body: &localRangeStream{Reader: io.LimitReader(file, byteRange.length), Closer: file}, StatusCode: http.StatusPartialContent, ContentLength: byteRange.length, ContentRange: fmt.Sprintf("bytes %d-%d/%d", byteRange.offset, byteRange.offset+byteRange.length-1, size), AcceptRanges: true}, nil
}

type localRangeStream struct {
	io.Reader
	io.Closer
}

func deleteLocalObject(key string) error {
	name, err := localObjectPath(key)
	if err != nil {
		return err
	}
	root, err := openLocalStorageRoot()
	if err != nil {
		return err
	}
	defer root.Close()
	err = root.Remove(name)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	return err
}

func measureLocalStorage() (int64, error) {
	root, err := openLocalStorageRoot()
	if err != nil {
		return 0, err
	}
	defer root.Close()
	var size int64
	err = fs.WalkDir(root.FS(), ".", func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		info, err := entry.Info()
		if err == nil && info.Mode().IsRegular() {
			size += info.Size()
		}
		return err
	})
	return size, err
}
