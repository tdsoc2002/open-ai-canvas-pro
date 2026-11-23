// 节点提示词面板的参考素材区：已连接参考的缩略图货架、自动 @ 引用工具与拖拽排序。

import { Image as AntImage, Popover, Switch } from "antd";
import { AtSign, FileText, GripVertical, ImageIcon, Link2, Maximize2, Music2, Pencil, Plus, SlidersHorizontal, UserRound, Video, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { type ReactNode, useState } from "react";
import { usePopoverAnchorAlign } from "@/hooks/use-popover-anchor-align";
import { CanvasNodeType } from "@/types/canvas";
import type { CanvasTheme } from "./canvas-node-prompt-panel";

export function ReferenceToolsPopover({
    canAutoMention,
    autoLinkEnabled,
    onAutoMention,
    onAutoLinkEnabledChange,
    compact,
}: {
    canAutoMention: boolean;
    autoLinkEnabled: boolean;
    onAutoMention: () => void;
    onAutoLinkEnabledChange: (enabled: boolean) => void;
    compact: boolean;
}) {
    const [open, setOpen] = useState(false);
    const popoverRef = usePopoverAnchorAlign(open);
    return (
        <Popover
            ref={popoverRef}
            open={open}
            onOpenChange={setOpen}
            trigger="click"
            placement="topRight"
            classNames={{ root: "canvas-reference-tools-popover", container: "canvas-reference-tools-surface" }}
            styles={{
                root: { width: "min(232px, calc(100vw - 24px))", filter: "none" },
                container: { padding: "var(--space-2)" },
                content: { padding: 0, color: "var(--popover-foreground)" },
            }}
            arrow={false}
            content={
                <>
                    <div className="px-2 pt-1 text-sm font-semibold leading-5">智能引用</div>
                    <div className="px-2 py-2">
                        <div className="flex min-h-7 items-center justify-between gap-3 text-sm">
                            <span className="flex items-center gap-2">
                                <Link2 aria-hidden className="size-3.5 text-muted-foreground" />
                                AutoLink
                            </span>
                            <Switch size="small" checked={autoLinkEnabled} onChange={onAutoLinkEnabledChange} aria-label="AutoLink" />
                        </div>
                        <div className="text-xs leading-5 text-muted-foreground">
                            输入素材名称或序号，按 <kbd className="rounded border border-border px-1 font-sans text-[11px]">Tab</kbd> 引用
                        </div>
                    </div>
                    <div className="border-t border-border pt-1">
                        <button
                            type="button"
                            className="canvas-reference-tools-mention-button flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-sm transition-colors disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-65"
                            disabled={!canAutoMention}
                            onClick={onAutoMention}
                        >
                            <AtSign aria-hidden className="size-3.5" />
                            一键引用全文
                        </button>
                    </div>
                </>
            }
        >
            <button
                type="button"
                className={`canvas-node-composer-settings-trigger canvas-node-composer-reference-tools-trigger inline-flex shrink-0 items-center gap-1 ${compact ? "is-compact" : ""}`}
                aria-label="智能引用"
                aria-expanded={open}
                title="智能引用"
            >
                <SlidersHorizontal aria-hidden className="size-3.5" />
                {!compact ? <span>引用</span> : null}
            </button>
        </Popover>
    );
}

export function referenceShelfHeading(references: CanvasResourceReference[]) {
    const label = references.every((reference) => reference.kind === "image" || reference.kind === "character") ? "参考图" : "参考素材";
    return `${label} · ${references.length}`;
}

export function ConnectedReferenceShelf({
    targetNodeId,
    references,
    frameSlots,
    theme,
    onInsert,
    onPick,
    onRemove,
    onReorder,
    onReplaceReference,
    onReplaceReferenceFiles,
}: {
    targetNodeId?: string;
    references: CanvasResourceReference[];
    frameSlots?: ReactNode;
    theme: CanvasTheme;
    onInsert: (reference: CanvasResourceReference) => void;
    onPick?: () => void;
    onRemove?: (reference: CanvasResourceReference) => void;
    onReorder?: (orderedNodeIds: string[]) => void;
    onReplaceReference?: (oldReference: CanvasResourceReference, sourceNodeId: string) => void;
    onReplaceReferenceFiles?: (oldReference: CanvasResourceReference, files: File[]) => void;
}) {
    const { t } = useTranslation();
    const activeReferences = references.filter((item) => item.active && item.kind !== "skill" && item.kind !== "tool");
    const [imagePreview, setImagePreview] = useState<CanvasResourceReference | null>(null);
    const [draggedReferenceId, setDraggedReferenceId] = useState<string | null>(null);
    const [dropTargetReferenceId, setDropTargetReferenceId] = useState<string | null>(null);
    if (!activeReferences.length && !onPick && !frameSlots) return null;

    const moveReference = (sourceId: string, targetId: string) => {
        if (!onReorder || sourceId === targetId) return;
        const sourceIndex = activeReferences.findIndex((reference) => reference.nodeId === sourceId);
        const targetIndex = activeReferences.findIndex((reference) => reference.nodeId === targetId);
        if (sourceIndex < 0 || targetIndex < 0) return;
        const ordered = [...activeReferences];
        const [moved] = ordered.splice(sourceIndex, 1);
        ordered.splice(targetIndex, 0, moved);
        onReorder(ordered.map((reference) => reference.nodeId));
    };

    const moveReferenceByOffset = (sourceId: string, offset: -1 | 1) => {
        const sourceIndex = activeReferences.findIndex((reference) => reference.nodeId === sourceId);
        const target = activeReferences[sourceIndex + offset];
        if (!target) return;
        moveReference(sourceId, target.nodeId);
    };

    return (
        <>
            <div className="canvas-node-composer-references" role="group" aria-label="已连接素材">
                <div className="canvas-node-composer-references-track thin-scrollbar">
                    {frameSlots}
                    {activeReferences.map((reference, index) => {
                        const canPreview = Boolean(reference.previewUrl) && (reference.kind === "image" || reference.kind === "character" || reference.kind === "video");
                        const isDropTarget = dropTargetReferenceId === reference.id;
                        return (
                            <span
                                key={reference.id}
                                className="canvas-node-reference-chip relative"
                                data-reference-chip="true"
                                data-reference-id={reference.id}
                                data-reference-node-id={reference.nodeId}
                                data-reference-label={reference.label}
                                data-reference-title={reference.title || reference.label}
                                data-target-node-id={targetNodeId}
                                data-dragging={draggedReferenceId === reference.nodeId || undefined}
                                data-drop-target={isDropTarget ? "true" : undefined}
                                onDragOver={(event) => {
                                    if (draggedReferenceId) {
                                        if (!onReorder) return;
                                        event.preventDefault();
                                        event.dataTransfer.dropEffect = "move";
                                        return;
                                    }
                                    const hasImageNode = event.dataTransfer.types.includes("application/x-canvas-image-node-id");
                                    const hasFiles = event.dataTransfer.types.includes("Files");
                                    if (hasImageNode || hasFiles) {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        event.dataTransfer.dropEffect = "copy";
                                        if (dropTargetReferenceId !== reference.id) {
                                            setDropTargetReferenceId(reference.id);
                                        }
                                    }
                                }}
                                onDragLeave={(event) => {
                                    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                                        if (dropTargetReferenceId === reference.id) {
                                            setDropTargetReferenceId(null);
                                        }
                                    }
                                }}
                                onDrop={(event) => {
                                    if (dropTargetReferenceId === reference.id) {
                                        setDropTargetReferenceId(null);
                                    }
                                    if (draggedReferenceId) {
                                        event.preventDefault();
                                        const sourceId = draggedReferenceId || event.dataTransfer.getData("text/plain");
                                        setDraggedReferenceId(null);
                                        moveReference(sourceId, reference.nodeId);
                                        return;
                                    }
                                    const sourceNodeId = event.dataTransfer.getData("application/x-canvas-image-node-id");
                                    if (sourceNodeId && sourceNodeId !== reference.nodeId && onReplaceReference) {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        onReplaceReference(reference, sourceNodeId);
                                        return;
                                    }
                                    const files = Array.from(event.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
                                    if (files.length && onReplaceReferenceFiles) {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        onReplaceReferenceFiles(reference, files);
                                        return;
                                    }
                                }}
                            >
                                {onReorder ? (
                                    <button
                                        type="button"
                                        className="canvas-node-reference-drag-handle"
                                        draggable
                                        title={`拖动调整 ${reference.label} 的顺序`}
                                        aria-label={`调整 ${reference.label} 的顺序；使用左右方向键也可移动`}
                                        onDragStart={(event) => {
                                            setDraggedReferenceId(reference.nodeId);
                                            event.dataTransfer.effectAllowed = "move";
                                            event.dataTransfer.setData("text/plain", reference.nodeId);
                                        }}
                                        onDragEnd={() => setDraggedReferenceId(null)}
                                        onKeyDown={(event) => {
                                            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                                            event.preventDefault();
                                            moveReferenceByOffset(reference.nodeId, event.key === "ArrowLeft" ? -1 : 1);
                                        }}
                                        onPointerDown={(event) => event.stopPropagation()}
                                    >
                                        <GripVertical className="size-3" />
                                    </button>
                                ) : null}
                                <span className="canvas-node-reference-order" aria-hidden>
                                    {index + 1}
                                </span>
                                <button
                                    type="button"
                                    className="canvas-node-reference-preview"
                                    style={{ background: theme.toolbar.itemHover, color: theme.node.text, outlineColor: theme.node.activeStroke }}
                                    title={canPreview ? `预览 ${reference.title}` : `插入 @${reference.label}`}
                                    aria-label={canPreview ? `预览 ${reference.title}` : `插入 @${reference.label}`}
                                    onClick={() => (canPreview ? setImagePreview(reference) : onInsert(reference))}
                                >
                                    <ReferenceThumbnail reference={reference} />
                                    {canPreview ? (
                                        <span className="canvas-node-reference-preview-hint" aria-hidden="true">
                                            <Maximize2 className="size-3" />
                                        </span>
                                    ) : null}
                                </button>
                                <button type="button" className="canvas-node-reference-label" aria-label={`插入 @${reference.label}`} title={`插入 @${reference.label}`} onClick={() => onInsert(reference)}>
                                    <span className="opacity-55">@</span>
                                    <span className="truncate">{reference.label}</span>
                                </button>
                                {onRemove ? (
                                    <button
                                        type="button"
                                        className="canvas-node-reference-remove"
                                        style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text }}
                                        title="移除参考并删除连接"
                                        aria-label={`移除参考 ${reference.label}`}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onRemove(reference);
                                        }}
                                        onPointerDown={(event) => event.stopPropagation()}
                                    >
                                        <X className="size-3" />
                                    </button>
                                ) : null}
                            </span>
                        );
                    })}
                    {onPick ? (
                        <button type="button" className="canvas-node-reference-add" aria-label={t("canvasB.mention.searchLabel")} title={t("canvasB.mention.searchLabel")} onMouseDown={(event) => event.preventDefault()} onClick={onPick}>
                            <Plus aria-hidden />
                        </button>
                    ) : null}
                </div>
            </div>
            {imagePreview?.previewUrl ? (
                <AntImage
                    src={imagePreview.previewUrl}
                    alt={imagePreview.title || imagePreview.label}
                    style={{ display: "none" }}
                    preview={{
                        open: true,
                        movable: true,
                        minScale: 0.5,
                        maxScale: 12,
                        scaleStep: 0.25,
                        onOpenChange: (open) => !open && setImagePreview(null),
                    }}
                />
            ) : null}
        </>
    );
}

export function ReferenceThumbnail({ reference }: { reference: CanvasResourceReference }) {
    if (reference.kind === "image" && reference.previewUrl) return <img src={reference.previewUrl} alt="" className="size-full object-cover" />;
    if (reference.kind === "video" && reference.previewUrl) return <img src={reference.previewUrl} alt="" className="size-full bg-black object-cover" loading="lazy" decoding="async" />;
    if (reference.kind === "character" && reference.previewUrl) return <img src={reference.previewUrl} alt="" className="size-full bg-black/5 object-contain" />;

    const Icon = reference.sourceType === CanvasNodeType.Drawing ? Pencil : reference.kind === "character" ? UserRound : reference.kind === "audio" ? Music2 : reference.kind === "video" ? Video : reference.kind === "image" ? ImageIcon : FileText;
    return (
        <span className="grid size-full place-items-center bg-black/10 text-current dark:bg-white/10">
            <Icon className="size-3.5 opacity-75" />
        </span>
    );
}
