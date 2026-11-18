import { expect, test } from "bun:test";
import { isAssetInLibrary } from "@/lib/asset-library-membership";

test("显式入库标记优先；旧素材只隐藏可识别的自动登记来源", () => {
    for (const source of ["generation-task", "canvas-generation", "canvas-upload", "short-drama-workflow", "short-drama", "previs", "public-reference-gallery"]) {
        expect(isAssetInLibrary({ metadata: { source } })).toBe(false);
        expect(isAssetInLibrary({ metadata: { source, librarySaved: true } })).toBe(true);
        expect(isAssetInLibrary({ metadata: { source, librarySaved: "true" } })).toBe(false);
    }
    for (const source of ["create-upload", "canvas-manual", "manual", "unknown"]) {
        expect(isAssetInLibrary({ metadata: { source } })).toBe(true);
        expect(isAssetInLibrary({ metadata: { source, librarySaved: false } })).toBe(false);
    }
    expect(isAssetInLibrary({})).toBe(true);
});
