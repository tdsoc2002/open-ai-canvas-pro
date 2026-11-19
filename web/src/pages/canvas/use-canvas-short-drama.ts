import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { deriveShortDramaProgress, persistShortDramaGuideDismissed, readShortDramaGuideDismissed, type CanvasShortDramaStepId } from "@/lib/canvas/canvas-short-drama";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

type UseCanvasShortDramaOptions = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    nodesRef: { current: CanvasNodeData[] };
    setStylePickerOpen: Dispatch<SetStateAction<boolean>>;
    focusCanvasNode: (nodeId: string) => void;
    openTextEditor: (node: CanvasNodeData) => void;
};

export function useCanvasShortDrama({ nodes, connections, nodesRef, setStylePickerOpen, focusCanvasNode, openTextEditor }: UseCanvasShortDramaOptions) {
    const [guideCollapsed, setGuideCollapsed] = useState(readShortDramaGuideDismissed);
    const progress = useMemo(() => deriveShortDramaProgress(nodes, connections), [connections, nodes]);

    const openStoryInput = useCallback(
        (nodeId?: string) => {
            const storyNode =
                (nodeId ? nodesRef.current.find((node) => node.id === nodeId) : undefined) || nodesRef.current.find((node) => node.metadata?.workflowKind === "story_input") || nodesRef.current.find((node) => node.metadata?.workflowKind === "script");
            if (!storyNode) return;
            focusCanvasNode(storyNode.id);
            queueMicrotask(() => openTextEditor(storyNode));
        },
        [focusCanvasNode, nodesRef, openTextEditor],
    );

    const activateStep = useCallback(
        (stepId: CanvasShortDramaStepId) => {
            const step = progress.steps.find((item) => item.id === stepId);
            if (stepId === "style") {
                if (step?.nodeId) focusCanvasNode(step.nodeId);
                setStylePickerOpen(true);
                return;
            }
            if (stepId === "story") {
                openStoryInput(step?.nodeId);
                return;
            }
            if (step?.nodeId) focusCanvasNode(step.nodeId);
        },
        [focusCanvasNode, openStoryInput, progress.steps, setStylePickerOpen],
    );

    const skipGuide = useCallback(() => {
        persistShortDramaGuideDismissed();
        setGuideCollapsed(true);
    }, []);

    useEffect(() => {
        if (!progress.completed) return;
        persistShortDramaGuideDismissed();
        setGuideCollapsed(true);
    }, [progress.completed]);

    return {
        activateStep,
        guideCollapsed,
        openStoryInput,
        progress,
        setGuideCollapsed,
        skipGuide,
    };
}
