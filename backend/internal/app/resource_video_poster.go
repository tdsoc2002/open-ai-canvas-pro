package app

import (
	"context"
	"errors"
	"image/jpeg"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

const maxVideoPosterSourceBytes int64 = 256 << 20

var videoPosterSlots = make(chan struct{}, 2)

// EnsureResourceVideoPoster saves a reusable JPEG for a video owned by the
// caller. The browser does not receive or re-upload the source video bytes.
func (s *Service) EnsureResourceVideoPoster(ctx context.Context, userID, id string) (*model.Resource, error) {
	source, err := s.repo.ResourceForUser(userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("视频资源不存在或不可访问")
	}
	if err != nil {
		return nil, err
	}
	if source.Status != model.ResourceStatusReady || source.Kind != "video" || !strings.HasPrefix(source.MimeType, "video/") {
		return nil, BadAuthRequest("只能为就绪的视频资源生成封面")
	}
	identity := "derived:video-poster:v1:" + source.ID
	result := s.videoPosterRequests.DoChan(source.ID, func() (any, error) {
		existing, err := s.resourceForUploadKey(userID, normalizedResourceUploadKey([]string{identity}))
		if err != nil {
			return nil, err
		}
		if existing != nil && existing.Status == model.ResourceStatusReady {
			if existing.Kind != "image" || existing.MimeType != "image/jpeg" {
				return nil, NewAppError(http.StatusConflict, "已有的封面资源格式不正确")
			}
			return existing, nil
		}
		if existing != nil && existing.Status == model.ResourceStatusPending {
			return nil, resourceUploadInProgress()
		}
		if source.Size <= 0 || source.Size > maxVideoPosterSourceBytes {
			return nil, BadAuthRequest("视频文件大小超出自动封面处理范围")
		}

		// The durable result belongs to the source, not the browser tab that
		// requested it. Navigation does not cancel an already accepted job.
		work, cancel := context.WithTimeout(context.WithoutCancel(ctx), 45*time.Second)
		defer cancel()
		select {
		case videoPosterSlots <- struct{}{}:
			defer func() { <-videoPosterSlots }()
		case <-work.Done():
			return nil, WrapAppError(http.StatusServiceUnavailable, "视频封面处理繁忙，请稍后重试", work.Err())
		}
		return s.createResourceVideoPoster(work, userID, source, identity)
	})
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case outcome := <-result:
		if outcome.Err != nil {
			return nil, outcome.Err
		}
		return outcome.Val.(*model.Resource), nil
	}
}

func (s *Service) createResourceVideoPoster(ctx context.Context, userID string, source *model.Resource, identity string) (*model.Resource, error) {
	dir, err := os.MkdirTemp("", "yingce-video-poster-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	inputPath, outputPath := filepath.Join(dir, "source"), filepath.Join(dir, "poster.jpg")
	input, err := os.Create(inputPath)
	if err != nil {
		return nil, err
	}
	stream, err := s.openResourceRange(userID, source, "")
	if err != nil {
		_ = input.Close()
		return nil, WrapAppError(http.StatusBadGateway, "读取原视频失败", err)
	}
	stop := context.AfterFunc(ctx, func() { _ = stream.Body.Close() })
	size, copyErr := io.Copy(input, io.LimitReader(stream.Body, maxVideoPosterSourceBytes+1))
	stop()
	_ = stream.Body.Close()
	if err := errors.Join(copyErr, input.Close(), ctx.Err()); err != nil {
		return nil, WrapAppError(http.StatusBadGateway, "读取原视频失败", err)
	}
	if size <= 0 || size > maxVideoPosterSourceBytes {
		return nil, BadAuthRequest("视频文件大小超出自动封面处理范围")
	}
	if err := renderResourceVideoPoster(ctx, inputPath, outputPath); err != nil {
		return nil, WrapAppError(http.StatusUnprocessableEntity, "无法从原视频提取首帧", err)
	}
	output, err := os.Open(outputPath)
	if err != nil {
		return nil, err
	}
	defer output.Close()
	config, err := jpeg.DecodeConfig(output)
	if err != nil {
		return nil, err
	}
	info, err := output.Stat()
	if err != nil {
		return nil, err
	}
	return s.UploadResourceFile(userID, "video-poster.jpg", info.Size(), "image", config.Width, config.Height, 0, output, identity)
}

func renderResourceVideoPoster(ctx context.Context, input, output string) error {
	bin, err := renderFfmpegBinary()
	if err != nil {
		return err
	}
	// Media bytes have been authorized and staged locally. Do not let an
	// uploaded playlist or external data reference open a network connection.
	return exec.CommandContext(ctx, bin, "-hide_banner", "-loglevel", "error", "-nostdin",
		"-max_alloc", "67108864", "-protocol_whitelist", "file",
		"-format_whitelist", "mov,matroska,avi,mpeg,mpegts,flv,ogg,asf", "-threads", "1", "-i", input,
		"-map", "0:v:0", "-an", "-sn", "-dn", "-frames:v", "1", "-vf", "scale=400:400:force_original_aspect_ratio=decrease",
		"-threads", "1", "-q:v", "3", "-update", "1", output).Run()
}
