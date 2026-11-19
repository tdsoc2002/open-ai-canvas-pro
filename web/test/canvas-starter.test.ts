import { describe, expect, test } from "bun:test";

import { resolveCanvasEmptyStateKind } from "../src/lib/canvas/canvas-starter";

describe("canvas starter", () => {
    test("opens a standalone canvas without a welcome panel when short drama is enabled", () => {
        expect(resolveCanvasEmptyStateKind({ nodeCount: 0, shortDramaEnabled: true, isProjectLinked: false })).toBe("none");
    });

    test("opens a standalone canvas without a fallback panel when short drama is disabled", () => {
        expect(resolveCanvasEmptyStateKind({ nodeCount: 0, shortDramaEnabled: false, isProjectLinked: false })).toBe("none");
    });

    test("keeps linked projects on their project-specific empty state", () => {
        expect(resolveCanvasEmptyStateKind({ nodeCount: 0, shortDramaEnabled: true, isProjectLinked: true })).toBe("linked");
    });

    test("hides the project-specific empty state once the canvas has nodes", () => {
        expect(resolveCanvasEmptyStateKind({ nodeCount: 1, shortDramaEnabled: true, isProjectLinked: true })).toBe("none");
    });
});
