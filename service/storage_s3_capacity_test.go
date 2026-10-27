package service

import (
	"encoding/xml"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/tigerowo/infinite-canvas/model"
)

func s3CapacityPage(truncated bool, token string, sizes ...int64) string {
	var body strings.Builder
	fmt.Fprintf(&body, "<ListBucketResult><IsTruncated>%t</IsTruncated><NextContinuationToken>", truncated)
	_ = xml.EscapeText(&body, []byte(token))
	body.WriteString("</NextContinuationToken>")
	for _, size := range sizes {
		fmt.Fprintf(&body, "<Contents><Size>%d</Size></Contents>", size)
	}
	body.WriteString("</ListBucketResult>")
	return body.String()
}

func TestMeasureS3ProviderPaginationAndSizeBoundaries(t *testing.T) {
	const encodedToken = "opaque +/=?&中文"
	type page struct {
		token  string
		body   string
		status int
	}
	cases := []struct {
		name  string
		pages []page
		want  int64
		err   string
	}{
		{name: "two pages preserve opaque encoded cursor", want: 18, pages: []page{
			{body: s3CapacityPage(true, encodedToken, 7)},
			{token: encodedToken, body: s3CapacityPage(false, "", 0, 11)},
		}},
		{name: "empty bucket", pages: []page{{body: s3CapacityPage(false, "")}}},
		{name: "exact maximum total", want: math.MaxInt64, pages: []page{
			{body: s3CapacityPage(true, "last", math.MaxInt64-1)},
			{token: "last", body: s3CapacityPage(false, "", 1)},
		}},
		{name: "truncated without cursor", err: "分页游标缺失", pages: []page{{body: s3CapacityPage(true, "", 7)}}},
		{name: "truncated with blank cursor", err: "分页游标缺失", pages: []page{{body: s3CapacityPage(true, " \t ", 7)}}},
		{name: "repeated cursor", err: "分页游标重复", pages: []page{
			{body: s3CapacityPage(true, "A", 7)},
			{token: "A", body: s3CapacityPage(true, "A", 11)},
		}},
		{name: "cyclic cursor", err: "分页游标重复", pages: []page{
			{body: s3CapacityPage(true, "A", 7)},
			{token: "A", body: s3CapacityPage(true, "B", 11)},
			{token: "B", body: s3CapacityPage(true, "A", 13)},
		}},
		{name: "later page HTTP failure", err: "503", pages: []page{
			{body: s3CapacityPage(true, "A", 7)},
			{token: "A", status: http.StatusServiceUnavailable, body: "temporary unavailable"},
		}},
		{name: "later page invalid XML", err: "XML", pages: []page{
			{body: s3CapacityPage(true, "A", 7)},
			{token: "A", body: "<ListBucketResult>"},
		}},
		{name: "negative size after a valid page", err: "文件大小无效", pages: []page{
			{body: s3CapacityPage(true, "A", 7)},
			{token: "A", body: s3CapacityPage(false, "", -1)},
		}},
		{name: "overflow across pages", err: "总容量溢出", pages: []page{
			{body: s3CapacityPage(true, "A", math.MaxInt64)},
			{token: "A", body: s3CapacityPage(false, "", 1)},
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			original := safeProxyHTTPClient
			t.Cleanup(func() { safeProxyHTTPClient = original })
			requests := 0
			safeProxyHTTPClient = &http.Client{Transport: storageQuotaTransport(func(request *http.Request) (*http.Response, error) {
				if requests >= len(tc.pages) {
					t.Fatalf("unexpected additional page request: %s", request.URL)
				}
				p := tc.pages[requests]
				requests++
				if request.Method != http.MethodGet || request.URL.Host != "capacity.r2.invalid" || request.URL.Path != "/media/" || request.URL.Query().Get("list-type") != "2" || request.URL.Query().Get("continuation-token") != p.token {
					t.Fatalf("unexpected ListObjectsV2 request: %s %s", request.Method, request.URL)
				}
				if p.token != "" && !strings.Contains(request.URL.RawQuery, "continuation-token="+url.QueryEscape(p.token)) {
					t.Fatalf("opaque continuation token was not preserved in the encoded query: %s", request.URL.RawQuery)
				}
				status := p.status
				if status == 0 {
					status = http.StatusOK
				}
				return &http.Response{StatusCode: status, Status: fmt.Sprintf("%d %s", status, http.StatusText(status)), Header: http.Header{"Content-Type": {"application/xml"}}, Body: io.NopCloser(strings.NewReader(p.body)), Request: request}, nil
			})}
			got, err := measureS3Provider(model.StorageProvider{Endpoint: "https://capacity.r2.invalid", Bucket: "media", Region: "auto", AccessKeyID: "test-key", SecretAccessKey: "test-secret"})
			if tc.err == "" {
				if err != nil || got != tc.want {
					t.Fatalf("total = %d, err = %v; want %d", got, err, tc.want)
				}
			} else if err == nil || !strings.Contains(err.Error(), tc.err) || got != 0 {
				t.Fatalf("invalid/incomplete listing returned total %d, err = %v; want zero and %q", got, err, tc.err)
			}
			if requests != len(tc.pages) {
				t.Fatalf("requests = %d, want %d", requests, len(tc.pages))
			}
		})
	}
}
