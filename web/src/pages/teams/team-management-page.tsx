import { useId, type ReactNode } from "react";
import { ConfigProvider, Tabs, type TabsProps } from "antd";
import type { LucideIcon } from "lucide-react";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { EmptyState } from "@/components/ui/product/empty-state";
import { cn } from "@/lib/utils";

const teamTableTheme = { components: { Table: { headerBg: "var(--muted)", headerSplitColor: "transparent" } } };

export function TeamManagementPage({ children, fill = false }: { children: ReactNode; fill?: boolean }) {
    return (
        <WorkspacePage className={fill ? "flex flex-col *:flex *:grow *:flex-col" : undefined}>
            <div className={cn("@container mx-auto w-full max-w-6xl space-y-6 px-1 pt-3 pb-10 sm:px-3 sm:pt-6", fill && "flex grow flex-col")}>{children}</div>
        </WorkspacePage>
    );
}

export function TeamTableTabs({ items }: { items: NonNullable<TabsProps["items"]> }) {
    return <Tabs className="grow [&_.ant-tabs-body-holder]:grid" classNames={{ body: "grid grid-cols-1", content: "aria-[hidden=false]:grid" }} animated={false} destroyOnHidden={false} items={items} />;
}

export function TeamTableSection({ title, children, className, emptyState }: { title?: string; children: ReactNode; className?: string; emptyState?: { title: string; icon?: LucideIcon } }) {
    const headingId = useId();
    return (
        <section aria-labelledby={title ? headingId : undefined} className={cn("flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card [&_.ant-table-placeholder]:hidden", className)}>
            {title ? (
                <h2 id={headingId} className="px-5 py-4 text-base font-semibold">
                    {title}
                </h2>
            ) : null}
            <ConfigProvider theme={teamTableTheme}>{children}</ConfigProvider>
            {emptyState ? <EmptyState className="grow" size="compact" {...emptyState} /> : null}
        </section>
    );
}
