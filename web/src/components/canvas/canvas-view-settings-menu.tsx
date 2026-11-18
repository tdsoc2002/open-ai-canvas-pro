import { useId, useRef, useState, type ComponentProps } from "react";
import { Popover } from "antd";
import { Maximize, Settings2 } from "lucide-react";

import { CanvasAppearanceControls } from "./canvas-appearance-controls";

type CanvasViewSettingsMenuProps = ComponentProps<typeof CanvasAppearanceControls> & { onEnterFocusMode: () => void };

export function CanvasViewSettingsMenu({ onEnterFocusMode, ...controls }: CanvasViewSettingsMenuProps) {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const firstActionRef = useRef<HTMLButtonElement>(null);
    const panelId = useId();
    const { theme } = controls;

    return (
        <Popover
            trigger="click"
            open={open}
            onOpenChange={setOpen}
            afterOpenChange={(visible) => {
                if (visible) firstActionRef.current?.focus({ preventScroll: true });
            }}
            placement="bottom"
            arrow={false}
            styles={{ container: { background: theme.spatial.elevated, color: theme.node.text, border: `1px solid ${theme.toolbar.border}`, borderRadius: "var(--panel-radius)", boxShadow: "var(--elevation-overlay)" } }}
            content={
                <div
                    id={panelId}
                    role="dialog"
                    aria-label="视图设置"
                    data-canvas-no-zoom
                    data-canvas-wheel-scroll
                    className="thin-scrollbar w-[272px] max-w-[calc(100vw_-_var(--space-12))] max-h-[calc(100dvh_-_var(--space-24))] overflow-y-auto overscroll-contain"
                    onPointerDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                        if (event.key !== "Escape" || event.defaultPrevented) return;
                        event.stopPropagation();
                        setOpen(false);
                        triggerRef.current?.focus();
                    }}
                >
                    <h2 className="m-0 text-xs font-semibold">视图设置</h2>
                    <button
                        ref={firstActionRef}
                        type="button"
                        className="mt-2 flex min-h-8 w-full items-center gap-2 rounded-[var(--r-md)] px-2 text-left text-xs hover:bg-surface-hover focus-visible:outline focus-visible:outline-2"
                        onClick={() => {
                            setOpen(false);
                            onEnterFocusMode();
                        }}
                    >
                        <Maximize className="size-3.5" aria-hidden />
                        进入专注模式
                    </button>
                    <CanvasAppearanceControls {...controls} />
                </div>
            }
        >
            <button
                ref={triggerRef}
                type="button"
                aria-label="视图设置"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? panelId : undefined}
                title="视图设置"
                data-canvas-no-zoom
                className="canvas-topbar-action grid size-8 shrink-0 place-items-center rounded-[var(--r-md)] focus-visible:outline focus-visible:outline-2"
                style={{ color: theme.node.text, background: open ? theme.toolbar.itemHover : undefined }}
                onKeyDown={(event) => {
                    if (!open || event.key !== "Escape") return;
                    event.stopPropagation();
                    setOpen(false);
                }}
            >
                <Settings2 className="size-4" aria-hidden />
            </button>
        </Popover>
    );
}
