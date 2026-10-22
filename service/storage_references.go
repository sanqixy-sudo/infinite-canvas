package service

import (
	"encoding/json"
	"errors"
	"net/url"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

// Only media fields are references; mentioning a file in a title or prompt is not.
func storageMediaValues(raw string) ([]string, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return nil, err
	}
	values := []string{}
	var walk func(any, string)
	walk = func(value any, key string) {
		key = strings.ToLower(strings.ReplaceAll(key, "_", ""))
		switch value := value.(type) {
		case map[string]any:
			for key, child := range value {
				walk(child, key)
			}
		case []any:
			for _, child := range value {
				walk(child, key)
			}
		case string:
			switch key {
			case "requestbody", "responsebody", "lastresponse", "payloadjson":
				var nested any
				if json.Unmarshal([]byte(value), &nested) == nil {
					walk(nested, "")
				}
			case "preview":
				values = append(values, strings.TrimSpace(value))
				values = append(values, extractMarkdownImages("", value)...)
			case "storagekey", "coverstoragekey", "url", "urls", "dataurl", "imageurl", "imageurls", "videourl", "audiourl", "coverurl", "thumbnailurl", "thumbnail", "src", "references", "referenceimages", "referencevideos", "referenceaudios", "referenceimage", "referencevideo", "referenceaudio", "inputreference", "inputreferences", "mask", "maskurl", "inputimage", "firstframeurl", "lastframeurl", "images", "image", "video", "audio", "fileurl", "imageid":
				values = append(values, strings.TrimSpace(value))
			}
		}
	}
	walk(value, "")
	return values, nil
}

func storageIDFromMediaValue(value string) string {
	if strings.HasPrefix(value, "server:") && !strings.HasPrefix(value, "server:webdav:") {
		id := strings.TrimPrefix(value, "server:")
		if id != "" && !strings.ContainsAny(id, "/?#\\ \t\r\n") {
			return id
		}
		return ""
	}
	parsed, err := url.Parse(value)
	if err != nil || (parsed.Scheme != "" && parsed.Scheme != "http" && parsed.Scheme != "https") {
		return ""
	}
	parts := strings.Split(parsed.Path, "/")
	if len(parts) == 5 && parts[0] == "" && parts[1] == "api" && parts[2] == "files" && parts[3] != "" && parts[4] == "content" {
		return parts[3]
	}
	return ""
}

func storageReferenceIDs(raw string) ([]string, error) {
	values, err := storageMediaValues(raw)
	if err != nil {
		return nil, safeMessageError{message: "文件引用数据格式无效，未保存或删除原数据"}
	}
	ids := []string{}
	urls := []string{}
	seen := map[string]bool{}
	for _, value := range values {
		if id := storageIDFromMediaValue(value); id != "" && !seen[id] {
			ids, seen[id] = append(ids, id), true
		}
		parsed, parseErr := url.Parse(value)
		if parseErr == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") {
			parsed.RawQuery, parsed.Fragment = "", ""
			urls = append(urls, parsed.String())
		}
	}
	publicIDs, err := repository.StorageIDsForPublicURLs(urls)
	if err != nil {
		return nil, err
	}
	for _, id := range publicIDs {
		if !seen[id] {
			ids, seen[id] = append(ids, id), true
		}
	}
	return ids, nil
}

func taskStorageReferenceIDs(task any) ([]string, error) {
	switch value := task.(type) {
	case model.CanvasImageTask:
		if !isStorageTaskActive(value.Status) {
			task = map[string]any{"storageKey": value.StorageKey, "imageUrl": value.ImageURL, "imageUrls": value.ImageURLs}
		}
	case model.CanvasAudioTask:
		if !isStorageTaskActive(value.Status) {
			task = map[string]any{"storageKey": value.StorageKey, "audioUrl": value.AudioURL}
		}
	case model.VideoTask:
		if !isStorageTaskActive(value.Status) {
			task = map[string]any{"videoUrl": value.VideoURL}
		}
	}
	raw, err := json.Marshal(task)
	if err != nil {
		return nil, err
	}
	return storageReferenceIDs(string(raw))
}

func currentTaskStorageReferenceIDs(task any) ([]string, error) {
	switch value := task.(type) {
	case *model.CanvasImageTask:
		return taskStorageReferenceIDs(*value)
	case *model.CanvasAudioTask:
		return taskStorageReferenceIDs(*value)
	case *model.VideoTask:
		return taskStorageReferenceIDs(*value)
	default:
		return taskStorageReferenceIDs(task)
	}
}

func storageReferenceError(err error) error {
	if errors.Is(err, repository.ErrStorageReferenceMissing) {
		return safeMessageError{message: err.Error()}
	}
	return err
}
