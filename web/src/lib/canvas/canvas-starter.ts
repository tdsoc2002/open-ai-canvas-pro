export type CanvasStarterMode = "guided" | "freeform";

type CanvasEmptyStateKind = "none" | "linked";

export function resolveCanvasEmptyStateKind({ nodeCount, shortDramaEnabled, isProjectLinked }: { nodeCount: number; shortDramaEnabled: boolean; isProjectLinked: boolean }): CanvasEmptyStateKind {
    return nodeCount === 0 && shortDramaEnabled && isProjectLinked ? "linked" : "none";
}
