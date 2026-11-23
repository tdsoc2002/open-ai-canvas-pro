import { useCallback, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import { useTranslation } from "react-i18next";
import { canvasThemes } from "@/lib/canvas-theme";
import { isFrameNode, visibleCanvasMinimapNodes } from "@/lib/canvas/canvas-frame";
import { subscribeCanvasViewportPreview } from "@/lib/canvas/canvas-live-viewport";
import { projectCanvasMinimap } from "@/lib/canvas/canvas-minimap";
import { getCanvasNodesBounds } from "@/lib/canvas/canvas-viewport";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";

const MINIMAP_SIZE = { width: 176, height: 116 };

type MinimapProps = {
    nodes: CanvasNodeData[];
    viewport: ViewportTransform;
    viewportSize: { width: number; height: number };
    canvasContainerRef?: RefObject<HTMLDivElement | null>;
    onViewportPreviewChange?: (viewport: ViewportTransform) => void;
    onViewportChange: (viewport: ViewportTransform) => void;
};

export function Minimap({ nodes, viewport, viewportSize, canvasContainerRef, onViewportPreviewChange, onViewportChange }: MinimapProps) {
    const theme = canvasThemes[useActiveTheme()];
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const liveViewportRef = useRef(viewport);
    const dragRef = useRef<{ pointerId: number; clientX: number; clientY: number; viewport: ViewportTransform; scale: number } | null>(null);
    const { t } = useTranslation();
    const { width, height } = MINIMAP_SIZE;
    const displayNodes = useMemo(() => visibleCanvasMinimapNodes(nodes), [nodes]);
    const contentBounds = useMemo(() => getCanvasNodesBounds(displayNodes), [displayNodes]);
    const updateViewportRect = useCallback(
        (nextViewport: ViewportTransform) => {
            liveViewportRef.current = nextViewport;
            drawMinimap(canvasRef.current, displayNodes, projectCanvasMinimap(contentBounds, nextViewport, viewportSize, MINIMAP_SIZE), theme);
        },
        [contentBounds, displayNodes, theme, viewportSize],
    );

    useEffect(() => updateViewportRect(viewport), [updateViewportRect, viewport]);
    useEffect(() => {
        const canvasContainer = canvasContainerRef?.current;
        if (!canvasContainer) return;
        return subscribeCanvasViewportPreview(canvasContainer, updateViewportRect);
    }, [canvasContainerRef, updateViewportRect]);

    const previewViewport = (next: ViewportTransform) => {
        liveViewportRef.current = next;
        if (onViewportPreviewChange) onViewportPreviewChange(next);
        else updateViewportRect(next);
    };

    const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (dragRef.current || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const rect = event.currentTarget.getBoundingClientRect();
        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;
        const current = liveViewportRef.current;
        const { x, y, scale, frame } = projectCanvasMinimap(contentBounds, current, viewportSize, MINIMAP_SIZE);
        if (pointerX < frame.left || pointerX > frame.left + frame.width || pointerY < frame.top || pointerY > frame.top + frame.height) {
            previewViewport({ x: viewportSize.width / 2 - ((pointerX - x) / scale) * current.k, y: viewportSize.height / 2 - ((pointerY - y) / scale) * current.k, k: current.k });
        }
        // 固定这一轮拖动的换算比例，避免地图扩展时鼠标位移被重复放大。
        dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, viewport: liveViewportRef.current, scale };
    };

    const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const { viewport: start, scale } = drag;
        const ratio = start.k / scale;
        previewViewport({ x: start.x - (event.clientX - drag.clientX) * ratio, y: start.y - (event.clientY - drag.clientY) * ratio, k: start.k });
    };

    const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.pointerId !== event.pointerId) return;
        dragRef.current = null;
        onViewportChange(liveViewportRef.current);
    };

    return (
        <div className="canvas-minimap pointer-events-auto absolute bottom-full left-0 mb-[var(--space-2)] overflow-hidden rounded-lg outline outline-1 outline-border" style={{ width, height, background: theme.node.panel }} data-canvas-no-zoom>
            <div className="relative h-full w-full touch-none cursor-crosshair" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
                <canvas ref={canvasRef} width={width} height={height} className="pointer-events-none block size-full" aria-label={t("canvasB.miniMap.label")} />
            </div>
        </div>
    );
}

function drawMinimap(canvas: HTMLCanvasElement | null, nodes: CanvasNodeData[], projection: ReturnType<typeof projectCanvasMinimap>, theme: (typeof canvasThemes)[keyof typeof canvasThemes]) {
    if (!canvas) return;
    const { width: mapWidth, height: mapHeight } = MINIMAP_SIZE;
    const pixelRatio = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(mapWidth * pixelRatio);
    const pixelHeight = Math.round(mapHeight * pixelRatio);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(pixelWidth / mapWidth, 0, 0, pixelHeight / mapHeight, 0, 0);
    context.clearRect(0, 0, mapWidth, mapHeight);
    context.fillStyle = theme.node.text;
    context.strokeStyle = theme.node.text;
    context.lineWidth = 1;
    const { x, y, scale, frame } = projection;
    for (const node of nodes) {
        const left = Math.round(x + node.position.x * scale);
        const top = Math.round(y + node.position.y * scale);
        const width = Math.max(Math.round(node.width * scale), 2);
        const height = Math.max(Math.round(node.height * scale), 2);
        if (isFrameNode(node) && !node.metadata?.frame?.collapsed) {
            context.globalAlpha = 0.25;
            context.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);
        } else {
            context.globalAlpha = 0.32;
            context.fillRect(left, top, width, height);
        }
    }
    const { left, top, width, height } = frame;
    context.globalAlpha = 0.05;
    context.fillRect(left, top, width, height);
    context.globalAlpha = 0.72;
    context.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);
}
