import { Button, Popover } from "antd";
import { ChevronDown, FolderOpen, FolderPlus, PencilLine } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { DeleteButton } from "@/components/ui/base/buttons/delete-button";
import type { AssetFolder } from "@/services/api/user-data";

export function AssetFolderFilter({
    folders,
    counts,
    value,
    onChange,
    onCreate,
    onRename,
    onDelete,
}: {
    folders: AssetFolder[];
    counts: Record<string, number>;
    value: string;
    onChange: (value: string) => void;
    onCreate: () => void;
    onRename: (folder: AssetFolder) => void;
    onDelete: (folder: AssetFolder) => Promise<void>;
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const id = useId();
    const trigger = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLElement>(null);
    const title = t("library.assets.page.myFolders");
    const uncategorized = t("library.assets.uncategorized");
    const selectedName = value === "uncategorized" ? uncategorized : folders.find((folder) => folder.id === value)?.name;

    function close() {
        setOpen(false);
        trigger.current?.focus();
    }

    function option(key: string, name: string, count: number) {
        return (
            <button
                type="button"
                className={`assets-filter-item asset-folder-option${value === key ? " is-active" : ""}`}
                aria-pressed={value === key}
                onClick={() => {
                    close();
                    onChange(key);
                }}
            >
                <span className="assets-filter-item-label truncate" title={name}>
                    {name}
                </span>
                <span className="assets-filter-count">{count}</span>
            </button>
        );
    }

    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            afterOpenChange={(visible) => {
                if (visible) panel.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
            }}
            trigger="click"
            placement="bottomLeft"
            arrow={false}
            classNames={{ root: "app-product-overlays" }}
            content={
                <section
                    ref={panel}
                    id={id}
                    className="assets-folder-menu"
                    role="dialog"
                    aria-label={title}
                    onKeyDown={(event) => {
                        if (event.key !== "Escape") return;
                        event.stopPropagation();
                        close();
                    }}
                >
                    <div className="collection-folder-heading">
                        <strong className="collection-filter-label">{title}</strong>
                        <button
                            type="button"
                            className="product-icon-button"
                            title={t("library.assets.folder.create")}
                            aria-label={t("library.assets.folder.create")}
                            onClick={() => {
                                close();
                                onCreate();
                            }}
                        >
                            <FolderPlus aria-hidden />
                        </button>
                    </div>
                    <div className="collection-folder-list">
                        {option(
                            "all",
                            t("library.assets.kind.all"),
                            Object.values(counts).reduce((sum, count) => sum + count, 0),
                        )}
                        {option("uncategorized", uncategorized, counts[""] ?? 0)}
                        {folders.map((folder) => (
                            <div key={folder.id} className="assets-folder-row">
                                {option(folder.id, folder.name, counts[folder.id] ?? 0)}
                                <button
                                    type="button"
                                    className="product-icon-button"
                                    title={t("library.assets.folder.renameLabel", { name: folder.name })}
                                    aria-label={t("library.assets.folder.renameLabel", { name: folder.name })}
                                    onClick={() => {
                                        close();
                                        onRename(folder);
                                    }}
                                >
                                    <PencilLine aria-hidden />
                                </button>
                                <DeleteButton label={t("library.assets.folder.deleteLabel", { name: folder.name })} description={t("library.assets.folder.deleteDescription")} onConfirm={() => onDelete(folder)} />
                            </div>
                        ))}
                    </div>
                </section>
            }
        >
            <Button
                ref={trigger}
                className="assets-folder-trigger"
                aria-label={selectedName ? `${title}：${selectedName}` : title}
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-controls={open ? id : undefined}
                icon={<FolderOpen aria-hidden />}
                onKeyDown={(event) => {
                    if (open && event.key === "Escape") close();
                }}
            >
                <span className="assets-folder-trigger-label" title={selectedName}>
                    {selectedName ?? title}
                </span>
                <ChevronDown aria-hidden />
            </Button>
        </Popover>
    );
}
