package handler

import (
	"bytes"
	"mime/multipart"
	"testing"
)

func TestReadAIRequestCountBillsVideoDuration(t *testing.T) {
	for _, test := range []struct {
		name string
		body string
		want int
	}{
		{name: "fractional seconds", body: `{"seconds":5.25}`, want: 6},
		{name: "seconds suffix", body: `{"seconds":"7s"}`, want: 7},
		{name: "nested duration", body: `{"parameters":{"durationSeconds":"4.1"}}`, want: 5},
		{name: "automatic duration", body: `{"duration":-1}`, want: 15},
		{name: "frame count", body: `{"num_frames":97,"frame_rate":24}`, want: 4},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := readAIRequestCount([]byte(test.body), "application/json", true)
			if err != nil || got != test.want {
				t.Fatalf("billable seconds = %d, err = %v; want %d", got, err, test.want)
			}
		})
	}
	for _, body := range []string{`{"seconds":0}`, `{"duration":-2}`, `{"seconds":"NaN"}`, `{"seconds":"1e100"}`} {
		if _, err := readAIRequestCount([]byte(body), "application/json", true); err == nil {
			t.Fatalf("invalid duration accepted: %s", body)
		}
	}
}

func TestReadAIRequestCountBillsMultipartVideoDuration(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("seconds", "5.5"); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	got, err := readAIRequestCount(body.Bytes(), writer.FormDataContentType(), true)
	if err != nil || got != 6 {
		t.Fatalf("multipart billable seconds = %d, err = %v; want 6", got, err)
	}
}
