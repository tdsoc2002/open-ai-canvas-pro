import type { ViewportTransform } from "@/types/canvas";
import type { CanvasBounds, CanvasViewportSize } from "./canvas-viewport";

const CONTENT_PADDING = 500;
const MAP_PADDING = 8;
const MIN_FRAME_SIZE = 4;

export function projectCanvasMinimap(content: CanvasBounds | null, viewport: ViewportTransform, viewportSize: CanvasViewportSize, mapSize: CanvasViewportSize) {
    const bounds = content ?? { left: 0, top: 0, right: 0, bottom: 0 };
    const centerX = (bounds.left + bounds.right) / 2;
    const centerY = (bounds.top + bounds.bottom) / 2;
    const viewWidth = viewportSize.width / viewport.k;
    const viewHeight = viewportSize.height / viewport.k;
    const viewCenterX = (viewportSize.width / 2 - viewport.x) / viewport.k;
    const viewCenterY = (viewportSize.height / 2 - viewport.y) / viewport.k;

    // 以节点区域为中心扩展地图，平移视口时才能看出它相对节点的位置变化。
    const halfWidth = Math.max((bounds.right - bounds.left) / 2, Math.abs(viewCenterX - centerX) + viewWidth / 2) + CONTENT_PADDING;
    const halfHeight = Math.max((bounds.bottom - bounds.top) / 2, Math.abs(viewCenterY - centerY) + viewHeight / 2) + CONTENT_PADDING;
    const scale = Math.min((mapSize.width / 2 - MAP_PADDING) / halfWidth, (mapSize.height / 2 - MAP_PADDING) / halfHeight);
    const x = mapSize.width / 2 - centerX * scale;
    const y = mapSize.height / 2 - centerY * scale;
    const width = Math.max(MIN_FRAME_SIZE, Math.round(viewWidth * scale));
    const height = Math.max(MIN_FRAME_SIZE, Math.round(viewHeight * scale));
    const left = Math.round(x + viewCenterX * scale - width / 2);
    const top = Math.round(y + viewCenterY * scale - height / 2);

    return { x, y, scale, frame: { left, top, width, height } };
}
