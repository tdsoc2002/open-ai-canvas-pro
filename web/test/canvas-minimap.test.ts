import { expect, test } from "bun:test";

import { projectCanvasMinimap } from "@/lib/canvas/canvas-minimap";
import { viewportAtScale } from "@/lib/canvas/canvas-viewport";

const mapSize = { width: 176, height: 116 };
const viewportSize = { width: 1440, height: 820 };
const content = { left: 300, top: 150, right: 600, bottom: 310 };

test("低缩放下小地图的视口框与外沿分开，且随平移和缩放变化", () => {
    const viewport = { x: 585, y: 341, k: 0.3 };
    const { frame } = projectCanvasMinimap(content, viewport, viewportSize, mapSize);
    const panned = projectCanvasMinimap(content, { ...viewport, x: viewport.x + 180 }, viewportSize, mapSize).frame;
    const zoomed = projectCanvasMinimap(content, viewportAtScale(viewport, viewportSize, 1.73), viewportSize, mapSize).frame;

    expect(frame.left).toBeGreaterThan(0);
    expect(frame.top).toBeGreaterThan(0);
    expect(panned.left).toBeLessThan(frame.left);
    expect(zoomed.width).toBeLessThan(frame.width);
    expect(zoomed.height).toBeLessThan(frame.height);
});

test("空画布或视口远离节点时，小地图内部仍有完整的视口框", () => {
    for (const bounds of [null, content]) {
        const { frame } = projectCanvasMinimap(bounds, { x: -140000, y: 110000, k: 2 }, viewportSize, mapSize);
        expect(frame.left).toBeGreaterThan(0);
        expect(frame.top).toBeGreaterThan(0);
        expect(frame.width).toBeGreaterThanOrEqual(4);
        expect(frame.height).toBeGreaterThanOrEqual(4);
        expect(frame.left + frame.width).toBeLessThan(mapSize.width);
        expect(frame.top + frame.height).toBeLessThan(mapSize.height);
    }
});
