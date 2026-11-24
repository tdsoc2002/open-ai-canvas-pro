package protocol

import (
	"context"
	"slices"
	"testing"
)

func TestTencentVODPackageWireContract(t *testing.T) {
	adapter := officialPackageAdapter(t, "tencent-vod-vs.yingce-plugin", "tencent-vod-vs")
	ctx := context.Background()
	meta := adapter.Metadata()
	if !slices.Contains(meta.Scopes, SurfaceAdminSystemChannel) || slices.Contains(meta.Scopes, SurfaceUserCustomChannel) || !meta.DetachedPolling || meta.IdempotentCreate {
		t.Fatalf("unexpected plugin metadata: %#v", meta)
	}
	request := GenerationRequest{Extra: map[string]any{"tencentVodAppId": int64(123), "tencentVod": map[string]any{"SubAppId": 123}}}
	create, err := adapter.BuildCreate(ctx, RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	pollCtx := PollContext{TaskID: "vod-task-1", Request: request}
	poll, err := adapter.BuildPoll(ctx, pollCtx)
	if err != nil {
		t.Fatal(err)
	}
	for action, spec := range map[string]RequestSpec{"CreateAigcVideoTask": create, "DescribeTaskDetail": poll} {
		if spec.Path != "/" || spec.Method != "POST" || spec.Auth.Type != "tc3" || spec.Auth.Service != "vod" ||
			spec.Headers["X-TC-Action"] != action || spec.Headers["X-TC-Version"] != "2018-07-17" ||
			spec.Headers["X-TC-Region"] != "ap-guangzhou" || spec.Headers["Content-Type"] != "application/json; charset=utf-8" {
			t.Fatalf("unexpected %s spec: %#v", action, spec)
		}
	}
	pollBody := manifestTestBody(t, poll)
	if len(pollBody) != 2 || pollBody["SubAppId"] != float64(123) || pollBody["TaskId"] != pollCtx.TaskID {
		t.Fatalf("unexpected poll body: %#v", pollBody)
	}
	submission, err := adapter.ParseCreate(ctx, []byte(`{"Response":{"TaskId":"vod-task-1"}}`))
	if err != nil || submission.Status != StatusPending || submission.Stage != "" || submission.TaskID != pollCtx.TaskID {
		t.Fatalf("unexpected create response: %#v, %v", submission, err)
	}
	for _, tc := range []struct {
		payload   string
		status    Status
		stage     string
		hasResult bool
	}{
		{`{"Response":{"Error":{"Code":"AuthFailure","Message":"denied"}}}`, StatusFailed, "", false},
		{`{"Response":{"Status":"WAITING","AigcVideoTask":{"Status":"PROCESSING"}}}`, StatusPending, "上游排队中", false},
		{`{"Response":{"Status":"WAITING"}}`, StatusPending, "上游排队中", false},
		{`{"Response":{"Status":"PROCESSING"}}`, StatusProcessing, "", false},
		{`{"Response":{"AigcVideoTask":{"Status":"PROCESSING"}}}`, StatusProcessing, "", false},
		{`{"Response":{"AigcVideoTask":{"Status":"FINISH","ErrCode":1001,"Message":"failed"}}}`, StatusFailed, "", false},
		{`{"Response":{"AigcVideoTask":{"Status":"FINISH"}}}`, StatusFailed, "", false},
		{`{"Response":{"AigcVideoTask":{"Status":"FINISH","ErrCode":0,"Output":{"FileInfos":[{"UsageType":"last_frame_url","FileUrl":"https://video.example.com/frame.jpg"},{"FileType":"jpg","FileUrl":"https://video.example.com/cover.jpg"},{"FileType":"MP4","FileUrl":"https://video.example.com/main.mp4"}]}}}}`, StatusSucceeded, "", true},
	} {
		got, err := adapter.ParsePoll(ctx, pollCtx, []byte(tc.payload))
		if err != nil || got.Status != tc.status || got.Stage != tc.stage || (got.Result != nil) != tc.hasResult {
			t.Fatalf("payload %s returned %#v (%v)", tc.payload, got, err)
		}
		if tc.hasResult && (len(got.Result.Videos) != 1 || got.Result.Videos[0].URL != "https://video.example.com/main.mp4" || !got.Result.Videos[0].Ephemeral) {
			t.Fatalf("unexpected video result: %#v", got.Result)
		}
	}
}
