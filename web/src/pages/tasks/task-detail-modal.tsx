import { App, Button } from "antd";
import { AlertCircle, Bug, Copy, RefreshCw, RotateCcw, X } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { AppModal } from "@/components/ui/product/app-modal";
import { RelativeTime } from "@/components/ui/product/relative-time";
import { currentLocale, translate } from "@/i18n";
import { generationErrorMessage } from "@/lib/generation-error";
import { formatTaskKind, generationTaskShowsProgress, generationTaskStageLabel, generationTaskStatusLabel, mediaDeliverySummary } from "@/lib/generation-task-display";
import { progressFillStyle } from "@/lib/progress-fill";
import { formatTaskLog, type GenerationTask, type TaskLog } from "@/services/api/task-center";
import { taskGenerationParameters, type TaskParameterKind } from "./task-generation-parameters";
import { TaskResultPreview } from "./task-result-preview";
import { isTaskActive, isTaskFailed, isTaskRetryBlocked, providerCancelStatusLabel, taskAttentionReason, TaskBilling, taskMediaKind, TaskStatusPill, taskTone } from "./task-shared";

type TaskDetailModalProps = {
    task: GenerationTask | null;
    loading: boolean;
    logs: TaskLog[];
    logsLoading: boolean;
    actingId: string;
    canvasName: string;
    modelName: string;
    creditsEnabled: boolean;
    onClose: () => void;
    onRetry: (task: GenerationTask) => void;
    onQueryProvider: (task: GenerationTask) => void;
    onExportDiagnostics: (task: GenerationTask) => void;
    onPreviewMedia: (media: { url: string; kind: "image" | "video"; title: string }) => void;
};

/**
 * 左侧预览作品，右侧的创作信息与排障内容独立滚动；原任务动作仍留在底栏。
 * 打开时先用列表里的摘要渲染，详情和日志到达后原位替换。
 */
export function TaskDetailModal({ task, loading, logs, logsLoading, actingId, canvasName, modelName, creditsEnabled, onClose, onRetry, onQueryProvider, onExportDiagnostics, onPreviewMedia }: TaskDetailModalProps) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const copyText = async (value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            message.success(t("library.tasks.detail.copied"));
        } catch {
            message.error(t("library.tasks.detail.copyFailed"));
        }
    };

    return (
        <AppModal
            open={Boolean(task)}
            onCancel={onClose}
            footer={null}
            title={<span className="sr-only">{t("library.tasks.row.viewDetail")}</span>}
            styles={{ header: { margin: 0 } }}
            closable={false}
            centered
            width="min(1440px, calc(100vw - 2 * var(--space-4)))"
            rootClassName="task-detail-modal-root"
            flush
        >
            {task ? (
                <TaskDetailContent
                    key={task.id}
                    task={task}
                    loading={loading}
                    logs={logs}
                    logsLoading={logsLoading}
                    acting={actingId === task.id}
                    canvasName={canvasName}
                    modelName={modelName}
                    creditsEnabled={creditsEnabled}
                    onClose={onClose}
                    onRetry={() => onRetry(task)}
                    onQueryProvider={() => onQueryProvider(task)}
                    onExportDiagnostics={() => onExportDiagnostics(task)}
                    onPreviewMedia={onPreviewMedia}
                    onCopy={(value) => void copyText(value)}
                />
            ) : null}
        </AppModal>
    );
}

function TaskDetailContent({
    task,
    loading,
    logs,
    logsLoading,
    acting,
    canvasName,
    modelName,
    creditsEnabled,
    onClose,
    onRetry,
    onQueryProvider,
    onExportDiagnostics,
    onPreviewMedia,
    onCopy,
}: Omit<TaskDetailModalProps, "task" | "actingId" | "onRetry" | "onQueryProvider" | "onExportDiagnostics"> & {
    task: GenerationTask;
    acting: boolean;
    onRetry: () => void;
    onQueryProvider: () => void;
    onExportDiagnostics: () => void;
    onCopy: (value: string) => void;
}) {
    const { t } = useTranslation();
    const active = isTaskActive(task);
    const failed = isTaskFailed(task);
    const retryBlocked = isTaskRetryBlocked(task);
    const stageLabel = generationTaskStageLabel(task);
    const title = task.prompt || t("library.tasks.row.untitled");
    const kind = taskMediaKind(task);
    const kindTitle = t(kind === "video" ? "library.tasks.page.kindVideo" : kind === "image" ? "library.tasks.page.kindImage" : kind === "audio" ? "library.tasks.gallery.kindAudio" : "library.tasks.page.kindText");
    const facts: Array<{ label: string; value: string }> = [
        { label: t("library.tasks.detail.status"), value: generationTaskStatusLabel(task) },
        ...(task.mediaStage ? [{ label: t("library.tasks.detail.delivery"), value: mediaDeliverySummary(task.status, task.mediaStage) }] : []),
        { label: t("library.tasks.detail.canvas"), value: canvasName },
        { label: t("library.tasks.detail.kind"), value: formatTaskKind(task) },
        { label: t("library.tasks.detail.model"), value: modelName },
        { label: t("library.tasks.detail.attempts"), value: t("library.tasks.detail.attemptValue", { count: task.attempts || 1 }) },
        { label: t("library.tasks.detail.createdAt"), value: formatDate(task.createdAt) },
        { label: t("library.tasks.detail.startedAt"), value: formatDate(task.startedAt) },
        { label: t("library.tasks.detail.completedAt"), value: formatDate(task.completedAt) },
        { label: t("library.tasks.detail.duration"), value: formatTaskDuration(task) },
        ...(task.providerCancelStatus ? [{ label: t("library.tasks.detail.providerCancel"), value: providerCancelStatusLabel(task) }] : []),
        ...(task.providerCancelRequestedAt ? [{ label: t("library.tasks.detail.cancelRequestedAt"), value: formatDate(task.providerCancelRequestedAt) }] : []),
    ];

    return (
        <div className="task-detail" data-tone={taskTone(task)}>
            <TaskResultPreview task={task} kind={kind} title={title} loading={loading} onPreview={onPreviewMedia} />
            <aside className="task-detail-side">
                <header className="task-detail-header">
                    <div className="task-detail-heading">
                        <h2>{kindTitle}</h2>
                        <div className="task-detail-sub">
                            <TaskStatusPill task={task} />
                            <RelativeTime value={task.createdAt} />
                        </div>
                    </div>
                    <button type="button" className="task-detail-close" aria-label={t("common.close")} onClick={onClose}>
                        <X />
                    </button>
                </header>
                <div className="task-detail-info-scroll" tabIndex={0} role="region" aria-label={t("library.tasks.detail.info")}>
                    {failed ? (
                        <div className="task-detail-alert" role="alert">
                            <AlertCircle aria-hidden="true" />
                            <div>
                                <strong>{t("library.tasks.detail.failedReason")}</strong>
                                <p>{task.error ? generationErrorMessage(task.error) : taskAttentionReason(task)}</p>
                            </div>
                        </div>
                    ) : null}

                    {active ? (
                        <div className="task-detail-progress" role="progressbar" aria-label={stageLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress || 0}>
                            <span>
                                <span>{stageLabel}</span>
                                {generationTaskShowsProgress(task) ? <strong>{task.progress || 0}%</strong> : null}
                            </span>
                            <i>
                                <b style={progressFillStyle(generationTaskShowsProgress(task) ? task.progress || 0 : 0)} />
                            </i>
                        </div>
                    ) : null}

                    <section className="task-detail-section">
                        <div className="task-detail-section-head">
                            <h3>{t("library.tasks.detail.prompt")}</h3>
                            {task.prompt ? (
                                <button type="button" className="task-detail-text-action" onClick={() => onCopy(task.prompt)}>
                                    <Copy aria-hidden="true" />
                                    {t("library.tasks.detail.copyPrompt")}
                                </button>
                            ) : null}
                        </div>
                        <p className="task-detail-prompt">{loading && !task.prompt ? t("library.tasks.detail.loading") : task.prompt || t("library.tasks.detail.none")}</p>
                    </section>

                    <TaskGenerationParameters inputJson={task.inputJson} kind={kind} loading={loading} />
                    <section className="task-detail-section">
                        <h3>{t("library.tasks.detail.info")}</h3>
                        <dl className="task-detail-facts">
                            {facts.map((fact) => (
                                <div key={fact.label}>
                                    <dt>{fact.label}</dt>
                                    <dd title={fact.value}>{fact.value}</dd>
                                </div>
                            ))}
                            {creditsEnabled && task.billing ? (
                                <div>
                                    <dt>{t("library.tasks.detail.billing")}</dt>
                                    <dd>
                                        <TaskBilling billing={task.billing} />
                                    </dd>
                                </div>
                            ) : null}
                        </dl>
                    </section>

                    <section className="task-detail-section">
                        <h3>{t("library.tasks.detail.logs")}</h3>
                        {logsLoading ? (
                            <div className="task-detail-empty">{t("library.tasks.detail.logsLoading")}</div>
                        ) : logs.length ? (
                            <ol className="task-detail-logs">
                                {logs.map((log, index) => (
                                    <li key={`${log.createdAt}-${index}`} data-level={log.level}>
                                        <time dateTime={log.createdAt}>{formatLogTime(log.createdAt)}</time>
                                        <span className="task-detail-log-level">{log.level.toUpperCase()}</span>
                                        <span className="task-detail-log-message">{formatTaskLog(log)}</span>
                                    </li>
                                ))}
                            </ol>
                        ) : (
                            <div className="task-detail-empty">{t("library.tasks.detail.noLogs")}</div>
                        )}
                    </section>

                    <details className="task-detail-raw">
                        <summary>{t("library.tasks.detail.result")}</summary>
                        <pre>{loading && !task.resultJson ? t("library.tasks.detail.loading") : formatTaskJson(task.resultJson)}</pre>
                    </details>
                </div>

                <footer className="task-detail-footer">
                    <button type="button" className="task-detail-id" title={t("library.tasks.detail.taskId")} onClick={() => onCopy(task.id)}>
                        <span>{t("library.tasks.detail.taskId")}</span>
                        <code>{task.id}</code>
                        <Copy aria-hidden="true" />
                    </button>
                    <div className="task-detail-actions">
                        {failed ? (
                            <Button icon={<Bug className="size-4" />} onClick={onExportDiagnostics}>
                                {t("library.tasks.detail.exportDiagnostics")}
                            </Button>
                        ) : null}
                        {canQueryProviderTask(task) ? (
                            <Button icon={<RefreshCw className="size-4" />} loading={acting} onClick={onQueryProvider}>
                                {t("library.tasks.detail.queryProvider")}
                            </Button>
                        ) : null}
                        {task.canRecoverMedia ? (
                            <Button type="primary" icon={<RefreshCw className="size-4" />} loading={acting} onClick={onRetry}>
                                {t("library.tasks.row.retrySave")}
                            </Button>
                        ) : failed && !retryBlocked ? (
                            <Button type="primary" icon={<RotateCcw className="size-4" />} loading={acting} onClick={onRetry}>
                                {t("library.tasks.row.retryTask")}
                            </Button>
                        ) : null}
                        <Button onClick={onClose}>{t("common.close")}</Button>
                    </div>
                </footer>
            </aside>
        </div>
    );
}

function canQueryProviderTask(task: GenerationTask) {
    return task.status === "failed" && !task.mediaStage && (task.type.startsWith("canvas_video") || task.type.startsWith("video_")) && Boolean(task.providerRequestId);
}

function TaskGenerationParameters({ inputJson, kind, loading }: { inputJson?: string; kind: TaskParameterKind; loading: boolean }) {
    const { t } = useTranslation();
    const headingId = useId();
    const { resolution, ratio, duration, audio, unavailable, extras = [] } = taskGenerationParameters(inputJson, kind);
    const automatic = (value: string | undefined) => (value === "auto" ? t("library.tasks.params.automatic") : value);
    const rows = [
        ...(kind === "image" || kind === "video"
            ? [
                  { key: "resolution", label: t("library.tasks.params.resolution"), value: automatic(resolution) },
                  { key: "ratio", label: t("library.tasks.params.ratio"), value: automatic(ratio) },
              ]
            : []),
        ...(kind === "video"
            ? [
                  { key: "duration", label: t("library.tasks.params.duration"), value: duration === "auto" ? automatic(duration) : duration === undefined ? undefined : t("library.tasks.params.seconds", { seconds: duration }) },
                  { key: "audio", label: t("library.tasks.params.audio"), value: audio === undefined ? undefined : t(audio ? "library.tasks.params.enabled" : "library.tasks.params.disabled") },
              ]
            : []),
        ...extras.map(({ key, value }) => {
            const formatted =
                typeof value === "boolean"
                    ? t(value ? "library.tasks.params.enabled" : "library.tasks.params.disabled")
                    : key === "count" || key === "referenceImages"
                      ? t("library.tasks.params.imageCount", { count: value })
                      : key === "referenceVideos" || key === "referenceAudios"
                        ? t("library.tasks.params.referenceCount", { count: value })
                        : key === "audioSpeed"
                          ? t("library.tasks.params.speedValue", { speed: value })
                          : key === "thinking" && (value === "off" || value === "none")
                            ? t("library.tasks.params.disabled")
                            : key === "thinking" && value === "deep"
                              ? t("library.tasks.params.thinkingDeep")
                              : automatic(String(value));
            return { key, label: t(`library.tasks.params.${key}`), value: formatted };
        }),
    ];
    const hasRecorded = rows.some((row) => row.value !== undefined);
    return (
        <section className="task-detail-section" aria-labelledby={headingId}>
            <h3 id={headingId}>{t("library.tasks.params.generationTitle")}</h3>
            {loading && !hasRecorded ? (
                <div className="task-detail-empty" role="status">
                    {t("library.tasks.detail.loading")}
                </div>
            ) : unavailable && !hasRecorded ? (
                <div className="task-detail-empty" role="status">
                    {t("library.tasks.params.unavailable")}
                </div>
            ) : hasRecorded ? (
                <dl className="task-detail-generation-parameters">
                    {rows.map(({ key, label, value }) => (
                        <div key={key}>
                            <dt>{label}</dt>
                            <dd data-unrecorded={value === undefined || undefined}>{value ?? t("library.tasks.params.notRecorded")}</dd>
                        </div>
                    ))}
                </dl>
            ) : (
                <div className="task-detail-empty">{t("library.tasks.params.empty")}</div>
            )}
            {unavailable && hasRecorded ? (
                <div className="task-detail-empty" role="status">
                    {t("library.tasks.params.unavailable")}
                </div>
            ) : null}
        </section>
    );
}

function formatDate(value?: string) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString(currentLocale());
}

function formatLogTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString(currentLocale(), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatTaskDuration(task: GenerationTask) {
    if (!task.createdAt) return "-";
    const start = new Date(task.startedAt || task.createdAt).getTime();
    const end = task.completedAt ? new Date(task.completedAt).getTime() : isTaskActive(task) ? Date.now() : Number.NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "-";
    const totalSeconds = Math.max(0, Math.floor((end - start) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes ? translate("library.tasks.detail.durationMinutes", { minutes, seconds }) : translate("library.tasks.detail.durationSeconds", { seconds });
}

function formatTaskJson(value?: string) {
    if (!value) return translate("library.tasks.detail.none");
    try {
        return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
        return value;
    }
}
