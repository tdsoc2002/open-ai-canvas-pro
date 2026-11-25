import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { App, Input } from "antd";
import { Folder, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { CanvasAnchoredDropdown } from "@/components/canvas/canvas-anchored-dropdown";
import { Select } from "@/components/ui/base/select";
import { AppModal } from "@/components/ui/product/app-modal";
import { canvasLibraryFolders, type CanvasLibraryFolder } from "@/services/api/user-data";

export type CanvasFolderAction = { kind: "create" } | { kind: "rename"; folder: CanvasLibraryFolder } | { kind: "delete"; folder: CanvasLibraryFolder } | { kind: "move"; ids: string[] };
export const CANVAS_LIBRARY_DRAG_TYPE = "application/x-yingce-canvas-library-id";

export function CanvasLibraryFolderCard({ folder, onOpen, onAction, onCanvasDrop }: { folder: CanvasLibraryFolder; onOpen: () => void; onAction: (action: CanvasFolderAction) => void; onCanvasDrop?: (canvasId: string) => void }) {
    const [dropTarget, setDropTarget] = useState(false);

    return (
        <article
            className="product-collection-card canvas-collection-card"
            data-drop-target={onCanvasDrop && dropTarget ? "true" : undefined}
            onDragOver={(event) => {
                if (!onCanvasDrop || !event.dataTransfer.types.includes(CANVAS_LIBRARY_DRAG_TYPE)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTarget(true);
            }}
            onDragLeave={(event) => {
                if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
                setDropTarget(false);
            }}
            onDrop={(event) => {
                setDropTarget(false);
                if (!onCanvasDrop || !event.dataTransfer.types.includes(CANVAS_LIBRARY_DRAG_TYPE)) return;
                event.preventDefault();
                const canvasId = event.dataTransfer.getData(CANVAS_LIBRARY_DRAG_TYPE);
                if (canvasId) onCanvasDrop(canvasId);
            }}
        >
            <button type="button" className="canvas-collection-open" aria-label={`打开文件夹 ${folder.name}`} onClick={onOpen}>
                <span className="canvas-collection-preview grid place-items-center text-[var(--user-ink-soft)]">
                    <Folder className="size-12" strokeWidth={1.5} aria-hidden="true" />
                </span>
            </button>
            <div className="canvas-collection-body">
                <div className="canvas-collection-heading-row">
                    <button type="button" className="canvas-collection-title" title={folder.name} onClick={onOpen}>
                        {folder.name}
                    </button>
                    <button type="button" className="product-icon-button canvas-collection-rename" aria-label={`重命名文件夹 ${folder.name}`} title="重命名" onClick={() => onAction({ kind: "rename", folder })}>
                        <Pencil />
                    </button>
                    <div className="canvas-collection-actions">
                        <CanvasAnchoredDropdown
                            trigger={["click"]}
                            placement="bottomRight"
                            menu={{ items: [{ key: "delete", danger: true, icon: <Trash2 className="size-3.5" />, label: "删除文件夹", onClick: () => onAction({ kind: "delete", folder }) }] }}
                        >
                            <button type="button" className="product-icon-button canvas-collection-more" aria-label={`文件夹 ${folder.name} 的操作`}>
                                <MoreHorizontal />
                            </button>
                        </CanvasAnchoredDropdown>
                    </div>
                </div>
            </div>
        </article>
    );
}

const folderActionTitles = { create: "新建文件夹", rename: "重命名文件夹", delete: "删除文件夹", move: "移动到文件夹" };

export function CanvasLibraryFolderDialog({ action, folders, onClose, onSaved }: { action: CanvasFolderAction; folders: CanvasLibraryFolder[]; onClose: () => void; onSaved: () => void }) {
    const { message } = App.useApp();
    const [name, setName] = useState(action.kind === "rename" ? action.folder.name : "");
    const [destination, setDestination] = useState<string>();
    const nameLength = Array.from(name.trim()).length;
    const invalid = action.kind === "move" ? destination === undefined : action.kind !== "delete" && (nameLength === 0 || nameLength > 40);
    const title = folderActionTitles[action.kind];
    const mutation = useMutation({
        mutationFn: async () => {
            switch (action.kind) {
                case "create":
                    await canvasLibraryFolders.create(name.trim());
                    return "已新建文件夹";
                case "rename":
                    await canvasLibraryFolders.rename(action.folder.id, name.trim());
                    return "已重命名文件夹";
                case "delete":
                    await canvasLibraryFolders.remove(action.folder.id);
                    return "已删除文件夹，画布已保留";
                case "move":
                    if (destination === undefined) throw new Error("请选择移动位置");
                    await canvasLibraryFolders.move(action.ids, destination);
                    return `已移动 ${action.ids.length} 个画布`;
            }
        },
        onSuccess: (result) => {
            message.success(result);
            onSaved();
        },
    });
    const submit = () => {
        if (!invalid && !mutation.isPending) mutation.mutate();
    };

    return (
        <AppModal
            open
            centered
            title={title}
            okText={action.kind === "delete" ? "删除文件夹" : action.kind === "move" ? "移动" : "保存"}
            cancelText="取消"
            confirmLoading={mutation.isPending}
            okButtonProps={{ disabled: invalid, danger: action.kind === "delete" }}
            onOk={submit}
            onCancel={() => !mutation.isPending && onClose()}
        >
            {action.kind === "delete" ? (
                <p>删除「{action.folder.name}」后，其中的画布会移回画布库首页。</p>
            ) : action.kind === "move" ? (
                <Select<string>
                    className="w-full"
                    ariaLabel="移动位置"
                    placeholder="选择移动位置"
                    value={destination}
                    onChange={setDestination}
                    disabled={mutation.isPending}
                    options={[{ value: "", label: "画布库首页" }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]}
                />
            ) : (
                <Input
                    autoFocus
                    aria-label="文件夹名称"
                    placeholder="文件夹名称（最多 40 个字符）"
                    value={name}
                    disabled={mutation.isPending}
                    onChange={(event) => setName(event.target.value)}
                    onPressEnter={submit}
                    status={nameLength > 40 ? "error" : undefined}
                />
            )}
            {mutation.isError && (
                <p role="alert" className="mt-2 text-sm text-destructive">
                    {mutation.error.message}
                </p>
            )}
        </AppModal>
    );
}
