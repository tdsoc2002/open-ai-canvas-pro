import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type KeyboardEvent, type MouseEvent } from "react";
import { AGENT_PANEL_LAYOUT_KEY, anchorAgentPanelLayout, changeAgentPanelLayout, clampAgentPanelLayout, defaultAgentPanelLayout, restoreAgentPanelLayout, type AgentPanelGesture, type AgentPanelLayout } from "@/lib/canvas/agent-panel-layout";
import type { AgentLauncherPosition } from "@/lib/canvas/agent-launcher-position";
import { AGENT_DOCK_DEFAULT_WIDTH, clampAgentDockWidth } from "@/lib/canvas/agent-panel-dock";
import { useGlobalAgentStore } from "@/stores/use-global-agent-store";

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
const MAXIMIZED_GAP = "var(--space-3)";

/** 停靠时只能拖左边缘调宽；浮动时可移动和从左上三个方向调整大小。 */
type PanelGesture = AgentPanelGesture | "dock";

export function useAgentPanelLayout(dock: { active: boolean; width: number } = { active: false, width: AGENT_DOCK_DEFAULT_WIDTH }) {
    const [compact, setCompact] = useState(() => window.innerWidth < 640);
    const [expanded, setExpanded] = useState(false);
    const maximized = expanded && !compact && !dock.active;
    const [layout, setLayout] = useState(() => {
        try {
            return restoreAgentPanelLayout(localStorage.getItem(AGENT_PANEL_LAYOUT_KEY), viewport());
        } catch (error) {
            console.warn("Agent 窗口偏好无法读取", error);
            return restoreAgentPanelLayout(null, viewport());
        }
    });
    const setDockWidth = useGlobalAgentStore((state) => state.setDockWidth);
    const gestureRef = useRef<{ pointerId: number; captureTarget: HTMLElement; kind: PanelGesture; x: number; y: number; start: AgentPanelLayout; dockWidth: number } | null>(null);
    const cornerDragged = useRef(false);

    useEffect(() => {
        const resize = () => {
            setCompact(window.innerWidth < 640);
            if (window.innerWidth >= 640) setLayout((current) => clampAgentPanelLayout(current, viewport()));
        };
        window.addEventListener("resize", resize);
        return () => window.removeEventListener("resize", resize);
    }, []);

    useEffect(() => {
        if (compact) return;
        const timer = window.setTimeout(() => {
            try {
                localStorage.setItem(AGENT_PANEL_LAYOUT_KEY, JSON.stringify(layout));
            } catch (error) {
                console.warn("Agent 窗口偏好无法保存", error);
            }
        }, 120);
        return () => window.clearTimeout(timer);
    }, [compact, layout]);

    const onPointerDown = (event: PointerEvent<HTMLElement>) => {
        if (event.button !== 0 || !event.isPrimary) return;
        cornerDragged.current = false;
        if (compact || maximized) return;
        const target = event.target as HTMLElement;
        const resize = target.closest<HTMLElement>("[data-agent-resize]");
        const kind = resize?.dataset.agentResize as PanelGesture | undefined;
        if (dock.active) {
            if (kind !== "dock") return;
        } else {
            const header = target.closest("[data-agent-drag-handle]");
            if (kind === "dock" || (!resize && (!header || target.closest("button, input, textarea, a, [role=button]")))) return;
        }
        // 角按钮自己捕获指针，让普通点击仍能命中按钮；其余拖拽热区由面板捕获。
        const captureTarget = resize?.tagName === "BUTTON" ? resize : event.currentTarget;
        if (captureTarget === event.currentTarget) event.preventDefault();
        event.stopPropagation();
        captureTarget.setPointerCapture(event.pointerId);
        gestureRef.current = { pointerId: event.pointerId, captureTarget, kind: kind || "move", x: event.clientX, y: event.clientY, start: layout, dockWidth: dock.width };
    };
    const onPointerMove = (event: PointerEvent<HTMLElement>) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        event.stopPropagation();
        if (gesture.kind === "dock") {
            // 面板贴在右侧：左边缘往左拖是变宽。
            setDockWidth(clampAgentDockWidth(gesture.dockWidth - (event.clientX - gesture.x), window.innerWidth));
            return;
        }
        const dx = event.clientX - gesture.x;
        const dy = event.clientY - gesture.y;
        if (gesture.kind === "northwest" && !cornerDragged.current) {
            if (Math.hypot(dx, dy) < 4) return;
            cornerDragged.current = true;
        }
        setLayout(changeAgentPanelLayout(gesture.start, gesture.kind, dx, dy, viewport()));
    };
    const onPointerUp = (event: PointerEvent<HTMLElement>) => {
        const gesture = gestureRef.current;
        if (gesture?.pointerId !== event.pointerId) return;
        gestureRef.current = null;
        if (gesture.captureTarget.hasPointerCapture(event.pointerId)) gesture.captureTarget.releasePointerCapture(event.pointerId);
    };
    const onResizeKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (maximized) return;
        const kind = event.currentTarget.dataset.agentResize as PanelGesture;
        const delta = event.shiftKey ? 40 : 10;
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        if (kind === "dock") {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") setDockWidth(clampAgentDockWidth(dock.width + (event.key === "ArrowLeft" ? delta : -delta), window.innerWidth));
            return;
        }
        setLayout((current) => changeAgentPanelLayout(current, kind, event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0, event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0, viewport()));
    };

    const style: CSSProperties = compact
        ? { left: 0, top: 8, width: "100%", height: "calc(100dvh - 8px)" }
        : dock.active
          ? { top: 0, right: 0, width: dock.width, height: "100dvh" }
          : maximized
            ? { left: MAXIMIZED_GAP, top: MAXIMIZED_GAP, right: MAXIMIZED_GAP, bottom: MAXIMIZED_GAP }
            : layout;
    const placeAtLauncher = useCallback(
        (position: AgentLauncherPosition) => {
            setExpanded(false);
            if (!compact) setLayout((current) => anchorAgentPanelLayout(current, position, viewport()));
        },
        [compact],
    );

    return {
        style,
        placeAtLauncher,
        maximized,
        onToggleMaximized: (event: MouseEvent<HTMLButtonElement>) => {
            if (event.detail !== 0 && cornerDragged.current) return;
            setExpanded((current) => !current);
        },
        reset: () => {
            if (dock.active) setDockWidth(AGENT_DOCK_DEFAULT_WIDTH);
            else {
                setExpanded(false);
                setLayout(defaultAgentPanelLayout(viewport()));
            }
        },
        onResizeKeyDown,
        pointerHandlers: {
            onPointerDown,
            onPointerMove,
            onPointerUp,
            onPointerCancel: onPointerUp,
            onLostPointerCapture: () => {
                gestureRef.current = null;
            },
        },
    };
}
