import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/pages/assets/asset-batch-upload-modal.tsx", import.meta.url), "utf8").replace(/\s+/g, " ");

function section(startMarker: string, endMarker: string) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
}

test("批量上传把真实上传进度传给列表，进度条不挤掉文件名", () => {
    const upload = section("const uploadBatch = async", "const close = ");
    expect(upload).toMatch(/uploadImage\(item\.file, \(loaded, total\) =>/);
    expect(upload).toContain("percent }");
    expect(source).not.toMatch(/<Progress[^>]*className="w-20"/);
    const row = section('className="batch-upload-item"', 'className="batch-upload-remove"');
    expect(row).toMatch(/<span className="min-w-0 flex-1">\s*<span className="block truncate" title=\{item\.file\.name\}>/);
    expect(row).toMatch(/item\.status === "uploading" \?\s*\(?\s*<div className="w-20 shrink-0">\s*<Progress percent=\{item\.percent \|\| 10\}/);
});

test("上传成功后不再回读远端地址获取尺寸", () => {
    expect(source).not.toContain("readImageMeta(");
    expect(section("const uploadBatch = async", "const close = ")).toContain("width: uploaded.width, height: uploaded.height");
});

test("同步收尾抛错时仍释放上传状态", () => {
    const upload = section("const uploadBatch = async", "const close = ");
    expect(upload).toMatch(/finally \{ uploadingRef\.current = false; setUploading\(false\); \}/);
    expect(upload).toContain("flushAssetStorePersistence().catch(");
    expect(upload).not.toMatch(/await flushAssetStorePersistence\(\);/);
});

test("部分失败时不自动关闭弹窗，关闭时再刷新列表", () => {
    const upload = section("const uploadBatch = async", "const close = ");
    expect(upload).toMatch(/if \(!failed\) \{ resetBatch\(\); await onComplete\(\); \}/);
    expect(upload.match(/onComplete\(\)/g)).toHaveLength(1);
    expect(upload).toMatch(/addAsset\(\{.*?uploadedScopeRef\.current = scope;/);
    const close = section("const close = ", '<Modal className="library-modal');
    expect(close).toContain("const hasUploaded = uploadedScopeRef.current === getActiveUserScope(); resetBatch();");
    expect(close).toContain("if (hasUploaded) void onComplete(); else onClose();");
    const reset = section("const resetBatch = ", "const uploadBatch = async");
    expect(reset).toContain("uploadedScopeRef.current = null; setItems([]);");
});
