import { useEffect, useRef, useState } from "react";
import { Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MediaPreview } from "@/components/media-preview";
import { captureVideoPoster } from "@/lib/video-poster";

/** 只解码进入视口的视频；缩略图随组件释放，不写入用户资产。 */
export function TaskVideoThumbnail({ src, posterUrl, showDuration = false }: { src: string; posterUrl?: string; showDuration?: boolean }) {
    const { t } = useTranslation();
    const container = useRef<HTMLSpanElement>(null);
    const [poster, setPoster] = useState<{ source: string; frameAttempted: boolean; url?: string; durationMs?: number }>();
    const [brokenPoster, setBrokenPoster] = useState("");
    const [nativeFrame, setNativeFrame] = useState<{ source: string; state: "ready" | "failed"; durationMs?: number }>();
    const storedPoster = posterUrl !== brokenPoster ? posterUrl : undefined;
    const captureFrame = !storedPoster;
    const needsCapture = captureFrame || showDuration;
    useEffect(() => {
        if (!needsCapture) return;
        const controller = new AbortController();
        let objectUrl = "";
        let started = false;
        const capture = () => {
            if (started || controller.signal.aborted) return;
            started = true;
            void captureVideoPoster(src, { signal: controller.signal, maxWidth: 400, metadataOnly: !captureFrame })
                .then((result) => {
                    if (controller.signal.aborted) return;
                    if (result.poster) objectUrl = URL.createObjectURL(result.poster);
                    setPoster({ source: src, frameAttempted: captureFrame, url: objectUrl || undefined, durationMs: result.durationMs });
                })
                .catch((error) => {
                    if (controller.signal.aborted) return;
                    setPoster({ source: src, frameAttempted: captureFrame });
                    console.warn("任务视频首帧提取失败", error instanceof Error ? error.name : "UnknownError");
                });
        };
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                observer.disconnect();
                capture();
            }
        });
        if (container.current) observer.observe(container.current);
        return () => {
            controller.abort();
            observer.disconnect();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [captureFrame, needsCapture, src]);
    const captured = poster?.source === src ? poster : undefined;
    const native = nativeFrame?.source === src ? nativeFrame : undefined;
    const imageUrl = storedPoster || (captured?.url !== brokenPoster ? captured?.url : undefined);
    // 跨域媒体可能允许播放但不允许读取像素；提取不到图片时直接显示暂停的首帧。
    const showNativeFrame = !imageUrl && captured?.frameAttempted && native?.state !== "failed";
    const durationMs = native?.durationMs ?? captured?.durationMs;
    const seconds = durationMs && durationMs > 0 ? Math.max(1, Math.round(durationMs / 1000)) : 0;
    const duration = seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "";
    return (
        <span ref={container} className="task-center-video-thumb">
            {imageUrl ? <MediaPreview src={imageUrl} kind="image" loading="lazy" onUnavailable={() => setBrokenPoster(imageUrl)} /> : null}
            {showNativeFrame ? (
                <video
                    key={src}
                    className="task-center-video-frame"
                    data-ready={native?.state === "ready"}
                    src={src}
                    muted
                    playsInline
                    preload="auto"
                    aria-hidden="true"
                    onLoadedData={({ currentTarget }) => {
                        const { videoWidth, duration } = currentTarget;
                        setNativeFrame({ source: src, state: videoWidth > 0 ? "ready" : "failed", durationMs: Number.isFinite(duration) ? Math.round(duration * 1000) : undefined });
                    }}
                    onError={() => setNativeFrame({ source: src, state: "failed" })}
                />
            ) : null}
            {!imageUrl && (!showNativeFrame || native?.state !== "ready") ? (
                <span className="task-center-video-placeholder">
                    <Video aria-hidden="true" />
                    <small>{t("library.tasks.row.videoPreview")}</small>
                </span>
            ) : null}
            {showDuration && duration ? (
                <span className="history-media-duration" aria-label={t("library.tasks.gallery.playbackDuration", { duration })}>
                    {duration}
                </span>
            ) : null}
        </span>
    );
}
