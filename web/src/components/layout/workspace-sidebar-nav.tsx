import { Popover } from "antd";
import { ChevronRight, CircleUserRound, History as HistoryIcon, Image as ImageIcon, Lightbulb, PanelLeftClose, PanelLeftOpen, ShoppingBag, Video } from "lucide-react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { AuthLoginLink } from "@/components/auth/auth-login-link";
import { UserGroupAvatarRing, UserGroupBadge } from "@/components/layout/user-group-badge";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { useThemePack } from "@/themes/use-theme-pack";
import { WorkspaceAccountCard } from "./workspace-account-card";
import { UserAvatar } from "./user-avatar";
import { BrandLogoFrame } from "@/components/brand/brand-logo";
import { Kbd } from "@/components/ui/base/kbd";
import { AntTooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { useWorkspaceLogout } from "@/hooks/use-workspace-logout";
import { cn } from "@/lib/utils";
import { preloadWorkspaceRoute } from "@/lib/workspace-route-modules";
import { useUserStore, type FeatureAvailability } from "@/stores/use-user-store";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useTaskHistoryUnreadStore } from "@/stores/use-task-history-unread-store";
import { WorkspaceSidebarCheckin } from "./workspace-sidebar-checkin";
import { openWorkspaceWallet } from "@/lib/workspace-wallet";
import { trackSiteTrafficAction } from "@/services/site-traffic";
import { WorkspaceSidebarHistory } from "./workspace-sidebar-history";
import "./workspace-sidebar-history.css";

export type WorkspaceNavItem = {
    id: string;
    title: string;
    icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
    to?: string;
    shortcut?: string;
    badge?: string | number;
    unread?: boolean;
    action?: "search" | "logout";
    children?: WorkspaceNavItem[];
};

type WorkspaceNavGroup = {
    heading: string;
    items: WorkspaceNavItem[];
};

function toolItem(slug: NavigationToolSlug, to: string, t: TFunction): WorkspaceNavItem {
    const tool = navigationTools.find((item) => item.slug === slug);
    return { id: slug, title: tool ? t(tool.labelKey) : slug, icon: tool?.icon, to };
}

function buildNav(features: FeatureAvailability, t: TFunction, historyUnread: boolean, joysee: boolean): WorkspaceNavGroup[] {
    const assets = { ...toolItem("assets", "/assets", t), title: t("nav.sidebar.assets") };
    const canvas = { ...toolItem("canvas", "/canvas", t), title: t("nav.sidebar.canvas") };
    const projects = features.shortDramaEnabled ? [{ ...toolItem("projects", "/projects", t), title: t("nav.sidebar.projects") }] : [];
    const skills = { ...toolItem("skills", "/skills", t), title: t("nav.sidebar.skills") };
    const plugins = features.pluginCenterEnabled ? [{ ...toolItem("plugins", "/plugins", t), title: t("nav.sidebar.plugins") }] : [];
    const inspirations = { id: "inspirations", title: t("nav.sidebar.inspirations"), icon: Lightbulb, to: "/inspirations" };
    const tasks = features.taskCenterEnabled ? [{ id: "tasks", title: t("nav.sidebar.history"), icon: HistoryIcon, to: "/tasks", unread: historyUnread }] : [];
    const groups: WorkspaceNavGroup[] = [
        {
            heading: t("nav.sections.create"),
            items: [
                { ...toolItem("create", "/", t), id: "home", title: t("nav.sidebar.home") },
                ...(joysee ? [...projects, canvas] : [assets, canvas, ...projects]),
                ...(features.ecommerceEnabled ? [{ id: "ecommerce", title: t("nav.sidebar.ecommerce"), icon: ShoppingBag, to: "/ecommerce" }] : []),
            ],
        },
        {
            heading: t("nav.sidebar.headingGeneration"),
            items: [
                ...(features.imageWorkbenchEnabled ? [{ id: "toolbox-image", title: t("nav.sidebar.toolboxImage"), icon: ImageIcon, to: "/toolbox/image" }] : []),
                ...(features.videoWorkbenchEnabled ? [{ id: "toolbox-video", title: t("nav.sidebar.toolboxVideo"), icon: Video, to: "/toolbox/video" }] : []),
                ...(joysee ? [] : [skills, ...plugins, ...tasks, inspirations]),
            ],
        },
        ...(joysee
            ? [
                  { heading: t("nav.sidebar.headingAssets"), items: [assets, ...tasks] },
                  { heading: t("nav.sidebar.headingTools"), items: [skills, ...plugins, inspirations] },
              ]
            : []),
    ];

    return groups.filter(({ items }) => items.length > 0);
}

function WorkspaceSidebarProfile({ collapsed, user }: { collapsed: boolean; user: NonNullable<ReturnType<typeof useUserStore.getState>["user"]> | null }) {
    const [menuOpen, setMenuOpen] = useState(false);
    const { t } = useTranslation();
    const userGroup = useUserStore((state) => state.userGroup);
    const profileName = user?.displayName || user?.username || t("shell.guest");

    if (!user) {
        return (
            <AuthLoginLink className={cn("app-workspace-sidebar-profile", collapsed && "is-collapsed")} aria-label={t("shell.login")} title={t("shell.login")}>
                <span className="app-workspace-sidebar-profile-avatar">
                    <CircleUserRound aria-hidden />
                </span>
                {!collapsed ? <span>{t("shell.guest")}</span> : null}
            </AuthLoginLink>
        );
    }

    const content = (
        <WorkspaceAccountCard
            onNavigate={() => setMenuOpen(false)}
            onWallet={() => {
                setMenuOpen(false);
                openWorkspaceWallet();
            }}
        />
    );

    return (
        <div className={cn("app-workspace-sidebar-account", collapsed && "is-collapsed")}>
            <WorkspaceSidebarCheckin collapsed={collapsed} />
            <div className={cn("app-workspace-sidebar-profile-row", collapsed && "is-collapsed")}>
                <Popover open={menuOpen} onOpenChange={setMenuOpen} trigger="click" placement="topLeft" arrow={false} rootClassName="workspace-account-popover" content={content}>
                    <button type="button" className={cn("app-workspace-sidebar-profile", collapsed && "is-collapsed")} aria-label={t("shell.openAccountMenu")} title={profileName}>
                        <UserGroupAvatarRing>
                            <UserAvatar user={user} className="app-workspace-sidebar-profile-avatar" />
                        </UserGroupAvatarRing>
                        {!collapsed ? (
                            <span className="app-workspace-sidebar-profile-copy">
                                <strong>{profileName}</strong>
                                {userGroup?.badgeStyle === "vip" || userGroup?.badgeStyle === "svip" ? <UserGroupBadge className="self-start" /> : <span>{t("shell.workbench")}</span>}
                            </span>
                        ) : null}
                    </button>
                </Popover>
            </div>
        </div>
    );
}

function WorkspaceSwitcher({ collapsed, onNavigate, onExpand, onCollapse }: { collapsed: boolean; onNavigate: () => void; onExpand: () => void; onCollapse: () => void }) {
    const joysee = useThemePack()?.workspaceStyle === "joysee";
    const appearance = useAppearanceStore((state) => state.appearance);
    const { t } = useTranslation();
    const toggleLabel = t(collapsed ? "shell.expandSidebarMenu" : "shell.collapseSidebar");
    const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
    // 未上传自定义 Logo 时用内置取景框字形（与欢迎页、登录框、加载页同一个 /logo.svg），放在墨色实底方块里；
    // 自定义 Logo 的配色不可预知，改用中性浅底方块承托。
    const mark = (
        <BrandLogoFrame
            className={cn("app-workspace-brand-mark grid shrink-0 place-items-center", !appearance.logoConfigured && "is-builtin")}
            logoClassName="size-5 object-contain"
            alt=""
            fallback={<span className="app-workspace-brand-glyph" aria-hidden />}
        />
    );
    return (
        <div className={cn("app-workspace-sidebar-brand-row relative shrink-0", collapsed && "is-collapsed")}>
            <Link to="/" onClick={onNavigate} className="app-workspace-sidebar-brand-button group" aria-label={t("shell.brandHome", { brand: appearance.brandName })}>
                {mark}
                {!collapsed ? <span className="app-workspace-brand-wordmark truncate">{appearance.brandName}</span> : null}
            </Link>
            <button
                type="button"
                className={cn("product-icon-button app-workspace-brand-toggle", joysee && "app-workspace-sidebar-collapse-toggle")}
                aria-label={toggleLabel}
                aria-expanded={!collapsed}
                title={toggleLabel}
                onClick={collapsed ? onExpand : onCollapse}
            >
                <ToggleIcon aria-hidden strokeWidth={1.7} />
            </button>
        </div>
    );
}

function NavItem({
    item,
    activeId,
    onSelect,
    onOpenSearch,
    onLogout,
    level = 0,
    collapsed = false,
}: {
    item: WorkspaceNavItem;
    activeId: string;
    onSelect: (id: string) => void;
    onOpenSearch: () => void;
    onLogout: () => void;
    level?: number;
    collapsed?: boolean;
}) {
    const isActive = activeId === item.id || (item.id === "settings" && activeId.startsWith("settings:"));
    const hasChildren = Boolean(item.children?.length);
    const [isOpen, setIsOpen] = useState(false);

    // 激活分支自动展开（如设置分区子项），保证当前位置可见。
    useEffect(() => {
        if (isActive && hasChildren) setIsOpen(true);
    }, [isActive, hasChildren]);

    const Icon = item.icon;
    const { t } = useTranslation();
    const joysee = useThemePack()?.workspaceStyle === "joysee";
    const reducedMotion = useReducedMotion();
    const activePill = isActive && !joysee ? <motion.span layoutId="workspace-nav-active-pill" className="app-workspace-nav-active-pill" aria-hidden transition={reducedMotion ? { duration: 0 } : aceternityMotion.spring.dock} /> : null;
    const accessibleTitle = item.unread ? `${item.title} · ${t("library.tasks.page.created")}` : item.title;
    const rowStyle = !collapsed && level > 0 ? ({ "--workspace-nav-indent": `${level * 12}px` } as CSSProperties) : undefined;

    const rowContent = (
        <>
            <span className="app-workspace-nav-main flex min-w-0 items-center gap-2">
                {Icon ? (
                    <span className="app-workspace-nav-icon relative" aria-hidden>
                        <Icon className={cn("shrink-0", joysee ? "size-4" : "size-4.5")} strokeWidth={joysee ? 1.8 : 2.2} />
                        {item.unread && collapsed ? <span data-task-history-unread className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-[var(--status-error)]" /> : null}
                    </span>
                ) : (
                    <span className="size-1.5 shrink-0 rounded-full bg-current opacity-40" aria-hidden />
                )}
                <span className="app-workspace-nav-title truncate">{item.title}</span>
                {item.unread && !collapsed ? <span data-task-history-unread className="size-2 shrink-0 rounded-full bg-[var(--status-error)]" aria-hidden /> : null}
            </span>
            <span className="app-workspace-nav-meta flex shrink-0 items-center gap-2">
                {item.shortcut ? <Kbd className="hidden group-hover:inline-flex">{item.shortcut}</Kbd> : null}
                {item.badge !== undefined ? <span className="flex min-w-5 items-center justify-center rounded-full bg-primary/10 px-2 py-0.5 text-[var(--fs-tiny)] font-medium tabular-nums text-primary">{item.badge}</span> : null}
                {hasChildren ? <ChevronRight className={cn("size-3.5 shrink-0 text-foreground/40 transition-transform duration-200", isOpen && "rotate-90")} strokeWidth={2} /> : null}
            </span>
        </>
    );

    const rowClassName = cn(
        "app-workspace-nav-link group relative isolate flex min-h-11 w-full items-center justify-between gap-2 rounded-[var(--r-md)] px-3 py-2 text-[var(--fs-body)] transition-[color,transform] duration-200 select-none",
        collapsed && "is-collapsed",
        isActive ? "is-active font-medium" : "text-foreground/62 hover:bg-surface-hover hover:text-foreground",
    );

    const handleClick = () => {
        if (item.action === "search") {
            onOpenSearch();
            return;
        }
        if (item.action === "logout") {
            onLogout();
            return;
        }
        if (hasChildren) {
            setIsOpen((open) => !open);
            return;
        }
        if (item.to === "/" || item.to === "/create") trackSiteTrafficAction("open_create");
        if (item.to === "/ecommerce") trackSiteTrafficAction("open_ecommerce");
        onSelect(item.id);
    };

    // 局部 const：闭包内 TS 保留窄化，供 preload 回调使用。
    const linkTo = item.to;

    return (
        <div className="flex w-full flex-col">
            <AntTooltip title={collapsed ? accessibleTitle : null} placement="right" trigger={["hover", "focus"]}>
                {linkTo ? (
                    <Link
                        to={linkTo}
                        className={rowClassName}
                        data-nav-id={item.id}
                        style={rowStyle}
                        aria-label={collapsed || item.unread ? accessibleTitle : undefined}
                        aria-current={isActive ? "page" : undefined}
                        onClick={handleClick}
                        onFocus={() => preloadWorkspaceRoute(linkTo)}
                        onPointerDown={() => preloadWorkspaceRoute(linkTo)}
                        onPointerEnter={() => preloadWorkspaceRoute(linkTo)}
                    >
                        {activePill}
                        {rowContent}
                    </Link>
                ) : (
                    <button type="button" className={rowClassName} data-nav-id={item.id} style={rowStyle} aria-label={collapsed ? item.title : undefined} onClick={handleClick} aria-expanded={hasChildren ? isOpen : undefined}>
                        {activePill}
                        {rowContent}
                    </button>
                )}
            </AntTooltip>

            {hasChildren && !collapsed ? (
                <div className={cn("grid transition-[grid-template-rows,opacity] duration-200 ease-in-out motion-reduce:transition-none", isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")} inert={!isOpen}>
                    <div className="relative flex min-h-0 flex-col gap-0.5 overflow-hidden pt-0.5">
                        {item.children!.map((child) => (
                            <NavItem key={child.id} item={child} activeId={activeId} onSelect={onSelect} onOpenSearch={onOpenSearch} onLogout={onLogout} level={level + 1} collapsed={false} />
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function NavGroup({ group, activeId, onNavigate, onOpenSearch, onLogout, collapsed }: { group: WorkspaceNavGroup; activeId: string; onNavigate: () => void; onOpenSearch: () => void; onLogout: () => void; collapsed: boolean }) {
    const hasActive = group.items.some((item) => item.id === activeId || (item.id === "settings" && activeId.startsWith("settings:")));
    const [isOpen, setIsOpen] = useState(true);

    // 激活项所在分组自动展开，保证当前位置可见。
    useEffect(() => {
        if (hasActive) setIsOpen(true);
    }, [hasActive, activeId]);

    const content = (
        <div className="flex flex-col gap-1">
            {group.items.map((item) => (
                <NavItem key={item.id} item={item} activeId={activeId} onSelect={onNavigate} onOpenSearch={onOpenSearch} onLogout={onLogout} collapsed={collapsed} />
            ))}
        </div>
    );

    return (
        <div className="app-workspace-nav-group flex shrink-0 flex-col" data-nav-group-heading={group.heading}>
            {!collapsed ? (
                <button type="button" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen} className="app-workspace-nav-group-toggle select-none">
                    <span className="app-workspace-nav-group-label">{group.heading}</span>
                    <ChevronRight className={cn("size-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none", isOpen && "rotate-90")} strokeWidth={2} aria-hidden />
                </button>
            ) : null}
            <div className={cn("grid transition-[grid-template-rows,opacity] duration-200 ease-in-out motion-reduce:transition-none", collapsed || isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")} inert={!collapsed && !isOpen}>
                <div className="min-h-0 overflow-hidden">{content}</div>
            </div>
        </div>
    );
}

// 菜单项 id 与实际路由不一定同名：/toolbox/image 和 /toolbox/video 共用 toolbox 前缀，
// 只取首段会让两者都匹配不到任何菜单项，侧栏因此没有高亮。
export function workspaceNavActiveId(pathname: string, section?: string | null) {
    const segments = pathname.split("/").filter(Boolean);
    if (segments[0] === "toolbox" && segments[1]) return `toolbox-${segments[1]}`;
    const slug = segments[0] || "home";
    if (slug === "create") return "home";
    return slug === "settings" && section ? `settings:${section}` : slug;
}

export function WorkspaceSidebarNav({ collapsed, onNavigate, onOpenSearch, onExpand, onCollapse }: { collapsed: boolean; onNavigate: () => void; onOpenSearch: () => void; onExpand: () => void; onCollapse: () => void }) {
    const { pathname } = useLocation();
    const [searchParams] = useSearchParams();
    const features = useUserStore((state) => state.features);
    const user = useUserStore((state) => state.user);
    const historyUnread = useTaskHistoryUnreadStore((state) => Boolean(user && state.byUser[user.id]?.length));
    const { handleLogout } = useWorkspaceLogout();
    const { t, i18n } = useTranslation();
    const joysee = useThemePack()?.workspaceStyle === "joysee";
    const groups = useMemo(() => buildNav(features, t, historyUnread, joysee), [features, t, i18n.language, historyUnread, joysee]);

    const activeId = workspaceNavActiveId(pathname, searchParams.get("section"));

    const scrollRef = useRef<HTMLDivElement>(null);
    const sectionsRef = useRef<HTMLDivElement>(null);
    const [scrollState, setScrollState] = useState({ hasTopFade: false, hasBottomFade: false });
    const handleScroll = () => {
        const element = scrollRef.current;
        if (!element) return;
        const { scrollTop, scrollHeight, clientHeight } = element;
        const next = {
            hasTopFade: scrollTop > 0,
            hasBottomFade: scrollTop + clientHeight < scrollHeight - 1,
        };
        setScrollState((previous) => (previous.hasTopFade === next.hasTopFade && previous.hasBottomFade === next.hasBottomFade ? previous : next));
    };
    useEffect(() => {
        handleScroll();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(handleScroll);
        if (scrollRef.current) observer.observe(scrollRef.current);
        if (sectionsRef.current) observer.observe(sectionsRef.current);
        return () => observer.disconnect();
    }, []);

    return (
        <div className={cn("app-workspace-sidebar-nav flex h-full shrink-0 flex-col", collapsed && "is-collapsed")}>
            <WorkspaceSwitcher collapsed={collapsed} onNavigate={onNavigate} onExpand={onExpand} onCollapse={onCollapse} />

            <LayoutGroup id="workspace-sidebar-nav">
                <div
                    ref={scrollRef}
                    onScroll={handleScroll}
                    className={cn(
                        "app-workspace-sidebar-scroll-area flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pb-3 pt-7",
                        collapsed && "is-collapsed",
                        scrollState.hasTopFade && "has-top-fade",
                        scrollState.hasBottomFade && "has-bottom-fade",
                    )}
                >
                    <div ref={sectionsRef} className="app-workspace-sidebar-sections">
                        <nav className="app-workspace-sidebar-navigation" aria-label={t("nav.sections.create")}>
                            {groups.map((group) => (
                                <NavGroup key={group.heading} group={group} activeId={activeId} onNavigate={onNavigate} onOpenSearch={onOpenSearch} onLogout={() => void handleLogout()} collapsed={collapsed} />
                            ))}
                        </nav>
                        {!collapsed && user ? <WorkspaceSidebarHistory key={user.id} userId={user.id} onNavigate={onNavigate} /> : null}
                    </div>
                </div>
            </LayoutGroup>

            {joysee ? (
                user ? (
                    <div className={cn("app-workspace-sidebar-footer shrink-0 px-3 py-3 empty:hidden", collapsed && "flex justify-center")}>
                        <WorkspaceSidebarCheckin collapsed={collapsed} />
                    </div>
                ) : null
            ) : (
                <div className="app-workspace-sidebar-footer shrink-0 px-3 py-3">
                    <WorkspaceSidebarProfile collapsed={collapsed} user={user} />
                </div>
            )}
        </div>
    );
}
