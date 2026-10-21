package middleware

import (
	"github.com/gin-gonic/gin"
	"github.com/tigerowo/infinite-canvas/service"
)

// StorageReadAuth 仅为媒体内容读取接受 HttpOnly 会话；写接口仍须 Bearer 登录鉴权。
func StorageReadAuth(c *gin.Context) {
	if user, ok := authUser(c); ok {
		c.Request = c.Request.WithContext(service.WithUser(c.Request.Context(), user))
	} else if value, err := c.Cookie("xiaomeng_storage_viewer"); err == nil {
		if user, ok := service.CurrentAuthUser(value); ok {
			c.Request = c.Request.WithContext(service.WithUser(c.Request.Context(), user))
		}
	}
	c.Next()
}
