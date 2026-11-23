import { useMemo, useState, type ReactNode } from "react";
import { App, Button, Input } from "antd";
import { ArrowLeft, Crosshair, Download, Pencil, Play, Search, Star, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { buildCanvasAssetCatalog, CANVAS_ASSET_KIND_LABELS, type CanvasAssetEntry, type CanvasAssetKind, type CanvasAssetVersion } from "@/lib/canvas/canvas-asset-catalog";
import { mediaVersionPreviewNode } from "@/lib/canvas/canvas-media-versions";
import { currentLocale, translate } from "@/i18n";
import { formatBytes } from "@/lib/image-utils";
import type { CanvasNodeData } from "@/types/canvas";

import { canvasAssetText, CanvasAssetPreview, CanvasAssetThumbnail } from "./canvas-asset-preview";
import "./canvas-asset-view.css";

type CanvasAssetViewProps = {
    nodes: CanvasNodeData[];
    onExit: () => void;
    onLocate: (nodeId: string) => void;
    onRename: (updates: Array<{ nodeId: string; title: string }>) => void;
    onPromoteVersion: (version: CanvasAssetVersion) => void;
    onDownloadMedia: (node: CanvasNodeData) => void | Promise<void>;
    onUpload: () => void;
};

const FILTERS = ["all", "image", "video", "documents", "audio"] as const;
type AssetFilter = (typeof FILTERS)[number];

function matchesQuery(entry: CanvasAssetEntry, query: string) {
    return !query || entry.title.toLowerCase().includes(query) || entry.versions.some((version) => version.label.toLowerCase().includes(query));
}

/**
 * 画布资产默认全部展示；文档筛选同时涵盖文本与 Markdown，版本在详情里切换。
 * 数据完全由当前画布节点派生；所有写操作（重命名、设为主版本）都回到画布的现有写路径。
 */
export function CanvasAssetView({ nodes, onExit, onLocate, onRename, onPromoteVersion, onDownloadMedia, onUpload }: CanvasAssetViewProps) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const entries = useMemo(() => buildCanvasAssetCatalog(nodes).flatMap((group) => group.entries), [nodes]);
    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const [queryInput, setQueryInput] = useState("");
    const [filter, setFilter] = useState<AssetFilter>("all");
    const [selection, setSelection] = useState<{ entryKey: string; versionKey?: string } | null>(null);
    const query = queryInput.trim().toLowerCase();
    const matchingEntries = useMemo(
        () =>
            entries.filter((entry) => {
                const category = entry.kind === "txt" || entry.kind === "markdown" ? "documents" : entry.kind;
                return (filter === "all" || filter === category) && matchesQuery(entry, query);
            }),
        [entries, filter, query],
    );
    const selectedEntry = selection ? entries.find((entry) => entry.key === selection.entryKey) : undefined;
    const filterLabel = (kind: AssetFilter) => (kind === "all" || kind === "documents" ? t(`canvasA.assetView.${kind}`) : t(`canvasA.media.${kind}`));

    const download = async (node: CanvasNodeData, kind: CanvasAssetKind) => {
        try {
            if (kind === "txt" || kind === "markdown") downloadCanvasText(node, kind);
            else await onDownloadMedia(node);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvasA.assetView.downloadFailed"));
        }
    };

    return (
        <div className="canvas-asset-view flex size-full min-h-0 min-w-0 flex-col bg-background text-foreground" data-canvas-no-zoom data-canvas-wheel-scroll>
            {selectedEntry ? (
                <AssetDetail
                    key={selectedEntry.key}
                    entry={selectedEntry}
                    version={selectedEntry.versions.find((item) => item.key === selection?.versionKey)}
                    nodeById={nodeById}
                    onSelectVersion={(version) => setSelection({ entryKey: selectedEntry.key, versionKey: version.key })}
                    onBack={() => setSelection(null)}
                    onLocate={onLocate}
                    onRename={onRename}
                    onPromoteVersion={onPromoteVersion}
                    onDownload={download}
                />
            ) : (
                <>
                    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-3 py-2.5 sm:px-6">
                        <div className="flex shrink-0 items-center gap-2">
                            <Button type="text" className="!size-8" icon={<ArrowLeft className="size-4" aria-hidden="true" />} onClick={onExit} aria-label={t("canvasA.assetView.backToCanvas")} title={t("canvasA.assetView.backToCanvas")} />
                            <h1 className="!m-0 flex h-8 items-center gap-2 text-lg leading-none font-semibold tracking-tight">
                                {t("canvasA.assetView.title")}
                                <span className="inline-flex h-5 items-center rounded-full bg-surface-hover px-2 text-xs leading-none font-medium text-muted-foreground tabular-nums">{entries.length}</span>
                            </h1>
                        </div>
                        <div role="group" aria-label={t("canvasA.assetView.filterLabel")} className="flex min-w-0 flex-wrap items-center gap-1 max-sm:basis-full">
                            {FILTERS.map((kind) => (
                                <button
                                    key={kind}
                                    type="button"
                                    aria-pressed={filter === kind}
                                    className="inline-flex min-h-8 items-center rounded-[var(--r-md)] px-2.5 text-sm leading-none text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 aria-pressed:bg-surface-active aria-pressed:font-semibold aria-pressed:text-foreground"
                                    onClick={() => setFilter(kind)}
                                >
                                    {filterLabel(kind)}
                                </button>
                            ))}
                        </div>
                        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 max-md:basis-full md:flex-none">
                            <Input
                                allowClear
                                className="min-w-0 sm:!w-44"
                                prefix={<Search className="size-3.5 text-muted-foreground" aria-hidden="true" />}
                                placeholder={t("canvasA.assetView.searchPlaceholder")}
                                aria-label={t("canvasA.assetView.searchLabel")}
                                value={queryInput}
                                onChange={(event) => setQueryInput(event.target.value)}
                            />
                            <Button type="primary" className="shrink-0" icon={<Upload className="size-4" aria-hidden="true" />} onClick={onUpload} aria-label={t("canvasA.assetView.uploadLabel")}>
                                {t("canvasA.assetView.upload")}
                            </Button>
                        </div>
                    </header>
                    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-6 sm:py-4">
                        {matchingEntries.length ? (
                            <AssetGrid entries={matchingEntries} nodeById={nodeById} onOpen={(entry) => setSelection({ entryKey: entry.key })} />
                        ) : (
                            <p role="status" className="m-0 rounded-[var(--r-lg)] border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
                                {query ? t("canvasA.assetView.noMatches") : filter === "all" ? t("canvasA.assetView.empty") : t("canvasA.assetView.emptyKind", { kind: filterLabel(filter) })}
                            </p>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

function AssetGrid({ entries, nodeById, onOpen }: { entries: CanvasAssetEntry[]; nodeById: Map<string, CanvasNodeData>; onOpen: (entry: CanvasAssetEntry) => void }) {
    return (
        <ul className="canvas-asset-grid m-0 list-none p-0">
            {entries.map((entry) => {
                const node = nodeById.get(entry.nodeId);
                if (!node) return null;
                return (
                    <li key={entry.key} className="group min-w-0">
                        <button type="button" className="block w-full rounded-[var(--r-lg)] text-left focus-visible:outline-2 focus-visible:outline-offset-2" onClick={() => onOpen(entry)}>
                            <span aria-hidden="true" className="canvas-asset-thumbnail relative block overflow-hidden rounded-[var(--r-lg)] border border-border bg-surface-hover group-hover:border-foreground/30">
                                <CanvasAssetThumbnail node={node} kind={entry.kind} />
                                {entry.kind === "video" ? (
                                    <span className="absolute bottom-2 right-2 grid size-6 place-items-center rounded-full bg-black/65 text-white">
                                        <Play className="size-3 fill-current" />
                                    </span>
                                ) : null}
                            </span>
                            <span className="mt-1.5 block truncate text-sm font-medium" title={entry.title}>
                                {entry.title}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{assetSubtitle(entry, node)}</span>
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}

function assetSubtitle(entry: CanvasAssetEntry, node: CanvasNodeData) {
    const parts: string[] = [];
    if (entry.versions.length > 1) parts.push(translate("canvasA.assetView.versionCount", { count: entry.versions.length }));
    const bytes = formatBytes(node.metadata?.bytes || 0);
    if (bytes && (entry.kind === "audio" || entry.kind === "video")) parts.push(bytes);
    if ((entry.kind === "txt" || entry.kind === "markdown") && canvasAssetText(node)) parts.push(translate("canvasA.assetView.charCount", { count: canvasAssetText(node).length }));
    if (entry.updatedAt) parts.push(formatDate(entry.updatedAt));
    return parts.join(" · ") || CANVAS_ASSET_KIND_LABELS[entry.kind];
}

function formatDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(currentLocale(), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

type AssetDetailProps = {
    entry: CanvasAssetEntry;
    version?: CanvasAssetVersion;
    nodeById: Map<string, CanvasNodeData>;
    onSelectVersion: (version: CanvasAssetVersion) => void;
    onBack: () => void;
    onLocate: (nodeId: string) => void;
    onRename: CanvasAssetViewProps["onRename"];
    onPromoteVersion: CanvasAssetViewProps["onPromoteVersion"];
    onDownload: (node: CanvasNodeData, kind: CanvasAssetKind) => Promise<void>;
};

function AssetDetail({ entry, version, nodeById, onSelectVersion, onBack, onLocate, onRename, onPromoteVersion, onDownload }: AssetDetailProps) {
    const { t } = useTranslation();
    const activeVersion = version || entry.versions.find((item) => item.primary) || entry.versions[0];
    const baseNode = nodeById.get(activeVersion?.nodeId || entry.nodeId) || nodeById.get(entry.nodeId);
    const previewNode = useMemo(() => {
        if (!baseNode || !activeVersion?.mediaVersionId) return baseNode;
        const media = baseNode.metadata?.mediaVersions?.find((item) => item.id === activeVersion.mediaVersionId);
        return media ? mediaVersionPreviewNode(baseNode, media) : baseNode;
    }, [activeVersion?.mediaVersionId, baseNode]);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(entry.title);
    if (!baseNode || !previewNode) return null;

    const commitRename = () => {
        setEditing(false);
        const title = draft.trim();
        if (!title || title === entry.title) return;
        onRename(renameUpdates(entry, title, nodeById));
    };

    return (
        <>
            <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2 sm:px-5">
                <button type="button" className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-[var(--r-sm)] text-xs text-muted-foreground hover:text-foreground" onClick={onBack}>
                    <ArrowLeft className="size-4" aria-hidden="true" />
                    {t("canvasA.assetView.title")}
                </button>
                <span className="text-xs text-muted-foreground" aria-hidden="true">
                    /
                </span>
                {editing ? (
                    <Input
                        autoFocus
                        size="small"
                        className="!max-w-sm"
                        aria-label={t("canvasA.assetView.nameLabel")}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={commitRename}
                        onPressEnter={commitRename}
                        onKeyDown={(event) => {
                            if (event.key === "Escape") {
                                setDraft(entry.title);
                                setEditing(false);
                            }
                        }}
                    />
                ) : (
                    <>
                        <button type="button" className="min-w-0 truncate text-sm font-semibold" title={t("canvasA.assetView.renameHint")} onClick={() => setEditing(true)}>
                            {entry.title}
                        </button>
                        <Button type="text" size="small" aria-label={t("canvasA.assetView.rename")} icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)} />
                    </>
                )}
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    {activeVersion && activeVersion.promotable && !activeVersion.primary && entry.versions.length > 1 ? (
                        <Button size="small" icon={<Star className="size-3.5" />} onClick={() => onPromoteVersion(activeVersion)}>
                            {t("canvasA.assetView.setPrimary")}
                        </Button>
                    ) : null}
                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => void onDownload(previewNode, entry.kind)}>
                        {t("canvasA.assetView.download")}
                    </Button>
                    <Button size="small" type="primary" icon={<Crosshair className="size-3.5" />} onClick={() => onLocate(baseNode.id)}>
                        {t("canvasA.assetView.locate")}
                    </Button>
                </div>
            </header>
            <div className="flex min-h-0 flex-1 max-lg:flex-col">
                <div className="grid min-h-0 min-w-0 flex-1 place-items-center overflow-hidden bg-[var(--workspace-surface)] p-4">
                    <CanvasAssetPreview node={previewNode} kind={entry.kind} />
                </div>
                <aside className="thin-scrollbar w-72 shrink-0 overflow-y-auto border-l border-border p-4 text-sm max-lg:max-h-[45%] max-lg:w-full max-lg:border-l-0 max-lg:border-t" aria-label={t("canvasA.assetView.info")}>
                    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
                        <InfoRow label={t("canvasA.assetView.type")}>{CANVAS_ASSET_KIND_LABELS[entry.kind]}</InfoRow>
                        {activeVersion ? (
                            <InfoRow label={t("canvasA.assetView.version")}>
                                {activeVersion.label}
                                {activeVersion.primary ? t("canvasA.assetView.primarySuffix") : ""}
                            </InfoRow>
                        ) : null}
                        {previewNode.metadata?.naturalWidth && previewNode.metadata.naturalHeight ? <InfoRow label={t("canvasA.assetView.size")}>{`${previewNode.metadata.naturalWidth} × ${previewNode.metadata.naturalHeight}`}</InfoRow> : null}
                        {previewNode.metadata?.durationMs ? <InfoRow label={t("canvasA.assetView.duration")}>{t("canvasA.approval.seconds", { count: (previewNode.metadata.durationMs / 1000).toFixed(1) })}</InfoRow> : null}
                        {formatBytes(previewNode.metadata?.bytes || 0) ? <InfoRow label={t("canvasA.assetView.fileSize")}>{formatBytes(previewNode.metadata?.bytes || 0)}</InfoRow> : null}
                        {previewNode.metadata?.producedModel || previewNode.metadata?.model ? <InfoRow label={t("canvasA.assetView.model")}>{previewNode.metadata.producedModel || previewNode.metadata.model}</InfoRow> : null}
                        {activeVersion?.origin ? <InfoRow label={t("canvasA.assetView.origin")}>{activeVersion.origin === "generate" ? t("canvasA.assetView.originGenerate") : t("canvasA.assetView.originUpload")}</InfoRow> : null}
                        {entry.updatedAt ? <InfoRow label={t("canvasA.assetView.updated")}>{formatDate(entry.updatedAt)}</InfoRow> : null}
                    </dl>
                    {(entry.kind === "image" || entry.kind === "video" || entry.kind === "audio") && previewNode.metadata?.prompt ? (
                        <section className="mt-4">
                            <h3 className="m-0 mb-1 text-xs font-medium text-muted-foreground">{t("canvasA.assetView.prompt")}</h3>
                            <p className="m-0 line-clamp-[12] whitespace-pre-wrap break-words text-xs leading-5">{previewNode.metadata.prompt}</p>
                        </section>
                    ) : null}
                    {entry.versions.length > 1 ? (
                        <section className="mt-4">
                            <h3 className="m-0 mb-2 text-xs font-medium text-muted-foreground">{t("canvasA.assetView.allVersions", { count: entry.versions.length })}</h3>
                            <ul className="m-0 flex list-none flex-col gap-1 p-0">
                                {entry.versions.map((item) => (
                                    <li key={item.key}>
                                        <button
                                            type="button"
                                            className={`flex w-full items-center gap-2 rounded-[var(--r-md)] px-2 py-1.5 text-left text-xs hover:bg-foreground/5 ${item.key === activeVersion?.key ? "bg-foreground/10 font-medium" : ""}`}
                                            aria-current={item.key === activeVersion?.key ? "true" : undefined}
                                            onClick={() => onSelectVersion(item)}
                                        >
                                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                            {item.primary ? <Star className="size-3.5 shrink-0 fill-current" aria-label={t("canvasA.assetView.primaryVersion")} /> : null}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ) : null}
                </aside>
            </div>
        </>
    );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="m-0 min-w-0 break-words">{children}</dd>
        </>
    );
}

/** 重命名一个资产：跨节点版本组保留各自的 A/B 后缀，其余只改承载节点。 */
function renameUpdates(entry: CanvasAssetEntry, title: string, nodeById: Map<string, CanvasNodeData>) {
    const memberIds = entry.versions.some((version) => version.source === "version-group") ? Array.from(new Set(entry.versions.map((version) => version.nodeId))) : [entry.nodeId];
    return memberIds.flatMap((nodeId) => {
        const node = nodeById.get(nodeId);
        if (!node) return [];
        const label = entry.versions.some((version) => version.source === "version-group") ? node.metadata?.versionLabel : undefined;
        return [{ nodeId, title: label ? `${title} · ${label}` : title }];
    });
}

function downloadCanvasText(node: CanvasNodeData, kind: "txt" | "markdown") {
    const extension = kind === "markdown" ? "md" : "txt";
    const baseName = (node.title || translate("canvasA.media.text")).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\.(txt|md|markdown)$/i, "");
    const fileName = `${baseName}.${extension}`;
    // 上传的文本在画布上可能已被编辑，下载当前正文而不是上传时的原始资源。
    const url = URL.createObjectURL(new Blob([canvasAssetText(node)], { type: kind === "markdown" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8" }));
    try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        anchor.style.display = "none";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
    } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }
}
