import { parseAssetRecord } from "@/lib/asset-record";
import { appQueryClient } from "@/lib/query-client";
import { getActiveUserScope } from "@/lib/user-scope";
import { http } from "@/services/api/request";
import { flushAssetStorePersistence, useAssetStore } from "@/stores/use-asset-store";
import { commitRemoteAssetChange } from "@/services/user-data-sync";

export async function saveGenerationOutputToLibrary(taskId: string, resourceId: string) {
    const scope = getActiveUserScope();
    const { asset } = await http.get<{ asset: unknown }>(`/tasks/${encodeURIComponent(taskId)}/output-asset`, { params: { resourceId } });
    return saveExistingAssetToLibrary(parseAssetRecord(asset).id, scope, resourceId);
}

/** 由服务端在原记录上设置入库标记；不会用浏览器缓存替换项目资产的当前版本。 */
export async function saveExistingAssetToLibrary(id: string, scope: string, resourceId?: string): Promise<void> {
    const ensureScope = () => {
        if (scope !== getActiveUserScope()) throw new Error("账号已切换，请重新保存");
    };
    ensureScope();
    if (scope === "guest") {
        const store = useAssetStore.getState();
        const asset = store.assets.find((item) => item.id === id);
        if (!asset) throw new Error("素材尚不可用，请重新读取后保存");
        store.updateAsset(id, { ...(asset.status === "archived" ? { status: "confirmed" } : {}), metadata: { ...asset.metadata, librarySaved: true } });
        await flushAssetStorePersistence();
        ensureScope();
        return;
    }
    await commitRemoteAssetChange(async () => {
        ensureScope();
        const { asset: payload } = await http.patch<{ asset: unknown }>(`/assets/${encodeURIComponent(id)}/library`, { ...(resourceId ? { resourceId } : {}) });
        ensureScope();
        const asset = parseAssetRecord(payload);
        if (asset.id !== id || asset.metadata?.librarySaved !== true || asset.status === "archived") throw new Error("服务端未确认素材入库，请刷新后重试");
        return asset;
    });
    for (const key of ["asset-library", "asset-picker", "canvas-workspace-assets", "character-media-library"]) {
        void appQueryClient.invalidateQueries({ queryKey: [key] });
    }
}
