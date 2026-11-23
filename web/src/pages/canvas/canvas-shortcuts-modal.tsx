import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState, type RefObject } from "react";
import { AppModal } from "@/components/ui/product/app-modal";
import { Search, X } from "lucide-react";
import { Kbd } from "@/components/ui/base/kbd";

import { CANVAS_SHORTCUT_CATEGORIES, filterCanvasShortcuts, type CanvasShortcutItem } from "@/lib/canvas/canvas-shortcuts";
import "./canvas-shortcuts.css";

export const CANVAS_SHORTCUTS_PANEL_ID = "canvas-shortcuts-panel";

export function CanvasShortcuts({ open, onClose, railTriggerRef }: { open: boolean; onClose: () => void; railTriggerRef?: RefObject<HTMLButtonElement | null> }) {
    const { t } = useTranslation();
    const inputRef = useRef<HTMLInputElement>(null);
    const resultsRef = useRef<HTMLDivElement>(null);
    const [query, setQuery] = useState("");

    useEffect(() => {
        if (!open) return;
        setQuery("");
        if (railTriggerRef) inputRef.current?.focus({ preventScroll: true });
    }, [open, railTriggerRef]);

    useEffect(() => {
        if (resultsRef.current) resultsRef.current.scrollTop = 0;
    }, [open, query]);

    const results = filterCanvasShortcuts(query);

    const content = (
        <div className="canvas-shortcuts-shell">
            <header className="canvas-shortcuts-header">
                <h2>{t("canvasPage.shortcuts.title")}</h2>
                <label className="canvas-shortcuts-search">
                    <Search aria-hidden />
                    <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("canvasPage.shortcuts.searchPlaceholder")} aria-label={t("canvasPage.shortcuts.searchLabel")} />
                    {query ? (
                        <button
                            type="button"
                            onClick={() => {
                                setQuery("");
                                inputRef.current?.focus();
                            }}
                            aria-label={t("canvasPage.shortcuts.clearSearch")}
                        >
                            {t("canvasPage.shortcuts.clear")}
                        </button>
                    ) : null}
                </label>
            </header>

            <div className="canvas-shortcuts-results" ref={resultsRef} aria-live="polite" data-canvas-wheel-scroll>
                {results.length > 0 ? (
                    <div className="canvas-shortcuts-grid">
                        {CANVAS_SHORTCUT_CATEGORIES.map(({ id, shortLabel }) => {
                            const shortcuts = results.filter((shortcut) => shortcut.category === id);
                            if (shortcuts.length === 0) return null;

                            return (
                                <section key={id} className="canvas-shortcuts-group">
                                    <h3>{shortLabel}</h3>
                                    <ul className="canvas-shortcuts-list">
                                        {shortcuts.map((shortcut) => (
                                            <ShortcutRow key={shortcut.id} shortcut={shortcut} />
                                        ))}
                                    </ul>
                                </section>
                            );
                        })}
                    </div>
                ) : (
                    <p className="canvas-shortcuts-empty">{t("canvasPage.shortcuts.emptyTitle")}</p>
                )}
            </div>
        </div>
    );

    if (railTriggerRef) {
        if (!open) return null;
        const close = () => {
            onClose();
            railTriggerRef.current?.focus({ preventScroll: true });
        };
        return (
            <section
                id={CANVAS_SHORTCUTS_PANEL_ID}
                className="canvas-shortcuts-panel"
                role="dialog"
                aria-label={t("canvasPage.shortcuts.title")}
                data-canvas-no-zoom
                onWheel={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.stopPropagation();
                    close();
                }}
            >
                <button className="canvas-workspace-close" type="button" aria-label={t("common.close")} onClick={close}>
                    <X className="size-4" />
                </button>
                {content}
            </section>
        );
    }

    return (
        <AppModal
            className="canvas-shortcuts-modal"
            classNames={{ header: "sr-only" }}
            open={open}
            onCancel={onClose}
            footer={null}
            title={t("canvasPage.shortcuts.title")}
            centered
            keyboard
            width="min(72rem, calc(100vw - var(--space-6)))"
            flush
            afterOpenChange={(visible) => {
                if (visible) window.requestAnimationFrame(() => inputRef.current?.focus());
            }}
        >
            {content}
        </AppModal>
    );
}

function ShortcutRow({ shortcut }: { shortcut: CanvasShortcutItem }) {
    const { t } = useTranslation();

    return (
        <li className="canvas-shortcuts-row">
            <span>{shortcut.title}</span>
            <div className="canvas-shortcuts-keys">
                <span className="sr-only">{shortcut.keys.map((combination) => combination.join(t("canvasPage.shortcuts.keyPlus"))).join(t("canvasPage.shortcuts.keyOr"))}</span>
                {(shortcut.compactKeys ?? shortcut.keys).map((combination, combinationIndex) => (
                    <span key={combination.join("-")} className="canvas-shortcuts-combination" aria-hidden="true">
                        {combinationIndex > 0 ? <span>/</span> : null}
                        {combination.map((key, keyIndex) => (
                            <Kbd key={`${key}-${keyIndex}`}>{key}</Kbd>
                        ))}
                    </span>
                ))}
            </div>
        </li>
    );
}
