import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { AGENT_LAUNCHER_POSITION_KEY, clampAgentLauncherPosition, moveAgentLauncher, restoreAgentLauncherPosition, type AgentLauncherGesture, type AgentLauncherPosition } from "@/lib/canvas/agent-launcher-position";

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

/**
 * 入口的拖拽、点击与键盘移动。指针处理器（onPointer*）可以挂在入口按钮上，也可以挂在按钮内的身体热区上
 * （大形象外框不接收指针）；指针捕获落在挂处理器的元素上，因此该元素必须能被命中。
 */
export function useAgentLauncherPosition(onOpen: (position: AgentLauncherPosition) => void, width = 76, height = 76, requiresMouseDoubleClick = false, inCanvasEditor = true, bottomInset = 0) {
    const size = { width, height };
    const preference = useRef<string | null>(null);
    const [position, setPosition] = useState(() => {
        try {
            preference.current = localStorage.getItem(AGENT_LAUNCHER_POSITION_KEY);
        } catch (error) {
            console.warn("Agent 入口位置无法读取", error);
        }
        return restoreAgentLauncherPosition(preference.current, viewport(), size, bottomInset, inCanvasEditor);
    });
    const [dragging, setDragging] = useState(false);
    const gestureRef = useRef<(AgentLauncherGesture & { pointerId: number }) | null>(null);
    const suppressClick = useRef(false);
    const pointerType = useRef("mouse");
    const doubleClickArmed = useRef(false);

    const save = (next: AgentLauncherPosition) => {
        preference.current = JSON.stringify(next);
        try {
            localStorage.setItem(AGENT_LAUNCHER_POSITION_KEY, preference.current);
        } catch (error) {
            console.warn("Agent 入口位置无法保存", error);
        }
    };

    useEffect(() => {
        const resize = () => setPosition((current) => (gestureRef.current ? clampAgentLauncherPosition(current, viewport(), size, bottomInset) : restoreAgentLauncherPosition(preference.current, viewport(), size, bottomInset, inCanvasEditor)));
        resize();
        window.addEventListener("resize", resize);
        return () => window.removeEventListener("resize", resize);
    }, [width, height, inCanvasEditor, bottomInset]);

    const onPointerDown = (event: PointerEvent<HTMLElement>) => {
        event.stopPropagation();
        if (event.button !== 0 || !event.isPrimary || gestureRef.current) return;
        pointerType.current = event.pointerType;
        suppressClick.current = false;
        gestureRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, start: position, dragged: false };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent<HTMLElement>) => {
        event.stopPropagation();
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        const next = moveAgentLauncher(gesture, event.clientX, event.clientY, viewport(), size, bottomInset);
        gesture.dragged = next.dragged;
        if (!next.dragged) return;
        event.preventDefault();
        suppressClick.current = true;
        setDragging(true);
        setPosition(next.position);
    };
    const finish = (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
        event.stopPropagation();
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        gestureRef.current = null;
        const next = cancelled ? { dragged: gesture.dragged, position: clampAgentLauncherPosition(position, viewport(), size, bottomInset) } : moveAgentLauncher(gesture, event.clientX, event.clientY, viewport(), size, bottomInset);
        suppressClick.current = cancelled || next.dragged;
        if (suppressClick.current) doubleClickArmed.current = false;
        setDragging(false);
        setPosition(next.position);
        if (next.dragged) save(next.position);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };
    const onClick = (event: MouseEvent<HTMLElement>) => {
        event.stopPropagation();
        // Keyboard/assistive activation remains available after a drag or cancellation.
        if (event.detail !== 0 && suppressClick.current) {
            event.preventDefault();
            return;
        }
        if (event.detail !== 0 && pointerType.current === "mouse" && requiresMouseDoubleClick) {
            // Uses the browser's click count without delaying touch or keyboard activation.
            const opens = event.detail === 2 && doubleClickArmed.current;
            doubleClickArmed.current = event.detail === 1;
            if (opens) onOpen(position);
            return;
        }
        doubleClickArmed.current = false;
        onOpen(position);
    };
    const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        event.stopPropagation();
        const delta = event.shiftKey ? 40 : 10;
        const offsets: Record<string, [number, number]> = { ArrowLeft: [delta, 0], ArrowRight: [-delta, 0], ArrowUp: [0, delta], ArrowDown: [0, -delta] };
        const offset = offsets[event.key];
        if (!offset) return;
        event.preventDefault();
        const next = clampAgentLauncherPosition({ right: position.right + offset[0], bottom: position.bottom + offset[1] }, viewport(), size, bottomInset);
        setPosition(next);
        save(next);
    };

    return {
        position,
        dragging,
        handlers: {
            onPointerDown,
            onPointerMove,
            onPointerUp: (event: PointerEvent<HTMLElement>) => finish(event, false),
            onPointerCancel: (event: PointerEvent<HTMLElement>) => finish(event, true),
            onLostPointerCapture: (event: PointerEvent<HTMLElement>) => finish(event, true),
            onClick,
            onKeyDown,
            onDoubleClick: (event: MouseEvent<HTMLElement>) => event.stopPropagation(),
        },
    };
}
