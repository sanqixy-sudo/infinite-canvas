package service

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/tigerowo/infinite-canvas/gateway/model"
	"github.com/tigerowo/infinite-canvas/gateway/repository"
	"gorm.io/gorm"
)

type Error struct { Status int; Message string }
func (e *Error) Error() string { return e.Message }
func failure(status int, msg string) error { return &Error{Status:status, Message:msg} }

type Service struct {
	store *repository.Store
	client *http.Client
	seal cipher.AEAD
	apiToken string
	adminToken string
}

func New(store *repository.Store, apiToken, adminToken, encryptionKey string) (*Service, error) {
	if len(apiToken) < 32 || len(adminToken) < 32 || apiToken == adminToken { return nil, fmt.Errorf("网关 API 与管理员密钥须各至少 32 字符且不能相同") }
	key, err := base64.StdEncoding.DecodeString(encryptionKey)
	if err != nil || len(key) != 32 { return nil, fmt.Errorf("GATEWAY_ENCRYPTION_KEY 必须为 32 字节随机密钥的 Base64") }
	block, err := aes.NewCipher(key); if err != nil { return nil, err }
	seal, err := cipher.NewGCM(block); if err != nil { return nil, err }
	s := &Service{store:store, seal:seal, apiToken:apiToken, adminToken:adminToken, client:&http.Client{Timeout:45*time.Second, CheckRedirect:func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}}
	if err = store.RecoverSubmissions(); err != nil { return nil, err }
	rows, err := store.Models(false); if err != nil { return nil, err }
	if len(rows) == 0 { for _, config := range DefaultModels() { if err = store.SaveModel(config); err != nil { break } } }
	return s, err
}

func (s *Service) Authorize(header string, admin bool) bool {
	token := s.apiToken; if admin { token = s.adminToken }
	return subtle.ConstantTimeCompare([]byte(header), []byte("Bearer "+token)) == 1
}

func (s *Service) encrypt(secret string) (string, error) {
	nonce := make([]byte, s.seal.NonceSize()); if _, err := rand.Read(nonce); err != nil { return "", err }
	return base64.StdEncoding.EncodeToString(s.seal.Seal(nonce, nonce, []byte(secret), nil)), nil
}
func (s *Service) decrypt(secret string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(secret)
	if err != nil || len(data) < s.seal.NonceSize() { return "", fmt.Errorf("渠道密钥损坏") }
	plain, err := s.seal.Open(nil, data[:s.seal.NonceSize()], data[s.seal.NonceSize():], nil)
	return string(plain), err
}

func (s *Service) Models(admin bool) ([]model.ModelConfig, error) {
	rows, err := s.store.Models(!admin); if err != nil { return nil, err }
	result := make([]model.ModelConfig, 0, len(rows))
	for _, row := range rows {
		var config model.ModelConfig; if err := json.Unmarshal([]byte(row.ConfigJSON), &config); err != nil { return nil, err }
		if !admin {
			if err := ValidateDefinition(config.ModelDefinition); err != nil { return nil, failure(409,config.Name+" 配置需要重新核对并发布："+err.Error()) }
			if err := s.validateRoutes(config); err != nil { continue }
		}
		result = append(result, config)
	}
	return result, nil
}

func (s *Service) SaveModel(config model.ModelConfig) error {
	aggregateVariants(&config.ModelDefinition)
	if err := ValidateDefinition(config.ModelDefinition); err != nil { return failure(400, err.Error()) }
	if err := s.validateRoutes(config); err != nil { return failure(400,err.Error()) }
	if config.Enabled && !config.PricingConfirmed { return failure(400,"发布前请核对并确认原价和当前渠道能力") }
	if len(config.Variants)==0 && config.ChannelID != "" {
		channel, err := s.store.Channel(config.ChannelID)
		if err != nil || (config.Enabled && !channel.Enabled) { return failure(400, "请选择已配置且可用的渠道") }
	} else if len(config.Variants)==0 && config.Enabled { return failure(400, "启用模型前必须配置渠道") }
	old, err := s.store.Model(config.ID)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) { return err }
	if err == nil {
		var prior model.ModelConfig; if err := json.Unmarshal([]byte(old.ConfigJSON), &prior); err != nil { return err }
		prior.Enabled = config.Enabled
		prior.PricingConfirmed = config.PricingConfirmed
		previous, _ := json.Marshal(prior); current, _ := json.Marshal(config)
		if string(previous) != string(current) && prior.Revision == config.Revision { return failure(409, "能力、价格或渠道变更必须填写新的 revision；仅启停可沿用原版本") }
	}
	if err:=s.store.SaveModelIfUnchanged(config,old.ConfigJSON);errors.Is(err,repository.ErrModelChanged){return failure(409,err.Error())}else{return err}
}

func (s *Service) DisableModel(id string) error {
	row, err := s.store.Model(id); if err != nil { return recordError(err) }
	var config model.ModelConfig; if err := json.Unmarshal([]byte(row.ConfigJSON), &config); err != nil { return err }
	config.Enabled = false
	if err:=s.store.SaveModelIfUnchanged(config,row.ConfigJSON);errors.Is(err,repository.ErrModelChanged){return failure(409,err.Error())}else{return err}
}

func (s *Service) Channels() ([]model.Channel, error) { return s.store.Channels() }
func (s *Service) SaveChannel(input model.ChannelInput) error {
	if strings.TrimSpace(input.ID) == "" || len(input.ID) > 128 || strings.TrimSpace(input.Name) == "" { return failure(400, "渠道 ID 与名称必填，ID 最多 128 字符") }
	u, err := url.Parse(input.BaseURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" { return failure(400, "渠道地址须为 HTTP(S) 地址，不含账号、查询或片段") }
	if input.SubmitPath == "" { input.SubmitPath = "/xiaomeng-newtoken/api/v3/contents/generations/tasks" }
	if input.QueryPath == "" { input.QueryPath = input.SubmitPath+"/{id}" }
	for _, path := range []string{input.SubmitPath,input.QueryPath} {
		if !strings.HasPrefix(path,"/") || strings.HasPrefix(path,"//") || strings.Contains(path, "://") || strings.ContainsAny(path, "?#") { return failure(400, "任务路径须为站内绝对路径，不含查询或片段") }
	}
	if strings.Count(input.QueryPath, "{id}") != 1 { return failure(400, "查询路径须含一个 {id}") }
	row, err := s.store.Channel(input.ID)
	if err != nil && !errors.Is(err,gorm.ErrRecordNotFound) { return err }
	if input.APIKey != "" { row.Secret, err = s.encrypt(input.APIKey); if err != nil { return err } }
	if row.Secret == "" { return failure(400, "新渠道必须填写你的 New API 接入密钥") }
	row.ID, row.Name, row.BaseURL = input.ID, input.Name, strings.TrimRight(input.BaseURL,"/")
	row.SubmitPath, row.QueryPath, row.Enabled = input.SubmitPath, input.QueryPath, input.Enabled
	return s.store.SaveChannel(&row)
}

func (s *Service) DeleteChannel(id string) error {
	models,err:=s.Models(true);if err!=nil{return err};for _,config:=range models{for _,route:=range config.Routes{if route.ChannelID==id{return failure(409,"渠道仍被模型规格引用，请停用而非删除")}}}
	refs, err := s.store.ChannelReferences(id); if err != nil { return err }
	if refs > 0 { return failure(409, "渠道已有模型或历史任务引用，请停用而非删除") }
	return s.store.DeleteChannel(id)
}

func recordError(err error) error { if errors.Is(err,gorm.ErrRecordNotFound) { return failure(404,"记录不存在") }; return err }

func result(task model.Task) model.TaskResult {
	var req model.Request; _ = json.Unmarshal([]byte(task.RequestJSON), &req)
	r := model.TaskResult{ID:task.ID, RequestID:task.RequestID, Model:req.Model, Revision:req.Revision, VariantID:req.VariantID, Status:task.Status, BillingStatus:task.BillingStatus, VideoURL:task.VideoURL, Error:task.Error, Progress:task.Progress, Parameters:req.Parameters, CreatedAt:task.CreatedAt.UTC().Format(time.RFC3339), UpdatedAt:task.UpdatedAt.UTC().Format(time.RFC3339)}
	if task.BillingStatus == "usage_available" || task.TotalTokens > 0 || task.InputTokens != nil || task.OutputTokens != nil || task.Units != nil { r.Usage = &model.Usage{TotalTokens:task.TotalTokens,InputTokens:task.InputTokens,OutputTokens:task.OutputTokens,Units:task.Units} }
	return r
}

func (s *Service) Task(id string, byRequest bool) (model.TaskResult,error) {
	var task model.Task; var err error
	if byRequest { task, err = s.store.TaskByRequest(id) } else { task, err = s.store.Task(id) }
	if err != nil { return model.TaskResult{}, recordError(err) }
	return result(task), nil
}

func (s *Service) Submit(ctx context.Context, req model.Request) (model.TaskResult,error) {
	encoded, err := json.Marshal(req); if err != nil { return model.TaskResult{}, err }
	hash := sha256.Sum256(encoded); hashString := hex.EncodeToString(hash[:])
	prior, err := s.store.TaskByRequest(req.RequestID)
	if err == nil { return repeatResult(prior,hashString) }
	if !errors.Is(err,gorm.ErrRecordNotFound) { return model.TaskResult{}, err }
	record, err := s.store.Model(req.Model); if err != nil { return model.TaskResult{}, recordError(err) }
	var config model.ModelConfig; if err := json.Unmarshal([]byte(record.ConfigJSON), &config); err != nil { return model.TaskResult{}, err }
	if !config.Enabled { return model.TaskResult{}, failure(400,"当前模型未开放") }
	if err := ValidateRequest(config.ModelDefinition, req); err != nil { return model.TaskResult{}, failure(400,err.Error()) }
	config,err=resolveConfig(config,req);if err!=nil{return model.TaskResult{},failure(400,err.Error())}
	if err:=s.validateRoute(config.ChannelID,config.UpstreamModel,config.Adapter,config.Capabilities,config.Pricing,true);err!=nil{return model.TaskResult{},failure(400,err.Error())}
	if err := validateInputHosts(ctx, req.Inputs); err != nil { return model.TaskResult{}, failure(400,err.Error()) }
	channel, err := s.store.Channel(config.ChannelID)
	if err != nil || !channel.Enabled { return model.TaskResult{}, failure(400,"模型渠道不可用") }
	// Store an encrypted credential snapshot so channel edits do not reroute old tasks.
	snapshot, _ := json.Marshal(channelSnapshot{Channel:channel, Secret:channel.Secret})
	resolvedJSON,_:=json.Marshal(config)
	task := model.Task{ID:uuid.NewString(), RequestID:req.RequestID, PayloadHash:hashString, RequestJSON:string(encoded), ConfigJSON:string(resolvedJSON), ChannelJSON:string(snapshot), ChannelID:channel.ID, Status:"submitting", BillingStatus:"pending"}
	created, err := s.store.CreateTask(&task); if err != nil { return model.TaskResult{}, err }
	if !created { prior, err = s.store.TaskByRequest(req.RequestID); if err != nil { return model.TaskResult{}, err }; return repeatResult(prior,hashString) }
	// Once persisted, browser disconnects must not interrupt the upstream acknowledgement.
	submitCtx, cancel := context.WithTimeout(context.Background(),45*time.Second); defer cancel()
	s.submitUpstream(submitCtx, &task, channel, req)
	if err := s.store.SaveTask(&task); err != nil { return model.TaskResult{}, err }
	return result(task), nil
}

func repeatResult(task model.Task, hash string) (model.TaskResult,error) {
	if task.PayloadHash != hash { return model.TaskResult{}, failure(409,"requestId 已用于不同参数，不能重复生成或更改原请求") }
	return result(task), nil
}

type channelSnapshot struct { model.Channel; Secret string `json:"secret"` }
