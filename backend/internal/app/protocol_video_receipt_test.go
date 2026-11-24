package app

import (
	"errors"
	"testing"

	"yingce/backend/internal/protocol"
)

func TestDetachedProtocolPendingPreservesReceiptAndStage(t *testing.T) {
	for _, tc := range []struct {
		status protocol.Status
		stage  string
		want   string
	}{
		{protocol.StatusPending, "", "等待上游任务同步"},
		{protocol.StatusPending, "上游排队中", "上游排队中"},
		{protocol.StatusProcessing, "", "上游生成中"},
	} {
		var pending providerStatePendingError
		err := detachedProtocolPending("upstream-generation", tc.status, tc.stage, 1)
		if !errors.As(err, &pending) || !pending.Detached || pending.TaskID != "upstream-generation" || pending.Stage != tc.want {
			t.Fatalf("status=%s: pending=%+v, err=%v", tc.status, pending, err)
		}
	}
}
