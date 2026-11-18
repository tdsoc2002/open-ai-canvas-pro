import { Button } from "antd";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { MediaPreview } from "@/components/media-preview";
import { Tooltip } from "@/components/ui/base/tooltip";
import { generationTaskShowsProgress, generationTaskStageLabel, generationTaskStatusLabel } from "@/lib/generation-task-display";
import type { GenerationTask } from "@/services/api/task-center";
import { isTaskActive, isTaskFailed, isTaskRetryBlocked, taskAttentionReason, taskKindIcon, taskMediaKind } from "./task-shared";
import { TaskVideoThumbnail } from "./task-video-thumbnail";

export function TaskGridCard({ task, actingId, onOpen, onRetry }: { task: GenerationTask; actingId: string; onOpen: () => void; onRetry: () => void }) {
    const { t } = useTranslation();
    const active = isTaskActive(task);
    const failed = isTaskFailed(task);
    const retryBlocked = isTaskRetryBlocked(task);
    const kind = taskMediaKind(task);
    const previewKind = kind === "audio" ? kind : task.previewKind || kind;
    const cover = previewKind === "video" ? task.previewPosterUrl : previewKind === "image" ? task.previewUrl : undefined;
    const stage = generationTaskStageLabel(task);
    const status = generationTaskStatusLabel(task);
    const progress = generationTaskShowsProgress(task) ? `${task.progress || 0}%` : stage;
    const title = task.prompt || t("library.tasks.row.untitled");
    const Icon = taskKindIcon(task);

    return (
        <article className="history-media-card">
            <button type="button" className="history-media-open" title={title} aria-label={t("library.tasks.gallery.openDetail", { title: title.slice(0, 80), status: active && progress !== status ? `${status} · ${progress}` : status })} onClick={onOpen}>
                {previewKind === "video" && task.previewUrl ? (
                    <TaskVideoThumbnail src={task.previewUrl} posterUrl={task.previewPosterUrl} showDuration={task.status === "succeeded"} />
                ) : cover ? (
                    <MediaPreview src={cover} alt="" kind="image" loading="lazy" fallbackLabel={t("library.tasks.row.previewUnavailable")} />
                ) : (
                    <span className="history-media-placeholder">
                        <Icon aria-hidden="true" />
                        {kind === "text" ? <span>{title}</span> : null}
                    </span>
                )}
                {active ? (
                    <span className="history-media-progress">
                        <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />
                        <span>{progress}</span>
                    </span>
                ) : task.status !== "succeeded" ? (
                    <span className="history-media-state">{status}</span>
                ) : null}
            </button>
            {failed ? (
                <div className="history-media-error">
                    <p>{taskAttentionReason(task)}</p>
                    {!retryBlocked ? (
                        <Tooltip title={task.canRecoverMedia ? t("library.tasks.row.retrySaveHint") : t("library.tasks.row.retryTask")}>
                            <Button type="text" size="small" icon={<RotateCcw />} loading={actingId === task.id} onClick={onRetry}>
                                {t(task.canRecoverMedia ? "library.tasks.row.retrySave" : "library.tasks.row.retryTask")}
                            </Button>
                        </Tooltip>
                    ) : null}
                </div>
            ) : null}
        </article>
    );
}
