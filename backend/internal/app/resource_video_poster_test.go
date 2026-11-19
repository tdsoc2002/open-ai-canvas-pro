package app

import (
	"context"
	"image/jpeg"
	"os"
	"path/filepath"
	"testing"
)

func TestRenderResourceVideoPosterProducesSmallJPEG(t *testing.T) {
	requireFFmpegTools(t)
	dir := t.TempDir()
	input, output := filepath.Join(dir, "source.mp4"), filepath.Join(dir, "poster.jpg")
	writeTestVideo(t, input, 1280, 720, nil)
	if err := renderResourceVideoPoster(context.Background(), input, output); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(output)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	config, err := jpeg.DecodeConfig(file)
	if err != nil || config.Width != 400 || config.Height != 225 {
		t.Fatalf("poster = %dx%d, err = %v; want 400x225 JPEG", config.Width, config.Height, err)
	}
}
