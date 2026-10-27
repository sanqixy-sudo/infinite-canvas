package handler

import (
	_ "embed"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/tigerowo/infinite-canvas/gateway/model"
	"github.com/tigerowo/infinite-canvas/gateway/service"
)

//go:embed admin.html
var adminHTML string

func respond(c *gin.Context, data any, err error) {
	if err == nil { c.JSON(http.StatusOK,gin.H{"code":0,"data":data,"msg":""}); return }
	var detail *service.Error
	if errors.As(err,&detail) { c.JSON(detail.Status,gin.H{"code":detail.Status,"data":nil,"msg":detail.Message}); return }
	c.JSON(http.StatusInternalServerError,gin.H{"code":500,"data":nil,"msg":"网关暂时无法完成请求，请检查服务状态"})
}

func Router(s *service.Service) *gin.Engine {
	r := gin.New(); r.Use(gin.Recovery())
	r.Use(func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer,c.Request.Body,1024*1024)
		c.Header("Cache-Control","no-store")
		c.Header("X-Content-Type-Options","nosniff")
		c.Header("Referrer-Policy","no-referrer")
		c.Next()
	})
	r.GET("/health",func(c *gin.Context){ respond(c,gin.H{"status":"ok"},nil) })
	r.GET("/admin",func(c *gin.Context){
		c.Header("Content-Security-Policy","default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
		c.Data(http.StatusOK,"text/html; charset=utf-8",[]byte(adminHTML))
	})
	auth := func(admin bool) gin.HandlerFunc { return func(c *gin.Context){
		if !s.Authorize(c.GetHeader("Authorization"),admin) { c.AbortWithStatusJSON(http.StatusUnauthorized,gin.H{"code":401,"data":nil,"msg":"接入密钥无效"}); return }; c.Next()
	} }
	v1 := r.Group("/v1",auth(false))
	v1.GET("/models",func(c *gin.Context){
		configs, err := s.Models(false); defs := make([]model.ModelDefinition,0,len(configs))
		for _, config := range configs { defs = append(defs,config.ModelDefinition) }
		respond(c,defs,err)
	})
	v1.POST("/tasks",func(c *gin.Context){
		var req model.Request
		if err := c.ShouldBindJSON(&req); err != nil { respond(c,nil,&service.Error{Status:400,Message:"任务参数不是有效 JSON"}); return }
		data, err := s.Submit(c.Request.Context(),req); respond(c,data,err)
	})
	v1.GET("/tasks/by-request/:requestId",func(c *gin.Context){ data,err := s.Task(c.Param("requestId"),true); respond(c,data,err) })
	v1.GET("/tasks/:id",func(c *gin.Context){ data,err := s.Task(c.Param("id"),false); respond(c,data,err) })
	admin := r.Group("/admin/api",auth(true))
	admin.GET("/models",func(c *gin.Context){ data,err := s.Models(true); respond(c,data,err) })
	admin.PUT("/models/:id",func(c *gin.Context){
		var config model.ModelConfig
		if err := c.ShouldBindJSON(&config); err != nil { respond(c,nil,&service.Error{Status:400,Message:"模型参数不是有效 JSON"}); return }
		config.ID = c.Param("id"); respond(c,nil,s.SaveModel(config))
	})
	admin.DELETE("/models/:id",func(c *gin.Context){ respond(c,nil,s.DisableModel(c.Param("id"))) })
	admin.GET("/channels",func(c *gin.Context){ data,err := s.Channels(); respond(c,data,err) })
	admin.PUT("/channels/:id",func(c *gin.Context){
		var input model.ChannelInput
		if err := c.ShouldBindJSON(&input); err != nil { respond(c,nil,&service.Error{Status:400,Message:"渠道参数不是有效 JSON"}); return }
		input.ID = c.Param("id"); respond(c,nil,s.SaveChannel(input))
	})
	admin.DELETE("/channels/:id",func(c *gin.Context){ respond(c,nil,s.DeleteChannel(c.Param("id"))) })
	admin.GET("/tasks/by-request/:requestId",func(c *gin.Context){ data,err := s.Task(c.Param("requestId"),true); respond(c,data,err) })
	admin.POST("/tasks/:id/resolve",func(c *gin.Context){
		var input struct { UpstreamID string `json:"upstreamId"` }
		if err := c.ShouldBindJSON(&input); err != nil { respond(c,nil,&service.Error{Status:400,Message:"请输入上游任务 ID"}); return }
		data,err := s.ResolveSubmission(c.Param("id"),input.UpstreamID); respond(c,data,err)
	})
	return r
}
