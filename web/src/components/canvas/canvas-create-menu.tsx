import type { CSSProperties, ReactNode } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";

export type CanvasCreateCommand = {
    id: string;
    label: string;
    icon: ReactNode;
    badge?: string;
    section: "node" | "workflow" | "project" | "resource";
    onClick: () => void;
};

/** 画布右键和工具栏共用的创建命令面板。 */
export function CanvasCreateMenu({ commands }: { commands: CanvasCreateCommand[] }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useActiveTheme()];
    const projectCommands = commands.filter((command) => command.section === "project");
    const nodeCommands = commands.filter((command) => command.section === "node");
    const footerCommands = [...commands.filter((command) => command.section === "workflow"), ...commands.filter((command) => command.section === "resource")];
    const vars = {
        "--create-line": theme.toolbar.border,
        "--create-hover": theme.toolbar.itemHover,
        "--create-hover-strong": theme.toolbar.activeBg,
        "--create-muted": theme.node.muted,
        "--create-accent": `var(--brand, ${theme.accent.primary})`,
        "--create-accent-soft": "color-mix(in srgb, var(--create-accent) 12%, transparent)",
        color: theme.node.text,
    } as CSSProperties;

    // 画布命令是原生按钮，保留浏览器的键盘焦点，不走统一按钮的输入模式标记。
    return (
        <div className="flex flex-col gap-2 p-1 [&_button:focus-visible]:outline-2! [&_button:focus-visible]:outline-offset-[-2px] [&_button:focus-visible]:outline-solid! [&_button:focus-visible]:outline-[color:var(--create-accent)]!" style={vars}>
            <header className="flex items-center justify-between gap-2 border-b border-[var(--create-line)] pb-2">
                <h2 className="flex min-w-0 items-center gap-2 text-[length:var(--fs-ui)] leading-tight font-semibold">
                    <span className="grid size-8 shrink-0 place-items-center rounded-[var(--r-md)] bg-[var(--create-accent-soft)] text-[var(--create-accent)]">
                        <Plus aria-hidden="true" className="size-3.5" />
                    </span>
                    {t("canvasA.createMenu.title")}
                </h2>
                {projectCommands.map((command) => (
                    <button
                        key={command.id}
                        type="button"
                        className="inline-flex min-h-7 min-w-0 items-center gap-1.5 rounded-[var(--r-full)] bg-[var(--create-hover)] px-2.5 text-[length:var(--fs-label)] font-medium text-[var(--create-muted)] hover:bg-[var(--create-hover-strong)] [&_svg]:size-3.5 [&_svg]:shrink-0"
                        title={command.label}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={command.onClick}
                    >
                        {command.icon}
                        <span className="truncate">{command.label}</span>
                    </button>
                ))}
            </header>

            <div role="group" aria-label={t("canvasA.createMenu.nodesGroup")} className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                {nodeCommands.map((command) => (
                    <button
                        key={command.id}
                        type="button"
                        className="group flex min-h-9 min-w-0 items-center gap-2 rounded-[var(--r-md)] px-1 text-left hover:bg-[var(--create-hover)] motion-safe:transition-colors [@media(pointer:coarse)]:min-h-11"
                        title={command.badge ? t("canvasA.createMenu.commandWithBadge", { label: command.label, badge: command.badge }) : command.label}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={command.onClick}
                    >
                        <span
                            aria-hidden="true"
                            className="grid size-7 shrink-0 place-items-center rounded-[var(--r-md)] bg-[var(--create-hover)] text-[var(--create-muted)] group-hover:bg-[var(--create-accent-soft)] group-hover:text-[var(--create-accent)] group-focus-visible:bg-[var(--create-accent-soft)] group-focus-visible:text-[var(--create-accent)] [&_svg]:size-4 [&_svg]:stroke-[1.75]"
                        >
                            {command.icon}
                        </span>
                        <span className="flex min-w-0 flex-1 items-center gap-1.5">
                            <span className="truncate text-[length:var(--fs-caption)] leading-4 font-medium">{command.label}</span>
                            {command.badge ? <span className="max-w-[40%] shrink-0 truncate rounded-[var(--r-xs)] bg-[var(--create-hover)] px-1 text-[length:var(--fs-label)] leading-4 text-[var(--create-muted)]">{command.badge}</span> : null}
                        </span>
                    </button>
                ))}
            </div>

            {footerCommands.length ? (
                <div role="group" aria-label={t("canvasA.createMenu.footerGroup")} className="rounded-[var(--r-md)] bg-[var(--create-hover)] p-1">
                    <div aria-hidden="true" className="px-2 pt-1 text-[length:var(--fs-label)] leading-4 font-medium text-[var(--create-muted)]">
                        {t("canvasA.createMenu.footerGroup")}
                    </div>
                    <div className="grid grid-cols-2 gap-x-1.5">
                        {footerCommands.map((command) => (
                            <button
                                key={command.id}
                                type="button"
                                className="flex min-h-[var(--canvas-create-resource-height)] min-w-0 items-center gap-2 rounded-[var(--r-xs)] px-2 text-left text-[length:var(--fs-caption)] font-medium hover:bg-[var(--create-hover-strong)] motion-safe:transition-colors [&_svg]:size-3.5"
                                title={command.label}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={command.onClick}
                            >
                                <span className="shrink-0 text-[var(--create-muted)]">{command.icon}</span>
                                <span className="min-w-0 flex-1 truncate">{command.label}</span>
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
