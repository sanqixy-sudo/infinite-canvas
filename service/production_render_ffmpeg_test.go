package service

import (
	"context"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
)

// This probe uses only generated local fixtures; it never calls a model or storage service.
func TestProductionRenderFFmpegIntegration(t *testing.T) {
	for _, program := range []string{"ffmpeg", "ffprobe"} {
		if _, err := exec.LookPath(program); err != nil { t.Skipf("%s unavailable: run this probe in the production runtime image", program) }
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second); defer cancel()
	directory := t.TempDir()
	run := func(program string, args ...string) []byte {
		t.Helper()
		command := exec.CommandContext(ctx, program, args...); command.Dir = directory
		var stderr strings.Builder; command.Stderr = &stderr
		result, err := command.Output()
		if err != nil { t.Fatalf("%s failed: %v\n%s", program, err, stderr.String()) }
		return result
	}
	if _, err := exec.LookPath("fc-match"); err == nil {
		font := string(run("fc-match", "-f", "%{family}", "Noto Sans CJK SC"))
		if !strings.Contains(font, "Noto Sans CJK") { t.Fatalf("Chinese subtitle font missing: got %q; install fonts-noto-cjk", font) }
	}
	still := image.NewRGBA(image.Rect(0, 0, 90, 160))
	for y := 0; y < 160; y++ { for x := 0; x < 90; x++ { still.SetRGBA(x, y, color.RGBA{R: 16, G: 16, B: 16, A: 255}) } }
	file, err := os.Create(filepath.Join(directory, "still.png")); if err != nil { t.Fatal(err) }
	err = png.Encode(file, still); closeErr := file.Close(); if err != nil { t.Fatal(err) }; if closeErr != nil { t.Fatal(closeErr) }
	run("ffmpeg", renderClipArgs("still.png", "joined.mp4", productionRenderClip{Kind: "image", Seconds: 2}, false)...)
	for index, tone := range []string{"sine=frequency=440:sample_rate=48000:duration=2", "sine=frequency=880:sample_rate=48000:duration=2"} {
		name := []string{"voice.wav", "music.wav"}[index]
		run("ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "lavfi", "-i", tone, "-c:a", "pcm_s16le", name)
	}
	edit := model.ProductionDeliveryEdit{OriginalGain: 0, BurnSubtitles: true,
		AudioTracks: []model.ProductionAudioTrack{
			{ID: "voice", StartSeconds: 0.25, TrimStartSeconds: 0.1, DurationSeconds: 1.5, Gain: 0.8},
			{ID: "music", StartSeconds: 1, TrimStartSeconds: 0.2, DurationSeconds: 0.75, Gain: 0.6},
		},
		Subtitles: []model.ProductionSubtitle{{ID: "subtitle", StartSeconds: 0.3, EndSeconds: 1.7, Text: "你好，小盟\n真实字幕烧录"}},
	}
	if err := os.WriteFile(filepath.Join(directory, "captions.ass"), []byte(productionASS(edit.Subtitles)), 0600); err != nil { t.Fatal(err) }
	run("ffmpeg", productionMixArgs("joined.mp4", "mixed.mp4", []string{"voice.wav", "music.wav"}, edit, 2)...)
	output := filepath.Join(directory, "mixed.mp4")
	if err := verifyRenderedFile(ctx, output, 2); err != nil { t.Fatal(err) }
	probe, err := probeRenderFile(ctx, output); if err != nil { t.Fatal(err) }
	videoCount, audioCount := 0, 0
	for _, stream := range probe.Streams { if stream.CodecType == "video" { videoCount++ }; if stream.CodecType == "audio" { audioCount++ } }
	if videoCount != 1 || audioCount != 1 { t.Fatalf("expected one video and one mixed audio stream: %+v", probe.Streams) }
	pcm := run("ffmpeg", "-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe", "-i", "mixed.mp4", "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-f", "s16le", "pipe:1")
	if len(pcm) < 48000*2*2-9600 { t.Fatalf("decoded audio too short: %d bytes", len(pcm)) }
	strength := func(frequency, start float64) float64 {
		const count = 9600
		first := int(start * 48000); var real, imaginary float64
		for index := 0; index < count; index++ { sample := float64(int16(binary.LittleEndian.Uint16(pcm[(first+index)*2:]))) / 32768; phase := 2*math.Pi*frequency*float64(index)/48000; real += sample*math.Cos(phase); imaginary += sample*math.Sin(phase) }
		return 2 * math.Hypot(real, imaginary) / count
	}
	if value := strength(440, 0.45); value < 0.03 { t.Fatalf("voice track missing after its start: %f", value) }
	if value := strength(880, 1.15); value < 0.02 { t.Fatalf("second track missing from overlap: %f", value) }
	if value := strength(880, 0.45); value > 0.005 { t.Fatalf("second track played before its timeline start: %f", value) }
	frame := func(at string) []byte { return run("ffmpeg", "-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe", "-ss", at, "-i", "mixed.mp4", "-frames:v", "1", "-vf", "crop=720:200:0:1080,format=gray", "-f", "rawvideo", "pipe:1") }
	bright := func(pixels []byte) int { count := 0; for _, value := range pixels { if value > 120 { count++ } }; return count }
	before, during, after := frame("0.1"), frame("1"), frame("1.9")
	for _, frame := range [][]byte{before, during, after} { if len(frame) != 720*200 { t.Fatalf("subtitle frame decode incomplete: %d", len(frame)) } }
	if bright(before) > 20 || bright(after) > 20 || bright(during) < 100 { t.Fatalf("subtitle burn timing/pixels wrong: before=%d during=%d after=%d", bright(before), bright(during), bright(after)) }
}
