import { CanvasWorkspaceAssetPanel } from "./canvas-workspace-asset-panel";
import { CanvasWorkspaceHistoryPanel } from "./canvas-workspace-history-panel";
import type { InsertAssetPayload } from "./asset-picker-modal";
import { useDeferredValue, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type Ref } from "react";
import { Button, Grid } from "antd";
import { Home, Layers3, Images, ListChecks, History, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { AppDrawer } from "@/components/ui/product/app-drawer";
import { searchCanvasNodes } from "@/lib/canvas/canvas-node-search";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { canvasDockStyle } from "@/lib/canvas/canvas-aceternity-style";
import { canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import type { CanvasNodeData } from "@/types/canvas";
import type { GenerationTask } from "@/services/api/task-center";
import { useCanvasWorkspaceTasks } from "@/pages/canvas/use-canvas-workspace-tasks";
import { CanvasWorkspaceNodeListPanel } from "./canvas-workspace-node-list-panel";
import { CanvasWorkspaceTaskPanel } from "./canvas-workspace-task-panel";
import "./canvas-workspace-panel.css";

export function CanvasWorkspacePanel({
    heading,
    railMenu,
    railFooter,
    railToolsRef,
    projectId,
    nodes,
    selectedNodeIds,
    onClose,
    open,
    onOpen,
    onInsertAssets,
    onFocus,
    onAssets,
    onProjectAssets,
    onCancelTask,
}: {
    heading?: ReactNode;
    railMenu?: ReactNode;
    railFooter?: ReactNode;
    railToolsRef?: Ref<HTMLDivElement>;
    projectId: string;
    nodes: CanvasNodeData[];
    selectedNodeIds: Set<string>;
    onClose: () => void;
    open: boolean;
    onOpen: () => void;
    onInsertAssets: (payloads: InsertAssetPayload[]) => Promise<unknown>;
    onFocus: (id: string) => void;
    onAssets: () => void;
    onProjectAssets?: () => void;
    onCancelTask: (task: GenerationTask) => void;
}) {
    const [tab, setTab] = useState("nodes");
    const theme = canvasThemes[useActiveTheme()];
    const [query, setQuery] = useState("");
    const history = tab === "history";
    const deferredQuery = useDeferredValue(query);
    const config = useEffectiveConfig();
    const results = useMemo(() => (open && tab === "nodes" ? searchCanvasNodes(nodes, deferredQuery, nodes.length, config) : []), [open, tab, nodes, deferredQuery, config]);
    const toggleRef = useRef<HTMLButtonElement>(null);
    const closePanel = () => {
        onClose();
        toggleRef.current?.focus();
    };
    const markPointer = (event: PointerEvent<HTMLElement>) => {
        event.currentTarget.dataset.inputModality = "pointer";
    };
    const markKeyboard = (event: KeyboardEvent<HTMLElement>) => {
        if (event.key === "Tab" || event.key === "Enter" || event.key === " ") event.currentTarget.dataset.inputModality = "keyboard";
    };
    const tasks = useCanvasWorkspaceTasks(projectId, open && (tab === "tasks" || history));
    const content = (
        <div
            className="canvas-workspace-panel relative flex h-full min-h-0 flex-col text-foreground"
            style={{ "--canvas-workspace-base": theme.node.panel } as CSSProperties}
            data-canvas-no-zoom
            data-canvas-wheel-scroll
            onWheel={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
        >
            <button className="canvas-workspace-close" type="button" aria-label="关闭工作区" onClick={closePanel}>
                <X className="size-4" />
            </button>
            {tab === "nodes" && <CanvasWorkspaceNodeListPanel nodes={nodes} config={config} results={results} query={query} deferredQuery={deferredQuery} selectedNodeIds={selectedNodeIds} onQueryChange={setQuery} onFocus={onFocus} />}
            {tab === "assets" && <CanvasWorkspaceAssetPanel onInsert={onInsertAssets} onManage={onAssets} onProjectAssets={onProjectAssets} />}
            {(tab === "tasks" || history) && (
                <>
                    {tasks.error ? (
                        <div role="alert" className="p-4">
                            任务加载失败。<Button onClick={() => void tasks.refetch()}>重试</Button>
                        </div>
                    ) : tasks.loading ? (
                        <p className="p-4">正在加载任务…</p>
                    ) : history ? (
                        <CanvasWorkspaceHistoryPanel tasks={tasks.allTasks} refreshing={tasks.refreshing} onRefresh={() => void tasks.refetch()} onCancelTask={onCancelTask} />
                    ) : (
                        <CanvasWorkspaceTaskPanel
                            tasks={history ? tasks.allTasks : tasks.tasks.filter((t) => t.status === "queued" || t.status === "running")}
                            refreshing={tasks.refreshing}
                            onRefresh={() => void tasks.refetch()}
                            onCancelTask={onCancelTask}
                        />
                    )}
                </>
            )}
        </div>
    );
    const entries = [
        { id: "nodes", label: "节点", icon: Layers3 },
        { id: "assets", label: "素材库", icon: Images },
        { id: "tasks", label: "任务", icon: ListChecks },
        { id: "history", label: "历史", icon: History },
    ];
    return (
        <div
            className={`canvas-workspace-corner${open ? " is-expanded" : ""}`}
            style={{ ...canvasDockStyle(theme), background: undefined, boxShadow: undefined, "--canvas-workspace-base": theme.node.panel, "--canvas-workspace-outline": theme.toolbar.border } as CSSProperties}
            data-canvas-no-zoom
            onWheel={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {heading}
            <div
                className="canvas-workspace-shell"
                onKeyDown={(event) => {
                    const target = event.target as Element;
                    if (open && event.key === "Escape" && !event.defaultPrevented && event.currentTarget.contains(target) && !target.closest(".canvas-workspace-rail-menu")) {
                        event.stopPropagation();
                        closePanel();
                    }
                }}
            >
                <nav className="canvas-workspace-rail" aria-label="画布左侧菜单" data-canvas-wheel-scroll>
                    {railMenu ? <div className="canvas-workspace-rail-menu">{railMenu}</div> : null}
                    <div className="canvas-workspace-rail-items">
                        {entries.map(({ id, label, icon: Icon }) => (
                            <button
                                key={id}
                                type="button"
                                className="canvas-workspace-rail-button"
                                title={open && tab === id ? `收起${label}` : `打开${label}`}
                                aria-pressed={open && tab === id}
                                onPointerDown={markPointer}
                                onKeyDown={markKeyboard}
                                onClick={(event) => {
                                    toggleRef.current = event.currentTarget;
                                    if (open && tab === id) onClose();
                                    else {
                                        setTab(id);
                                        onOpen();
                                    }
                                }}
                            >
                                <Icon />
                                <span>{label}</span>
                            </button>
                        ))}
                    </div>
                    {railToolsRef ? <div ref={railToolsRef} className="canvas-workspace-rail-items canvas-workspace-rail-tools" /> : null}
                    {railFooter ? <div className="canvas-workspace-rail-footer">{railFooter}</div> : null}
                </nav>
                {open ? (
                    <aside id="canvas-workspace-details" className="min-h-0 min-w-0 flex-1" aria-label="画布工作区">
                        {content}
                    </aside>
                ) : null}
            </div>
        </div>
    );
}
