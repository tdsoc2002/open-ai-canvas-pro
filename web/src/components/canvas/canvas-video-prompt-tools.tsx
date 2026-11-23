import { type CSSProperties, type DragEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight, Check, ChevronDown, Image as ImageIcon, Plus } from "lucide-react";
import { observeMovablePopupAnchor } from "@/lib/movable-popup-anchor";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import type { CanvasNodeMetadata, CanvasVideoFrameKey } from "@/types/canvas";
import { useTranslation } from "react-i18next";

type VideoFrameOption = {
    nodeId: string;
    label: string;
    title: string;
    previewUrl?: string;
};

type CompactMenuItem = {
    value: string;
    label: string;
    previewUrl?: string;
};

type FrameSlot = "start" | "end";

type CanvasVideoPromptToolsProps = {
    metadata?: CanvasNodeMetadata;
    frameOptions: VideoFrameOption[];
    singleFrame?: boolean;
    onMetadataChange: (patch: Partial<CanvasNodeMetadata>) => void;
    referenceMode?: "frames" | "all";
    referenceSummary?: { imageCount: number; videoCount: number; audioCount: number };
    disabled?: boolean;
    thumbnailSlots?: boolean;
    onUploadFrame?: (key: CanvasVideoFrameKey) => void;
};

const EMPTY_FRAME_VALUE = "__none__";
const UPLOAD_FRAME_VALUE = "__upload__";
const FRAME_DRAG_TYPE = "application/x-canvas-video-frame";
const MENU_GAP = 6;
const MENU_MARGIN = 8;
const MENU_ITEM_HEIGHT = 28;
const CONTROL_TEXT_STYLE: CSSProperties = { fontFamily: "inherit", fontSize: 11, fontWeight: 400, letterSpacing: 0, lineHeight: 1 };

function frameSlotAt(target: EventTarget): FrameSlot | undefined {
    const slot = target instanceof Element ? target.closest<HTMLElement>("[data-frame-slot]")?.dataset.frameSlot : undefined;
    if (slot === "start" || slot === "end") return slot;
}

export function CanvasVideoPromptTools({ metadata, frameOptions, onMetadataChange, referenceMode = "frames", referenceSummary, singleFrame, disabled, thumbnailSlots, onUploadFrame }: CanvasVideoPromptToolsProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useActiveTheme()];
    const startFrame = metadata?.videoStartFrameNodeId || EMPTY_FRAME_VALUE;
    const endFrame = metadata?.videoEndFrameNodeId || EMPTY_FRAME_VALUE;
    const hasStartFrame = frameOptions.some((item) => item.nodeId === startFrame);
    const hasEndFrame = frameOptions.some((item) => item.nodeId === endFrame);
    const canDragFrames = Boolean(thumbnailSlots && !singleFrame && !disabled);
    const [draggedFrame, setDraggedFrame] = useState<FrameSlot | null>(null);

    const setFrame = (key: CanvasVideoFrameKey, value: string) => {
        const next = value === EMPTY_FRAME_VALUE ? undefined : value;
        onMetadataChange({ [key]: next });
    };

    const exchangeFrames = () => {
        onMetadataChange({ videoStartFrameNodeId: hasEndFrame ? endFrame : undefined, videoEndFrameNodeId: hasStartFrame ? startFrame : undefined });
    };

    const isFrameDropTarget = (event: DragEvent<HTMLDivElement>) => {
        const target = frameSlotAt(event.target);
        return canDragFrames && draggedFrame !== null && target !== undefined && target !== draggedFrame && event.dataTransfer.types.includes(FRAME_DRAG_TYPE);
    };

    if (referenceMode === "all") {
        const summary = referenceSummary
            ? [
                  referenceSummary.imageCount ? t("canvasC.videoPromptTools.imageCount", { count: referenceSummary.imageCount }) : "",
                  referenceSummary.videoCount ? t("canvasC.videoPromptTools.videoCount", { count: referenceSummary.videoCount }) : "",
                  referenceSummary.audioCount ? t("canvasC.videoPromptTools.audioCount", { count: referenceSummary.audioCount }) : "",
              ]
                  .filter(Boolean)
                  .join(" · ")
            : "";
        return (
            <div
                className="flex min-h-8 min-w-0 items-center gap-2 rounded-md px-2 py-2"
                data-canvas-no-zoom
                style={{ background: theme.toolbar.itemHover, color: theme.node.text }}
                title={t("canvasC.videoPromptTools.workflowReferenceHint")}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <ImageIcon className="size-3.5 shrink-0 opacity-80" />
                <span className="shrink-0 text-[var(--fs-tiny)] font-medium">{t("canvasC.videoPromptTools.workflowReference")}</span>
                <span className="min-w-0 truncate text-[var(--fs-micro)] opacity-65">{summary || t("canvasC.videoPromptTools.noMedia")}</span>
            </div>
        );
    }

    if (!thumbnailSlots && !frameOptions.length) return null;

    return (
        <div
            className="canvas-video-frame-pair"
            data-thumbnail-slots={thumbnailSlots || undefined}
            data-dragging-frame={canDragFrames ? draggedFrame : undefined}
            data-canvas-no-zoom
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onDragStart={(event) => {
                if (!canDragFrames) return;
                const slot = frameSlotAt(event.target);
                if (!slot || !(slot === "start" ? hasStartFrame : hasEndFrame)) return;
                event.stopPropagation();
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(FRAME_DRAG_TYPE, slot);
                setDraggedFrame(slot);
            }}
            onDragOver={(event) => {
                if (!isFrameDropTarget(event)) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
                if (!isFrameDropTarget(event) || event.dataTransfer.getData(FRAME_DRAG_TYPE) !== draggedFrame) return;
                event.preventDefault();
                event.stopPropagation();
                setDraggedFrame(null);
                exchangeFrames();
            }}
            onDragEnd={() => setDraggedFrame(null)}
        >
            <FrameMenu
                label={t("canvasC.videoPromptTools.startFrame")}
                value={startFrame}
                options={frameOptions.filter((item) => item.nodeId !== endFrame)}
                theme={theme}
                disabled={disabled}
                thumbnail={thumbnailSlots}
                dragSlot={canDragFrames ? "start" : undefined}
                onUpload={onUploadFrame ? () => onUploadFrame("videoStartFrameNodeId") : undefined}
                onChange={(value) => setFrame("videoStartFrameNodeId", value)}
            />
            {!singleFrame && (
                <button
                    type="button"
                    className="canvas-video-frame-swap"
                    title={t("canvasC.videoPromptTools.swap")}
                    aria-label={t("canvasC.videoPromptTools.swap")}
                    disabled={disabled || (thumbnailSlots ? !hasStartFrame && !hasEndFrame : !hasStartFrame || !hasEndFrame)}
                    onClick={exchangeFrames}
                >
                    <ArrowLeftRight aria-hidden />
                </button>
            )}
            {(!singleFrame || endFrame !== EMPTY_FRAME_VALUE) && (
                <FrameMenu
                    label={t("canvasC.videoPromptTools.endFrame")}
                    value={endFrame}
                    options={singleFrame ? [] : frameOptions.filter((item) => item.nodeId !== startFrame)}
                    theme={theme}
                    disabled={disabled}
                    thumbnail={thumbnailSlots}
                    dragSlot={canDragFrames ? "end" : undefined}
                    onUpload={!singleFrame && onUploadFrame ? () => onUploadFrame("videoEndFrameNodeId") : undefined}
                    onChange={(value) => setFrame("videoEndFrameNodeId", value)}
                />
            )}
        </div>
    );
}

function FrameMenu({
    label,
    value,
    options,
    theme,
    onChange,
    onUpload,
    disabled,
    thumbnail,
    dragSlot,
}: {
    label: string;
    value: string;
    options: VideoFrameOption[];
    theme: CanvasTheme;
    onChange: (value: string) => void;
    onUpload?: () => void;
    disabled?: boolean;
    thumbnail?: boolean;
    dragSlot?: FrameSlot;
}) {
    const { t } = useTranslation();
    const selected = options.find((item) => item.nodeId === value);
    const items = [
        ...(onUpload ? [{ value: UPLOAD_FRAME_VALUE, label: t("canvasPage.batchReferences.uploadLabel") }] : []),
        { value: EMPTY_FRAME_VALUE, label: t("canvasC.videoPromptTools.none") },
        ...options.map((option) => ({ value: option.nodeId, label: `${option.label} · ${option.title}`, previewUrl: option.previewUrl })),
    ];
    const PlaceholderIcon = (onUpload || thumbnail) && !selected ? Plus : ImageIcon;
    const trigger = (
        <CompactMenuButton
            theme={theme}
            title={label}
            label={selected?.label || t("canvasC.videoPromptTools.none")}
            icon={selected?.previewUrl ? <img src={selected.previewUrl} alt="" draggable={thumbnail ? false : undefined} className="size-6 shrink-0 rounded object-cover" /> : <PlaceholderIcon aria-hidden className="size-5 shrink-0 opacity-60" />}
            disabled={disabled}
            thumbnail={thumbnail}
            value={value}
            items={items}
            menuWidth={220}
            maxMenuHeight={208}
            onSelect={(next) => {
                if (next === UPLOAD_FRAME_VALUE) onUpload?.();
                else onChange(next);
            }}
        />
    );

    if (!thumbnail) return trigger;
    return (
        <div className="canvas-video-frame-slot" data-frame-slot={dragSlot} draggable={Boolean(dragSlot && selected)}>
            <span>{label}</span>
            {trigger}
        </div>
    );
}

function CompactMenuButton({
    theme,
    title,
    label,
    icon,
    value,
    items,
    menuWidth,
    maxMenuHeight,
    onSelect,
    disabled,
    thumbnail,
}: {
    theme: CanvasTheme;
    title: string;
    label: string;
    icon: ReactNode;
    value?: string;
    items: CompactMenuItem[];
    menuWidth: number;
    maxMenuHeight: number;
    onSelect: (value: string) => void;
    disabled?: boolean;
    thumbnail?: boolean;
}) {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
    const menuVisible = open && Boolean(position);

    const updatePosition = () => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const menuHeight = Math.min(maxMenuHeight, items.length * MENU_ITEM_HEIGHT + 8);
        const effectiveMenuWidth = Math.max(menuWidth, Math.round(rect.width));
        const openAbove = rect.bottom + MENU_GAP + menuHeight > window.innerHeight && rect.top > menuHeight + MENU_GAP;
        const maxLeft = Math.max(MENU_MARGIN, window.innerWidth - effectiveMenuWidth - MENU_MARGIN);
        const maxTop = Math.max(MENU_MARGIN, window.innerHeight - menuHeight - MENU_MARGIN);
        const left = Math.min(Math.max(MENU_MARGIN, rect.left), maxLeft);
        const top = openAbove ? Math.max(MENU_MARGIN, rect.top - menuHeight - MENU_GAP) : Math.min(Math.max(MENU_MARGIN, rect.bottom + MENU_GAP), maxTop);
        setPosition({ left, top, maxHeight: menuHeight, width: effectiveMenuWidth });
    };

    useLayoutEffect(() => {
        if (open) updatePosition();
    }, [open, items.length, maxMenuHeight, menuWidth]);

    useLayoutEffect(() => {
        if (menuVisible) menuRef.current?.querySelector("button")?.focus();
    }, [menuVisible]);

    useEffect(() => {
        if (!open) return;
        const close = (event: PointerEvent) => {
            const target = event.target instanceof Node ? event.target : null;
            if (target && (triggerRef.current?.contains(target) || menuRef.current?.contains(target))) return;
            setOpen(false);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            setOpen(false);
            if (menuRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
        };
        const reposition = () => updatePosition();
        const stopMovingAnchor = triggerRef.current ? observeMovablePopupAnchor(triggerRef.current, reposition) : undefined;
        document.addEventListener("pointerdown", close, true);
        document.addEventListener("keydown", closeOnEscape, true);
        window.addEventListener("resize", reposition);
        window.addEventListener("scroll", reposition, true);
        return () => {
            stopMovingAnchor?.();
            document.removeEventListener("pointerdown", close, true);
            document.removeEventListener("keydown", closeOnEscape, true);
            window.removeEventListener("resize", reposition);
            window.removeEventListener("scroll", reposition, true);
        };
    }, [open, items.length, maxMenuHeight, menuWidth]);

    const buttonStyle: CSSProperties = { ...CONTROL_TEXT_STYLE, color: theme.node.text };
    const menuStyle: CSSProperties | undefined = position
        ? {
              left: position.left,
              top: position.top,
              width: position.width,
              maxHeight: position.maxHeight,
              background: theme.toolbar.panel,
              borderColor: theme.toolbar.border,
              color: theme.node.text,
              boxShadow: "0 10px 26px rgba(15,23,42,.14)",
          }
        : undefined;
    const listStyle: CSSProperties | undefined = position ? { maxHeight: Math.max(0, position.maxHeight - 8) } : undefined;

    const menu =
        open && position && typeof document !== "undefined"
            ? createPortal(
                  <div
                      ref={menuRef}
                      data-canvas-no-zoom
                      className="fixed z-[var(--z-toast)] overflow-hidden rounded-[var(--r-lg)] border p-1 backdrop-blur-xl"
                      style={menuStyle}
                      onMouseDown={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                      onWheel={(event) => event.stopPropagation()}
                  >
                      <div className="thin-scrollbar overflow-y-auto" style={listStyle}>
                          {items.map((item) => {
                              const selected = value === item.value;
                              return (
                                  <button
                                      key={item.value}
                                      type="button"
                                      className="flex h-7 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left transition"
                                      style={{ ...CONTROL_TEXT_STYLE, background: selected ? theme.toolbar.itemHover : "transparent", color: selected ? theme.toolbar.activeText : theme.node.text }}
                                      onMouseEnter={(event) => {
                                          event.currentTarget.style.background = theme.toolbar.itemHover;
                                      }}
                                      onMouseLeave={(event) => {
                                          event.currentTarget.style.background = selected ? theme.toolbar.itemHover : "transparent";
                                      }}
                                      onClick={() => {
                                          setOpen(false);
                                          triggerRef.current?.focus();
                                          onSelect(item.value);
                                      }}
                                  >
                                      {item.previewUrl ? <img src={item.previewUrl} alt="" className="size-4 shrink-0 rounded object-cover" /> : null}
                                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                      {selected ? <Check className="size-3.5 shrink-0" /> : null}
                                  </button>
                              );
                          })}
                      </div>
                  </div>,
                  document.body,
              )
            : null;

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                className="canvas-video-frame-trigger"
                style={buttonStyle}
                title={title}
                aria-label={`${title}：${label}`}
                aria-expanded={open}
                disabled={disabled}
                onClick={() => setOpen((value) => !value)}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                {icon}
                {!thumbnail && (
                    <>
                        <span className="min-w-0 flex-1 truncate text-left">
                            <span className="canvas-video-frame-label">{title}</span>
                            {label}
                        </span>
                        <ChevronDown className="size-3 shrink-0 opacity-55" aria-hidden />
                    </>
                )}
            </button>
            {menu}
        </>
    );
}
