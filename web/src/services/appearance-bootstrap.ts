import { getPublicAppearance, type PublicAppearance } from "@/services/api/appearance";
import { commitPublicAppearance, DEFAULT_PUBLIC_APPEARANCE, useAppearanceStore } from "@/stores/use-appearance-store";
import { JOYSEE_MINIMAL_SKIN, JOYSEE_MINIMAL_SKIN_ID } from "@/themes/joysee-minimal/skin";

const APPEARANCE_BOOTSTRAP_TIMEOUT_MS = 4_000;
let refreshing: Promise<PublicAppearance | undefined> | undefined;

/**
 * 本机 LJCanvas 开发入口可通过环境变量固定使用乐见皮肤。
 * 只影响 Vite 开发进程，不改写服务器保存的外观配置。
 */
function applyLocalAppearanceOverride(appearance: PublicAppearance) {
    if (!import.meta.env.DEV || import.meta.env.VITE_CANVAS_LOCAL_APPEARANCE !== "joysee-minimal") return appearance;
    const brandName = "乐见画布";
    return {
        ...appearance,
        brandName,
        brandSlug: "joysee-canvas",
        skinId: JOYSEE_MINIMAL_SKIN_ID,
        activeSkin: JOYSEE_MINIMAL_SKIN,
        seoTitle: brandName,
        seoDescription: `${brandName}，AI 影视与短剧创作工作台。`,
        footerCopyright: `© ${new Date().getFullYear()} ${brandName}. All rights reserved.`,
    };
}

// A failed refresh must keep the last saved identity rather than restore defaults.
export function refreshPublicAppearance(fetchAppearance: (signal: AbortSignal) => Promise<PublicAppearance> = getPublicAppearance) {
    if (refreshing) return refreshing;
    refreshing = (async () => {
        const previous = useAppearanceStore.getState().appearance;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), APPEARANCE_BOOTSTRAP_TIMEOUT_MS);
        try {
            const appearance = await fetchAppearance(controller.signal);
            if (useAppearanceStore.getState().appearance !== previous) return undefined;
            return commitPublicAppearance(applyLocalAppearanceOverride(appearance));
        } catch {
            return undefined;
        } finally {
            clearTimeout(timer);
        }
    })().finally(() => {
        refreshing = undefined;
    });
    return refreshing;
}

export async function resolvePublicAppearance(fetchAppearance: (signal: AbortSignal) => Promise<PublicAppearance> = getPublicAppearance) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), APPEARANCE_BOOTSTRAP_TIMEOUT_MS);
    try {
        return applyLocalAppearanceOverride(await fetchAppearance(controller.signal));
    } catch {
        return applyLocalAppearanceOverride(DEFAULT_PUBLIC_APPEARANCE);
    } finally {
        clearTimeout(timer);
    }
}

export async function bootstrapAppearance(fetchAppearance?: (signal: AbortSignal) => Promise<PublicAppearance>) {
    return commitPublicAppearance(await resolvePublicAppearance(fetchAppearance));
}
