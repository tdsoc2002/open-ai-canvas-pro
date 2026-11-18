import { formatCreditDisplay } from "@/lib/credit-format";
import { imageQualityLabel } from "@/lib/image-quality";
import type { ModelPriceTier } from "@/lib/model-pricing";

const qualityOrder = ["low", "medium", "high", "xhigh", "max", "auto"];
const resolutionPattern = /^\d+(?:\.\d+)?k$/;

export function buildImagePriceTable(tiers: readonly ModelPriceTier[]) {
    const resolutions = new Set<string>();
    const pricesByQuality = new Map<string, Map<string, Set<number>>>();
    const remaining: ModelPriceTier[] = [];

    for (const tier of tiers) {
        // 有比例、参考图等额外条件的价目不能填成该画质与分辨率的通用单价。
        const extraCondition = Object.entries(tier.selector || {}).some(([name, value]) => value && value !== "*" && !["quality", "imageResolution", "resolution"].includes(name));
        const declared = [...new Set([tier.selector?.imageResolution, tier.selector?.resolution, tier.resolution].map((value) => value?.trim().toLowerCase()).filter((value) => value && value !== "*"))];
        const quality = tier.selector?.quality?.trim().toLowerCase() || "*";
        const legacyResolution = !declared.length && resolutionPattern.test(quality);
        const resolution = legacyResolution ? quality : declared[0];
        if (tier.billingMode !== "fixed_request" || tier.videoSeconds || extraCondition || declared.length > 1 || !resolution || !resolutionPattern.test(resolution) || !Number.isSafeInteger(tier.unitPriceMicrocredits) || tier.unitPriceMicrocredits < 0) {
            remaining.push(tier);
            continue;
        }

        const row = legacyResolution ? "*" : quality;
        resolutions.add(resolution);
        const cells = pricesByQuality.get(row) ?? new Map<string, Set<number>>();
        const amounts = cells.get(resolution) ?? new Set<number>();
        amounts.add(tier.unitPriceMicrocredits);
        cells.set(resolution, amounts);
        pricesByQuality.set(row, cells);
    }

    const columns = [...resolutions].sort((left, right) => parseFloat(left) - parseFloat(right));
    const rank = (quality: string) => (quality === "*" ? qualityOrder.length + 1 : qualityOrder.includes(quality) ? qualityOrder.indexOf(quality) : qualityOrder.length);
    const rows = [...pricesByQuality]
        .sort(([left], [right]) => rank(left) - rank(right) || left.localeCompare(right, "zh-CN"))
        .map(([quality, cells]) => ({
            key: quality,
            label: quality === "*" ? "通用" : imageQualityLabel(quality),
            prices: columns.map((resolution) => {
                const amounts = cells.get(resolution);
                if (!amounts?.size) return "—";
                if (amounts.size > 1) return "价格配置冲突";
                return `${formatCreditDisplay([...amounts][0])} 积分`;
            }),
        }));

    return { resolutions: columns.map((resolution) => resolution.toUpperCase()), rows, remaining };
}
