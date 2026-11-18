package protocol

import (
	"context"
	"slices"
	"testing"
)

func TestTencentVODOGPackageContract(t *testing.T) {
	a := officialPackageAdapter(t, "tencent-vod-og.yingce-plugin", "tencent-vod-og")
	ctx := context.Background()
	if m := a.Metadata(); !m.DetachedPolling || m.IdempotentCreate || slices.Contains(m.Scopes, SurfaceUserCustomChannel) || !slices.Contains(m.Scopes, SurfaceAdminSystemChannel) {
		t.Fatal("OG must be a system-only protocol with non-retried creates")
	}
	r := GenerationRequest{Extra: map[string]any{"tencentVod": map[string]any{"ModelName": "OG"}, "tencentVodAppId": 123}}
	create, err := a.BuildCreate(ctx, RequestContext{Request: r})
	if err != nil || create.Path != "/" || create.Headers["X-TC-Action"] != "CreateAigcImageTask" || create.Auth.Service != "vod" {
		t.Fatalf("create: %#v, %v", create, err)
	}
	pollCtx := PollContext{TaskID: "fixture", Request: r}
	failed, err := a.ParseCreate(ctx, []byte(`{"Response":{"Error":{"Code":"RequestLimitExceeded"}}}`))
	if err != nil || failed.Status != StatusFailed || failed.TaskID != "" {
		t.Fatalf("uncertain create must not retry: %#v, %v", failed, err)
	}
	poll, err := a.BuildPoll(ctx, pollCtx)
	if err != nil || poll.Headers["X-TC-Action"] != "DescribeTaskDetail" {
		t.Fatalf("poll: %#v, %v", poll, err)
	}
	if body := manifestTestBody(t, poll); body["TaskId"] != "fixture" || body["SubAppId"] != float64(123) {
		t.Fatalf("poll body: %#v", body)
	}
	for _, c := range []struct {
		input string
		want  Status
		count int
	}{
		{`{"Response":{"AigcImageTask":{"Status":"WAITING"}}}`, StatusProcessing, 0},
		{`{"Response":{"Error":{"Code":"RequestLimitExceeded"}}}`, StatusProcessing, 0},
		{`{"Response":{"Error":{"Code":"UnauthorizedOperation","Message":"denied"}}}`, StatusFailed, 0},
		{`{"Response":{"AigcImageTask":{"Status":"FINISH","ErrCode":0,"ErrCodeExt":"AuthFailure"}}}`, StatusFailed, 0},
		{`{"Response":{"AigcImageTask":{"Status":"FINISH","ErrCode":44}}}`, StatusFailed, 0},
		{`{"Response":{"AigcImageTask":{"Status":"FINISH","ErrCode":0,"Output":{"FileInfos":[{"FileUrl":"https://media.example.com/image.png"}]}}}}`, StatusSucceeded, 1},
	} {
		got, err := a.ParsePoll(ctx, pollCtx, []byte(c.input))
		if err != nil || got.Status != c.want {
			t.Fatalf("got %#v, %v for %s", got, err, c.input)
		}
		if c.count == 0 && got.Result != nil || c.count > 0 && (got.Result == nil || len(got.Result.Images) != c.count || !got.Result.Images[0].Ephemeral) {
			t.Fatalf("wrong results: %#v", got)
		}
	}
}
