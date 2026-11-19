import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Check, ChevronDown, CircleHelp } from "lucide-react";
import { Popover } from "antd";
import { usePopoverAnchorAlign } from "@/hooks/use-popover-anchor-align";

import { imageQualityLabel } from "@/lib/image-quality";
import { buildImagePriceTable } from "@/lib/image-price-table";
import { formatCreditDisplay, formatCreditPoints } from "@/lib/credit-format";
import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { formatPriceRange, modelQuoteDescription, modelQuoteRequest, normalizeTierResolution, priceTierSummaryLabel, priceTiersForCurrentSelection, referenceVideoBillingLabel, tokenPriceRuleDescription, type ModelPriceTier } from "@/lib/model-pricing";
import { compatibleModelInGroup, configuredModelDisplayName, modelCompatibilityError, resolveCompatibleModel, type DisplayModelGroup, type ModelRequirements } from "@/lib/model-selection";
import { groupModelsForPicker, isDirectSystemModel, modelChannelLabel, type ModelPickerGroup } from "@/lib/model-picker-groups";
import { cn } from "@/lib/utils";
import { modelDisplayName, modelIcon, modelOptionName, resolveModelChannel, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { ModelLogo } from "@/components/model-logo";
import { ModelTags } from "@/components/model-tags";
import { referenceCapabilityTag } from "@/lib/model-tags";
import { quoteModel, type LogicalModelQuote } from "@/services/api/logical-models";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    popoverClassName?: string;
    fullWidth?: boolean;
    placeholder?: string;
    onMissingConfig?: () => void;
    showSelectedPrice?: boolean;
    showOptionPrices?: boolean;
    variant?: "default" | "creation";
    layout?: "agent-compact";
    groupWorkbenchImages?: boolean;
    requirements?: ModelRequirements;
    showConfiguredModelName?: boolean;
    modelFilter?: (model: string) => boolean;
    /** 调用方额外的不可选原因（例如短剧只能用平台模型）；返回非空串时选项置灰并显示原因。 */
    modelDisabledReason?: (model: string) => string;
};

export function ModelPicker({
    config,
    value,
    onChange,
    capability,
    className,
    popoverClassName,
    fullWidth = false,
    placeholder = "选择模型",
    onMissingConfig,
    showSelectedPrice = true,
    showOptionPrices = showSelectedPrice,
    variant = "creation",
    layout,
    groupWorkbenchImages = false,
    requirements,
    showConfiguredModelName = false,
    modelFilter,
    modelDisabledReason,
}: ModelPickerProps) {
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const pickerId = useId();
    // 双保险：即使 store merge 写出非法 theme，这里也兜底到 dark，避免 "reading 'node'" 崩溃
    const rawTheme = useActiveTheme();
    const theme = (canvasThemes[rawTheme as keyof typeof canvasThemes] ?? canvasThemes.dark) as CanvasTheme;
    const [open, setOpen] = useState(false);
    const popoverRef = usePopoverAnchorAlign(open);
    const [availableHeight, setAvailableHeight] = useState(0);
    const [availableWidth, setAvailableWidth] = useState(0);
    const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    // 画布编辑器里的弹窗要和节点面板同色；其余入口跟随工作台浮层表面。
    const [inSpatialWorkspace, setInSpatialWorkspace] = useState(false);
    useLayoutEffect(() => {
        setInSpatialWorkspace(Boolean(triggerRef.current?.closest(".app-spatial-workspace")));
    }, []);
    const options = useMemo(() => Array.from(new Set(selectableModelsByCapability(config, capability).filter((model) => Boolean(model) && (!modelFilter || modelFilter(model))))), [capability, config, modelFilter]);
    const workbenchImage = groupWorkbenchImages && capability === "image";
    const optionGroups = useMemo(() => groupModelsForPicker(config, options, workbenchImage ? "workbench-image" : undefined), [config, options, workbenchImage]);
    const storedCurrent = value?.trim() || "";
    // 参数档位会在选中模型后由调用方归一到其能力配置，不能因为旧模型留下的参数而禁止切换。
    const selectionRequirements = requirements ? { ...requirements, videoSeconds: undefined, imageSize: undefined, options: undefined } : undefined;
    const resolvedCurrent = isDirectSystemModel(config, storedCurrent) ? storedCurrent : resolveCompatibleModel(config, storedCurrent, selectionRequirements) || storedCurrent;
    // 旧画布可能保存过已下架或前端历史内置模型；它们不能重新进入当前可选目录。
    const current = options.includes(resolvedCurrent) ? resolvedCurrent : "";
    const currentPrice = modelMenuPrice(config, current, capability, false, requirements);
    const quoteRequest = useMemo(() => modelQuoteRequest(config, current, capability, requirements), [capability, config, current, requirements]);
    const [routeQuote, setRouteQuote] = useState<LogicalModelQuote | undefined>();
    const creationVariant = variant === "creation";
    const compact = layout === "agent-compact";
    const currentChannel = current ? resolveModelChannel(config, current) : undefined;
    const isCurrentCustomChannel = Boolean(current && currentChannel && currentChannel.scope !== "system");
    const currentProductName = workbenchImage && current ? optionGroups.find((group) => group.kind === "product" && group.models.some((item) => item.key === current))?.label : undefined;
    const currentOptionLabel = currentProductName ?? (current ? pickerModelOptionLabel(config, current, showConfiguredModelName) : placeholder);
    const triggerLabel = currentProductName ?? (current && (compact || creationVariant) ? pickerModelDisplayName(config, current, showConfiguredModelName, !compact) : currentOptionLabel);

    const updateAvailableSpace = useCallback(() => {
        const trigger = triggerRef.current;
        if (!trigger) return;
        const { top, bottom, left } = trigger.getBoundingClientRect();
        const bounds = compact ? trigger.closest(".canvas-agent-panel")?.getBoundingClientRect() : undefined;
        setAvailableHeight(compact ? Math.max(0, top - Math.max(0, bounds?.top ?? 0)) : Math.max(top, window.innerHeight - bottom));
        if (compact) setAvailableWidth(Math.max(0, Math.min(bounds?.right ?? window.innerWidth, window.innerWidth) - left - 12));
    }, [compact]);
    useLayoutEffect(() => {
        if (!open) return;
        const trigger = triggerRef.current;
        const panel = compact ? trigger?.closest(".canvas-agent-panel") : null;
        updateAvailableSpace();
        const observer = panel && typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateAvailableSpace) : undefined;
        if (panel) observer?.observe(panel);
        if (trigger && compact) observer?.observe(trigger);
        window.addEventListener("resize", updateAvailableSpace);
        window.addEventListener("scroll", updateAvailableSpace, true);
        return () => {
            observer?.disconnect();
            window.removeEventListener("resize", updateAvailableSpace);
            window.removeEventListener("scroll", updateAvailableSpace, true);
        };
    }, [compact, open, updateAvailableSpace]);

    useEffect(() => {
        if (!showSelectedPrice || !creditsEnabled || !quoteRequest) {
            setRouteQuote(undefined);
            return;
        }
        const controller = new AbortController();
        setRouteQuote(undefined);
        quoteModel(quoteRequest, controller.signal)
            .then((payload) => setRouteQuote(payload.quote))
            .catch(() => {
                if (!controller.signal.aborted) setRouteQuote(undefined);
            });
        return () => controller.abort();
    }, [creditsEnabled, quoteRequest, showSelectedPrice]);

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    useEffect(() => {
        if (!open) return;
        // 画布拖拽从 pointerdown 开始，须在捕获阶段关闭 Portal 菜单，避免菜单与触发器分离。
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
            if (target instanceof Element && target.closest("[data-model-tariff-owner]")?.getAttribute("data-model-tariff-owner") === pickerId) return;
            setOpen(false);
        };
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        return () => window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
    }, [open, pickerId]);

    const setPickerOpen = (nextOpen: boolean) => {
        if (nextOpen && !options.length) onMissingConfig?.();
        if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
        if (nextOpen) {
            if (compact) updateAvailableSpace();
            const selectedGroup = compact ? undefined : optionGroups.find((group) => group.models.some((item) => item.models.includes(current)));
            setActiveGroupKey(selectedGroup?.key ?? null);
        }
        setOpen(nextOpen);
    };
    const focusMenuOption = (last = false) => {
        window.requestAnimationFrame(() => {
            const buttons = menuRef.current?.querySelectorAll<HTMLButtonElement>("[data-model-picker-item]:not(:disabled)");
            const target = last ? buttons?.item((buttons?.length || 1) - 1) : buttons?.item(0);
            if (target) focusPickerOption(target);
            else if (compact) menuRef.current?.focus({ preventScroll: true });
        });
    };
    const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (compact && open && event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        setPickerOpen(true);
        focusMenuOption(event.key === "ArrowUp");
    };
    const closePickerAndRestoreFocus = () => {
        setOpen(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
    };
    const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") {
            event.preventDefault();
            if (compact) {
                event.stopPropagation();
                closePickerAndRestoreFocus();
            } else {
                setOpen(false);
                triggerRef.current?.focus({ preventScroll: true });
            }
            return;
        }
        if (!compact && event.key === "ArrowLeft" && activeGroupKey !== null) {
            event.preventDefault();
            setActiveGroupKey(null);
            focusMenuOption();
            return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-model-picker-item]:not(:disabled)"));
        if (!buttons.length) return;
        event.preventDefault();
        const activeIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : event.key === "ArrowUp" ? Math.max(0, activeIndex - 1) : Math.min(buttons.length - 1, activeIndex + 1);
        focusPickerOption(buttons[nextIndex]);
    };
    const renderModelOption = (group: ModelPickerGroup, modelGroup: DisplayModelGroup, modelName?: string) => {
        const selected = modelGroup.models.includes(current);
        const usable = modelDisabledReason ? modelGroup.models.filter((item) => !modelDisabledReason(item)) : modelGroup.models;
        const model = usable.length ? compatibleModelInGroup(config, usable, selectionRequirements, selected ? current : undefined) : undefined;
        const displayModel = model || (selected ? current : modelGroup.models[0]);
        const disabledReason = model ? "" : usable.length ? modelCompatibilityError(config, usable[0], selectionRequirements) || "当前输入不符合该模型能力" : modelDisabledReason?.(modelGroup.models[0]) || "该模型不可用";
        return (
            <ModelPickerOption
                key={modelGroup.key}
                config={config}
                model={displayModel}
                capability={capability}
                showConfiguredModelName={showConfiguredModelName}
                label={modelName ?? (group.kind === "product" ? modelGroup.label : undefined)}
                inlineChannel={compact && modelName ? modelChannelLabel(config, displayModel) : undefined}
                showPrice={showOptionPrices && creditsEnabled}
                disabledReason={disabledReason}
                selected={selected}
                owner={pickerId}
                popoverClassName={popoverClassName}
                onSelect={() => {
                    if (!model) return;
                    onChange(model);
                    if (compact) closePickerAndRestoreFocus();
                }}
            />
        );
    };
    const content = (
        <div
            ref={menuRef}
            data-canvas-no-zoom
            className={cn("canvas-model-picker-menu creation-model-picker-menu max-w-[calc(100vw-24px)]", compact ? "is-agent-compact" : activeGroupKey === null ? "is-brand-list" : "is-model-list")}
            style={{ "--canvas-model-picker-available-height": `${availableHeight}px`, ...(compact ? { width: availableWidth } : {}) } as CSSProperties}
            id={pickerId}
            role="dialog"
            tabIndex={compact ? -1 : undefined}
            aria-label={placeholder}
            onKeyDown={handleMenuKeyDown}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {optionGroups.length ? (
                compact ? (
                    optionGroups.map((group, index) => {
                        if (!(group.kind === "product" && group.models.length > 1)) {
                            return group.models.map((modelGroup) => renderModelOption(group, modelGroup, group.kind === "product" ? group.label : modelGroup.label));
                        }
                        const selected = group.models.some((item) => item.models.includes(current));
                        const expanded = activeGroupKey === group.key;
                        const channelsId = `${pickerId}-channels-${index}`;
                        return (
                            <div key={group.key}>
                                <button
                                    type="button"
                                    data-model-picker-item
                                    className="canvas-model-picker-brand canvas-model-picker-compact-group"
                                    aria-expanded={expanded}
                                    aria-controls={channelsId}
                                    data-selected={selected || undefined}
                                    onClick={() => setActiveGroupKey(expanded ? null : group.key)}
                                >
                                    <span className="canvas-model-picker-brand-icon">
                                        <ModelLogo icon={group.icon} size={18} />
                                    </span>
                                    <span className="canvas-model-picker-brand-copy">
                                        <strong title={group.label}>{group.label}</strong>
                                    </span>
                                    {selected ? <Check className="canvas-model-picker-option-check" aria-hidden="true" /> : null}
                                    <ChevronDown className="canvas-model-picker-chevron" aria-hidden="true" />
                                </button>
                                <div id={channelsId} className="canvas-model-picker-compact-channels" hidden={!expanded}>
                                    {expanded ? group.models.map((modelGroup) => renderModelOption(group, modelGroup)) : null}
                                </div>
                            </div>
                        );
                    })
                ) : activeGroupKey === null ? (
                    <div className="canvas-model-picker-brands" aria-label="选择产品模型">
                        {optionGroups.map((group) => {
                            const groupCurrent = group.models.find((item) => item.models.includes(current));
                            return (
                                <button
                                    key={group.key}
                                    type="button"
                                    data-model-picker-item
                                    className={cn("canvas-model-picker-brand", groupCurrent && "is-active")}
                                    aria-pressed={Boolean(groupCurrent)}
                                    onClick={() => {
                                        setActiveGroupKey(group.key);
                                        focusMenuOption();
                                    }}
                                >
                                    <span className="canvas-model-picker-brand-icon">
                                        <ModelLogo icon={group.icon} size={22} />
                                    </span>
                                    <span className="canvas-model-picker-brand-copy">
                                        <span className="flex items-center gap-2 min-w-0">
                                            <strong className="truncate">{group.label}</strong>
                                            {group.scope === "我的模型" ? (
                                                <span className="shrink-0 rounded px-2 py-0.5 text-[var(--fs-label)] font-medium leading-none bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/25">个人渠道</span>
                                            ) : null}
                                        </span>
                                    </span>
                                    <ChevronDown className="canvas-model-picker-brand-arrow" aria-hidden="true" />
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <div className="canvas-model-picker-two-pane">
                        <div className="canvas-model-picker-brand-rail" aria-label="产品模型">
                            {optionGroups.map((group) => {
                                return (
                                    <button key={group.key} type="button" className={cn("canvas-model-picker-brand", activeGroupKey === group.key && "is-active")} aria-pressed={activeGroupKey === group.key} onClick={() => setActiveGroupKey(group.key)}>
                                        <span className="canvas-model-picker-brand-icon">
                                            <ModelLogo icon={group.icon} size={22} />
                                        </span>
                                        <span className="canvas-model-picker-brand-copy">
                                            <span className="flex items-center gap-2 min-w-0">
                                                <strong className="truncate">{group.label}</strong>
                                                {group.scope === "我的模型" ? (
                                                    <span className="shrink-0 rounded px-2 py-0.5 text-[var(--fs-label)] font-medium leading-none bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/25">个人渠道</span>
                                                ) : null}
                                            </span>
                                        </span>
                                        <ChevronDown className="canvas-model-picker-brand-arrow" aria-hidden="true" />
                                    </button>
                                );
                            })}
                        </div>
                        {optionGroups
                            .filter((group) => group.key === activeGroupKey)
                            .map((group) => (
                                <section key={group.key} className="canvas-model-picker-group canvas-model-picker-model-pane min-w-0">
                                    <div className="grid min-w-0 gap-1">{group.models.map((modelGroup) => renderModelOption(group, modelGroup))}</div>
                                </section>
                            ))}
                    </div>
                )
            ) : (
                <div className="canvas-model-picker-empty" style={{ color: theme.node.muted }}>
                    {emptyModelLabel(config, capability)}
                </div>
            )}
        </div>
    );

    return (
        <div className={cn(fullWidth ? "w-full min-w-0" : "w-fit max-w-full")} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <Popover
                ref={popoverRef}
                open={open}
                onOpenChange={(nextOpen) => {
                    setPickerOpen(nextOpen);
                    if (compact && nextOpen) focusMenuOption();
                }}
                trigger="click"
                placement={compact ? "topLeft" : "bottomLeft"}
                align={{ overflow: { adjustY: !compact, shiftX: !compact } }}
                arrow={false}
                motion={{ motionName: "" }}
                content={content}
                classNames={{
                    root: cn("canvas-model-picker-popover", "creation-model-picker-popover", popoverClassName),
                    container: cn("canvas-composer-popover-surface", "creation-model-picker-surface"),
                    content: "canvas-composer-popover-content",
                }}
                // 弹窗与发起它的输入框同一表面：画布入口取节点面板色，工作台入口回退到 --user-surface-raised（model-picker.css）。
                styles={{
                    container: (!inSpatialWorkspace
                        ? {}
                        : {
                              "--model-picker-surface": theme.node.panel,
                              "--model-picker-ink": theme.node.text,
                              "--model-picker-edge": theme.toolbar.border,
                          }) as CSSProperties,
                }}
            >
                <button
                    ref={triggerRef}
                    type="button"
                    className={cn("canvas-composer-model-picker", fullWidth ? "w-full" : "min-w-36 max-w-full", className)}
                    aria-haspopup="dialog"
                    aria-controls={open ? pickerId : undefined}
                    aria-expanded={open}
                    aria-label={placeholder}
                    title={compact ? triggerLabel : currentOptionLabel}
                    onKeyDown={handleTriggerKeyDown}
                >
                    <span className="canvas-model-picker-label flex min-w-0 items-center gap-2">
                        <span className="canvas-model-picker-trigger-icon">
                            <ModelIcon config={config} model={current} />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{triggerLabel}</span>
                        {!compact && isCurrentCustomChannel ? <span className="shrink-0 rounded px-2 py-0.5 text-[var(--fs-label)] font-medium leading-none bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/25">个人</span> : null}
                        {showSelectedPrice && creditsEnabled ? <ModelPrice price={currentPrice} quote={routeQuote} /> : null}
                    </span>
                    <ChevronDown className={cn("canvas-model-picker-chevron", open && "is-open")} aria-hidden="true" />
                </button>
            </Popover>
        </div>
    );
}

function focusPickerOption(target: HTMLButtonElement | null | undefined) {
    if (!target) return;
    target.focus({ preventScroll: true });
    // Only reveal the focused row inside its pane; scrolling portal ancestors moves the page.
    const pane = target.closest<HTMLElement>(".canvas-model-picker-model-pane, .canvas-model-picker-menu");
    if (!pane) return;
    const row = target.getBoundingClientRect();
    const top = pane.getBoundingClientRect().top + pane.clientTop;
    const bottom = top + pane.clientHeight;
    const delta = row.top < top ? row.top - top : row.bottom > bottom ? row.bottom - bottom : 0;
    if (delta) pane.scrollTop += delta;
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability === "image" ? "生图" : capability === "video" ? "视频" : capability === "text" ? "文本" : capability === "audio" ? "音频" : "";
    if (capability && config.models.length) return `暂无支持当前输入的${label}模型`;
    return config.models.length ? `暂无匹配的${label}模型` : "当前没有可用模型，请联系管理员或检查模型配置";
}

export function ModelPickerOption({
    config,
    model,
    capability,
    showConfiguredModelName = false,
    label,
    inlineChannel,
    showPrice,
    disabledReason,
    selected = false,
    owner,
    popoverClassName,
    onSelect,
}: {
    config: AiConfig;
    model: string;
    capability?: ModelCapability;
    showConfiguredModelName?: boolean;
    label?: string;
    inlineChannel?: string;
    showPrice?: boolean;
    disabledReason?: string;
    selected?: boolean;
    owner: string;
    popoverClassName?: string;
    onSelect: () => void;
}) {
    const channel = resolveModelChannel(config, model);
    const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(model));
    const profiles = modelCapabilityConfigFor(config, model);
    const videoReferences = capability === "video" ? profiles.video?.references : undefined;
    const references = videoReferences ?? (capability === "text" ? profiles.text?.references : capability === "image" ? profiles.image?.references : undefined);
    const capabilityTag = referenceCapabilityTag(references);
    const tags = capabilityTag ? [capabilityTag, ...(cost?.tags || [])] : cost?.tags;
    const name = label || pickerModelDisplayName(config, model, showConfiguredModelName);
    const reason = disabledReason || (cost?.available === false ? "当前不可用" : "");
    // 菜单展示候选渠道的价目；当前规格的精确报价仍只由触发器显示。
    const price = showPrice ? modelMenuPrice(config, model, capability, true) : undefined;
    const referenceLabel = showPrice && channel.scope === "system" && (videoReferences?.maxVideos ?? 0) > 0 ? referenceVideoBillingLabel(cost) : "";
    const tariffLabel = price === null ? "价格未配置" : price?.kind === "fixed" ? `${formatCreditPoints(price.value)} 积分/${price.unit}` : price ? price.label || "按量预估" : undefined;

    return (
        <div className="canvas-model-picker-option-row" data-selected={selected || undefined}>
            <button type="button" data-model-picker-item aria-pressed={selected} disabled={Boolean(disabledReason)} className="canvas-model-picker-option disabled:cursor-not-allowed disabled:opacity-45" onClick={onSelect}>
                <span className="canvas-model-picker-option-heading">
                    <span className="canvas-model-picker-option-identity">
                        <span className="canvas-model-picker-option-name" title={name}>
                            {name}
                        </span>
                        {inlineChannel && inlineChannel !== name ? <span className="canvas-model-picker-compact-channel">{inlineChannel}</span> : null}
                        {channel.scope !== "system" ? <span className="canvas-model-picker-personal">个人</span> : null}
                    </span>
                    {tariffLabel || referenceLabel ? (
                        <span className="canvas-model-picker-option-price">
                            <ModelTariffLabel label={tariffLabel} title={price && price.kind !== "fixed" ? price.title : undefined} />
                            {referenceLabel ? <span className="canvas-model-picker-reference-billing">{referenceLabel}</span> : null}
                        </span>
                    ) : null}
                </span>
                {reason ? <span className="canvas-model-picker-description">{reason}</span> : null}
                {selected || tags?.length ? (
                    <span className="canvas-model-picker-option-meta">
                        <ModelTags tags={tags} />
                        {selected ? (
                            <span className="canvas-model-picker-selected-badge" aria-hidden="true">
                                <Check />
                                已选
                            </span>
                        ) : null}
                    </span>
                ) : null}
            </button>
            {price ? <ModelTariffHelp label={name} price={price} tiers={price.kind === "tiers" ? cost?.logicalPriceTiers : undefined} capability={capability} owner={owner} popoverClassName={popoverClassName} /> : null}
        </div>
    );
}

type ModelMenuPrice = { kind: "tiers"; label: string; title: string } | { kind: "estimate"; label?: string; title?: string } | { kind: "fixed"; value: number; unit: "次" | "秒" };

function ModelTariffLabel({ label, title }: { label?: string; title?: string }) {
    if (!label) return null;
    return (
        <span className="model-picker-tariff" title={title}>
            {label.split(" · ").map((part, index) => {
                const price = /^(输出 )?([\d,.]+(?:-[\d,.]+)?) (积分.*|\/M Token)$/.exec(part);
                return price ? (
                    <span key={index}>
                        {price[1]}
                        <strong>{price[2]}</strong> {price[3]}
                    </span>
                ) : (
                    <span key={index}>{part}</span>
                );
            })}
        </span>
    );
}

function ModelTariffHelp({ label, price, tiers, capability, owner, popoverClassName }: { label: string; price: ModelMenuPrice; tiers?: ModelPriceTier[]; capability?: ModelCapability; owner: string; popoverClassName?: string }) {
    const [open, setOpen] = useState(false);
    const imageTable = capability === "image" && tiers?.length ? buildImagePriceTable(tiers) : undefined;
    const otherTiers = imageTable?.remaining ?? tiers;
    const detailsId = useId();
    const helpRef = useRef<HTMLButtonElement>(null);
    const focusDetails = useCallback((element: HTMLDivElement | null) => element?.focus({ preventScroll: true }), []);
    const closeOnEscape = (event: KeyboardEvent) => {
        if (!open || event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        helpRef.current?.focus({ preventScroll: true });
    };
    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            trigger="click"
            placement="topRight"
            destroyOnHidden
            classNames={{ root: popoverClassName }}
            content={
                <div id={detailsId} ref={focusDetails} data-model-tariff-owner={owner} className="model-picker-tariff-details" tabIndex={-1} role="region" aria-label="模型积分价目" onKeyDown={closeOnEscape}>
                    {imageTable?.rows.length ? (
                        <table className="model-picker-image-price-matrix" aria-label="画质与分辨率积分单价">
                            <thead>
                                <tr>
                                    <th scope="col">画质</th>
                                    {imageTable.resolutions.map((resolution) => (
                                        <th key={resolution} scope="col">
                                            {resolution}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {imageTable.rows.map((row) => (
                                    <tr key={row.key}>
                                        <th scope="row">{row.label}</th>
                                        {row.prices.map((amount, index) => (
                                            <td key={imageTable.resolutions[index]}>{amount}</td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : null}
                    {otherTiers?.length ? (
                        <table aria-label="积分价目">
                            <thead>
                                <tr>
                                    <th scope="col">规格</th>
                                    <th scope="col">价格</th>
                                </tr>
                            </thead>
                            <tbody>
                                {otherTiers.map((tier, index) => (
                                    <tr key={index}>
                                        <th scope="row">{tierSpecificationLabel(tier)}</th>
                                        <td>{priceTierSummaryLabel([tier], capability)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : !imageTable?.rows.length ? (
                        <p>{price.kind === "fixed" ? `${formatCreditPoints(price.value)} 积分/${price.unit}` : price.title || price.label || "按实际用量结算"}</p>
                    ) : null}
                </div>
            }
        >
            <button ref={helpRef} type="button" className="model-picker-tariff-help" aria-label={`查看${label}的积分价目`} aria-expanded={open} aria-controls={open ? detailsId : undefined} onKeyDown={closeOnEscape}>
                <CircleHelp aria-hidden="true" />
            </button>
        </Popover>
    );
}

function modelMenuPrice(config: AiConfig, model: string, capability?: ModelCapability, summary = false, requirements?: ModelRequirements): ModelMenuPrice | null | undefined {
    if (!model) return undefined;
    const channel = resolveModelChannel(config, model);
    const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(model));
    if (!cost) return channel.scope === "system" ? null : undefined;
    if (cost.pricePolicy === "channel") {
        const tiers = cost.logicalPriceTiers || [];
        if (!tiers.length) return null;
        const matched = summary ? tiers : priceTiersForCurrentSelection(tiers, capability, config, requirements);
        if (!summary && !matched.length) return { kind: "tiers", label: "当前规格无报价", title: "请调整参数，或选择支持当前规格的渠道" };
        return channelTierPriceSummary(matched.length ? matched : tiers, tiers, capability);
    }
    if (cost.billingMode === "token") {
        const rate = cost.outputTokenPriceMicrocredits;
        return capability === "video" && typeof rate === "number" && Number.isFinite(rate) && rate >= 0
            ? { kind: "estimate", label: formatPriceRange([rate / 1_000_000], "/M Token"), title: `${formatPriceRange([rate / 1_000_000], "积分/百万视频 Token")}；按视频 Token 单价预估，优先按有效上游用量结算；未返回用量时按视频公式结算` }
            : { kind: "estimate" };
    }
    return { kind: "fixed", value: cost.unitPriceMicrocredits / 1_000_000, unit: cost.billingMode === "per_second" ? "秒" : "次" };
}

function pickerModelDisplayName(config: AiConfig, model: string, showConfiguredModelName: boolean, includeChannel = true) {
    const name = showConfiguredModelName ? configuredModelDisplayName(config, model) : modelDisplayName(config, model);
    return includeChannel && isDirectSystemModel(config, model) ? `${name} · ${modelChannelLabel(config, model)}` : name;
}

function pickerModelOptionLabel(config: AiConfig, model: string, showConfiguredModelName: boolean) {
    const displayName = showConfiguredModelName ? configuredModelDisplayName(config, model) : modelDisplayName(config, model);
    const channel = resolveModelChannel(config, model);
    return channel.scope === "system" ? pickerModelDisplayName(config, model, showConfiguredModelName) : `${displayName}（${channel.name}）`;
}

function channelTierPriceSummary(
    visibleTiers: NonNullable<NonNullable<AiConfig["channels"][number]["modelCosts"]>[number]["logicalPriceTiers"]>,
    allTiers: NonNullable<NonNullable<AiConfig["channels"][number]["modelCosts"]>[number]["logicalPriceTiers"]>,
    capability?: ModelCapability,
): Extract<ModelMenuPrice, { kind: "tiers" }> {
    const label = priceTierSummaryLabel(visibleTiers, capability, true);
    const ruleNotes = allTiers.flatMap((tier) => tier.tokenPriceRules || []).map(tokenPriceRuleDescription);
    return {
        kind: "tiers",
        label,
        title: `系统规格价格：${allTiers.map((tier) => `${tierSpecificationLabel(tier)} ${priceTierSummaryLabel([tier], capability)}`).join("；")}${allTiers.some((tier) => tier.billingMode === "token") ? (capability === "video" ? "；优先按有效上游用量结算，未返回用量时按视频公式结算" : "；Token 费用为预估，最终按成功任务的实际用量结算") : ""}${ruleNotes.length ? `。分时与上下文价格（上海时间，任务创建时锁定时段，按实际输入 Token 选档，未命中按上述基础价）：${ruleNotes.join("；")}` : ""}`,
    };
}

function tierResolutionLabel(value: string) {
    const normalized = normalizeTierResolution(value);
    return normalized === "*" ? "全部分辨率" : normalized.toUpperCase();
}

function tierDurationLabel(seconds: number) {
    return seconds > 0 ? `${seconds} 秒` : "全部时长";
}

function tierSpecificationLabel(tier: NonNullable<NonNullable<AiConfig["channels"][number]["modelCosts"]>[number]["logicalPriceTiers"]>[number]) {
    const selector = tier.selector || {};
    const operationLabels: Record<string, string> = { text_to_image: "文生图", image_to_image: "图生图", text_to_video: "文生视频", image_to_video: "图生视频", video_to_video: "视频生视频" };
    const operation = selector.operation && selector.operation !== "*" ? operationLabels[selector.operation] || selector.operation : "";
    const details = [
        operation,
        selector.quality && selector.quality !== "*" ? `画质 ${imageQualityLabel(selector.quality)}` : "",
        selector.thinkingLevel && selector.thinkingLevel !== "*" ? `思考程度 ${imageQualityLabel(selector.thinkingLevel)}` : "",
        ...[
            ...new Set(
                [
                    selector.imageResolution?.toUpperCase(),
                    selector.resolution?.toUpperCase(),
                    selector.vquality && selector.vquality !== "*" ? tierResolutionLabel(selector.vquality) : "",
                    tier.resolution && tier.resolution !== "*" && !selector.resolution && !selector.vquality && !selector.imageResolution ? tierResolutionLabel(tier.resolution) : "",
                ].filter((value) => value && value !== "*"),
            ),
        ].map((value) => `分辨率 ${value}`),
        selector.size && selector.size !== "*" ? selector.size : "",
        selector.videoSeconds && selector.videoSeconds !== "*" ? `${selector.videoSeconds} 秒` : tier.videoSeconds ? tierDurationLabel(tier.videoSeconds) : "",
        selector.imageCount && selector.imageCount !== "*" ? `${selector.imageCount} 张参考图` : "",
        selector.videoGenerateAudio === "true" ? "有声" : selector.videoGenerateAudio === "false" ? "无声" : "",
        ...Object.entries(selector)
            .filter(([key, value]) => value && value !== "*" && !["operation", "quality", "thinkingLevel", "imageResolution", "resolution", "vquality", "size", "videoSeconds", "imageCount", "videoGenerateAudio"].includes(key))
            .map(([key, value]) => `${key}: ${value}`),
    ].filter(Boolean);
    return details.length ? details.join(" / ") : "默认规格";
}

function ModelPrice({ price, quote }: { price: ModelMenuPrice | null | undefined; quote?: LogicalModelQuote }) {
    if (quote) {
        const amount = formatCreditDisplay(quote.amountMicrocredits);
        return (
            <span className="model-picker-tariff" aria-label={modelQuoteDescription(quote)}>
                {quote.estimated ? "预估 " : null}
                <strong>{amount}</strong>
            </span>
        );
    }
    const label = price?.kind === "fixed" ? `${formatCreditPoints(price.value)} 积分/${price.unit}` : price ? price.label || "按量预估" : undefined;
    return <ModelTariffLabel label={label} />;
}

export function ModelIcon({ config, model, icon }: { config?: AiConfig; model?: string; icon?: string }) {
    return <ModelLogo icon={icon || (config && model ? modelIcon(config, model) : "")} size={14} />;
}
