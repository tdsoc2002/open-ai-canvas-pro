import { systemModelQuoteRequest } from "@/lib/model-pricing";
import type { WorkbenchReferenceSlot, WorkbenchTool } from "@/services/api/workbench";
import type { AiConfig } from "@/stores/use-config-store";

export function workbenchVideoOperation(references: ReadonlyArray<{ kind: string; role?: string }>) {
    if (references.some((reference) => reference.kind === "video" || (reference.kind === "image" && reference.role !== "first_frame" && reference.role !== "last_frame"))) return "reference_to_video";
    if (references.some((reference) => reference.kind === "image")) return "image_to_video";
    if (references.some((reference) => reference.kind === "audio")) return "audio_to_video";
    return "text_to_video";
}

export function workbenchPromptRequired(tool: WorkbenchTool | null) {
    return !tool || tool.inputContract?.promptRequired !== false || (tool.inputContract?.minTextReferences || 0) > 0;
}

export function missingWorkbenchInput(tool: WorkbenchTool | null, references: Array<{ slotKey?: string; resourceId?: string; uploading?: boolean; error?: string }>) {
    return tool?.inputContract?.slots.find((slot) => references.filter((reference) => reference.slotKey === slot.key && reference.resourceId && !reference.uploading && !reference.error).length < Math.max(slot.minCount, slot.required ? 1 : 0));
}

export function workbenchImageQuoteRequest(
    config: AiConfig,
    model: string,
    options: { size: string; quality: string; imageResolution?: string; count: number },
    slots: WorkbenchReferenceSlot[],
    references: ReadonlyArray<{ kind: string; slotKey?: string; resourceId?: string; uploading?: boolean; error?: string }>,
) {
    const images = references.filter((reference) => reference.kind === "image" && reference.resourceId && !reference.uploading && !reference.error);
    // 未上传商品原图时，按场景最低素材要求估价，不误用文生图档位。
    const imageCount = slots.reduce((count, slot) => {
        if (slot.mediaTypes.length !== 1 || slot.mediaTypes[0] !== "image") return count;
        return count + Math.max(0, Math.max(slot.minCount, slot.required ? 1 : 0) - images.filter((image) => image.slotKey === slot.key).length);
    }, images.length);
    const request = systemModelQuoteRequest(config, model, "image", { input: { textCount: 0, imageCount, videoCount: 0, audioCount: 0, characterCount: 0 } });
    // 工作台接口只接收这组图片参数；其他页面的扩展参数不能影响此处报价。
    if (request) request.intent.options = options;
    return request;
}
