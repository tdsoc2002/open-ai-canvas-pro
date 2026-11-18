import type { Asset } from "@/stores/use-asset-store";

const automaticSources = new Set(["generation-task", "canvas-generation", "canvas-upload", "short-drama-workflow", "short-drama", "previs", "public-reference-gallery"]);

// 旧版 create-upload、canvas-manual 同时用于自动登记和主动保存，不能按来源隐藏。
export function isAssetInLibrary({ metadata }: Pick<Asset, "metadata">): boolean {
    if (typeof metadata?.librarySaved === "boolean") return metadata.librarySaved;
    return typeof metadata?.source !== "string" || !automaticSources.has(metadata.source);
}
