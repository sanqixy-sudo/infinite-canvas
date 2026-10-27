package middleware

import (
	"github.com/gin-gonic/gin"
	"github.com/tigerowo/infinite-canvas/handler"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
	"net/http"
	"strings"
)

// StorageReadAuth 仅为媒体内容读取接受 HttpOnly 会话；写接口仍须 Bearer 登录鉴权。
func StorageReadAuth(c *gin.Context) {
	if user, ok := storageReadUser(c); ok {
		c.Request = c.Request.WithContext(service.WithUser(c.Request.Context(), user))
	}
	c.Next()
}

// ReadUserAuth 仅用于需要登录的只读资源，允许媒体标签携带 HttpOnly 会话。
func ReadUserAuth(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	user, ok := storageReadUser(c)
	if !ok || user.Role == model.UserRoleGuest {
		handler.FailWithStatus(c.Writer, http.StatusUnauthorized, "未登录或登录已失效")
		c.Abort()
		return
	}
	c.Request = c.Request.WithContext(service.WithUser(c.Request.Context(), user))
	c.Next()
}

func storageReadUser(c *gin.Context) (model.AuthUser, bool) {
	if strings.TrimSpace(c.GetHeader("Authorization")) != "" {
		return authUser(c)
	}
	if value, err := c.Cookie("xiaomeng_storage_viewer"); err == nil {
		return service.CurrentAuthUser(value)
	}
	return model.AuthUser{}, false
}
