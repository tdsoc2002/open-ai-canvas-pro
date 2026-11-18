import { App, Button } from "antd";
import { BookmarkPlus, FileText, Maximize2, Music2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MediaPreview } from "@/components/media-preview";
import { generationTaskStatusLabel } from "@/lib/generation-task-display";
import type { GenerationTask } from "@/services/api/task-center";
import { saveGenerationOutputToLibrary } from "@/services/asset-library";
import { taskResultMedia, taskResultResourceId, taskResultText, type TaskResultMedia } from "./task-result-media";
import { taskKindIcon, type taskMediaKind } from "./task-shared";

type PreviewSelection = { url: string; kind: "image" | "video"; title: string };
type Props = {
    task: GenerationTask;
    kind: ReturnType<typeof taskMediaKind>;
    loading: boolean;
    title: string;
    onPreview: (media: PreviewSelection) => void;
};

export function TaskResultPreview({ task, kind, loading, title, onPreview }: Props) {
    const { t } = useTranslation();
    const Icon = taskKindIcon(task);
    const fallback = task.previewUrl && kind !== "text" ? { url: task.previewUrl, kind: kind === "audio" ? kind : (task.previewKind ?? kind) } : undefined;
    const media = kind === "text" ? [] : taskResultMedia(task.resultJson, kind, fallback);
    const text = kind === "text" ? taskResultText(task.resultJson, task.textDraft) : "";
    const emptyLabel = kind === "audio" ? "library.tasks.detail.noAudio" : kind === "text" ? "library.tasks.detail.noText" : "library.tasks.detail.noMedia";

    return (
        <section className="task-detail-main" aria-label={t("library.tasks.detail.generated")}>
            {media.length ? (
                <TaskResultGallery key={task.id} media={media} title={title} onPreview={onPreview} saveTaskId={!loading && task.status === "succeeded" ? task.id : undefined} />
            ) : text ? (
                <div className="task-detail-text-result" role="region" tabIndex={0} aria-label={t("library.tasks.detail.textPreview")}>
                    <FileText aria-hidden="true" />
                    <pre>{text}</pre>
                </div>
            ) : (
                <div className="task-detail-stage task-detail-no-preview">
                    <Icon aria-hidden="true" />
                    <span>{loading ? t("library.tasks.detail.loading") : task.status === "succeeded" ? t(emptyLabel) : generationTaskStatusLabel(task)}</span>
                </div>
            )}
        </section>
    );
}

/** 只播放当前项；退出详情或切换结果时卸载音频，不保留隐藏的播放器。 */
function TaskResultGallery({ media, title, onPreview, saveTaskId }: { media: TaskResultMedia[]; title: string; onPreview: (media: PreviewSelection) => void; saveTaskId?: string }) {
    const { t } = useTranslation();
    const [index, setIndex] = useState(0);
    const activeIndex = Math.min(index, media.length - 1);
    const current = media[activeIndex];
    const resourceId = taskResultResourceId(current);
    const label = t("library.tasks.detail.generatedItem", { index: activeIndex + 1 });
    return (
        <div className="task-detail-gallery">
            <div className="task-detail-stage">
                {current.kind === "audio" ? (
                    <TaskAudioPreview key={current.url} url={current.url} label={label} />
                ) : (
                    <MediaPreview key={current.url} src={current.url} kind={current.kind} alt={label} controls={current.kind === "video"} fallbackClassName="task-detail-stage-unavailable" />
                )}
                {current.kind === "image" ? (
                    <button type="button" className="task-detail-zoom" aria-label={t("library.tasks.row.previewImage")} title={t("library.tasks.row.previewImage")} onClick={() => onPreview({ url: current.url, kind: "image", title })}>
                        <Maximize2 aria-hidden="true" />
                    </button>
                ) : null}
            </div>
            {media.length > 1 ? (
                <div className="task-detail-thumbs" role="group" aria-label={t("library.tasks.detail.generated")}>
                    {media.map(({ url, kind }, itemIndex) => (
                        <button key={url} type="button" aria-pressed={itemIndex === activeIndex} aria-label={t("library.tasks.detail.generatedItem", { index: itemIndex + 1 })} onClick={() => setIndex(itemIndex)}>
                            {kind === "audio" ? (
                                <span className="task-detail-audio-thumb" aria-hidden="true">
                                    <Music2 />
                                    {itemIndex + 1}
                                </span>
                            ) : (
                                <MediaPreview src={url} kind={kind} loading="lazy" fallbackLabel={t("library.tasks.row.previewUnavailable")} />
                            )}
                        </button>
                    ))}
                </div>
            ) : null}
            {saveTaskId && resourceId ? <SaveTaskOutputButton taskId={saveTaskId} resourceId={resourceId} /> : null}
        </div>
    );
}

function SaveTaskOutputButton({ taskId, resourceId }: { taskId: string; resourceId: string }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [saving, setSaving] = useState(false);
    const save = async () => {
        if (saving) return;
        setSaving(true);
        try {
            await saveGenerationOutputToLibrary(taskId, resourceId);
            message.success(t("library.tasks.detail.savedToLibrary"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("library.tasks.detail.saveToLibraryFailed"));
        } finally {
            setSaving(false);
        }
    };
    return (
        <div className="flex justify-end">
            <Button icon={<BookmarkPlus />} loading={saving} onClick={() => void save()}>
                {t("library.tasks.detail.saveToLibrary")}
            </Button>
        </div>
    );
}

function TaskAudioPreview({ url, label }: { url: string; label: string }) {
    const { t } = useTranslation();
    const [failed, setFailed] = useState(false);
    const audioRef = useRef<HTMLAudioElement>(null);
    useEffect(() => {
        const player = audioRef.current;
        return () => {
            if (player && !player.paused) player.pause();
        };
    }, [failed]);
    return (
        <div className="task-detail-audio-result">
            <Music2 aria-hidden="true" />
            {failed ? <p role="status">{t("library.tasks.detail.audioUnavailable")}</p> : <audio ref={audioRef} controls controlsList="nodownload" preload="metadata" aria-label={label} src={url} onError={() => setFailed(true)} />}
        </div>
    );
}
