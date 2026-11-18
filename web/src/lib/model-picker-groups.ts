import { groupModelsByDisplayName, isDirectSystemModel, type DisplayModelGroup } from "@/lib/model-selection";
import { modelIcon, modelOptionName, PUBLIC_MODEL_CATALOG_ID, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";

export type ModelPickerGroup = {
    key: string;
    label: string;
    icon: string;
    scope: string;
    kind: "product" | "channel";
    models: DisplayModelGroup[];
};

export { isDirectSystemModel } from "@/lib/model-selection";

const workbenchImageNames = new Map([
    ["gpt-image-2", "GPT Image 2"],
    ["tencent-image-2", "GPT Image 2"],
    ["gpt-image-2.5-flare", "GPT Image 2.5 Flare"],
    ["tencent-image-flare", "GPT Image 2.5 Flare"],
    ["gpt-image-2.5-sunburst", "GPT Image 2.5 Sunburst"],
    ["tencent-image-sunburst", "GPT Image 2.5 Sunburst"],
]);

function workbenchImageProductName(model: string, configuredName?: string) {
    const name = workbenchImageNames.get(model.toLowerCase());
    // 只归并有明确对应关系的渠道别名，不把其他厂商的相似型号放进同一组。
    const oldName = name?.replace("GPT ", "腾讯 ");
    if (configuredName && configuredName !== "未分类" && configuredName !== oldName && configuredName.toLowerCase() !== model.toLowerCase()) return configuredName;
    return name ?? model;
}

export function modelChannelLabel(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(value));
    if (channel.scope === "system") return cost?.channelLabel?.trim() || modelOptionName(value);
    return cost?.channelLabel?.trim() || channel.name || "未命名渠道";
}

// 一级仅决定展示分组；二级保留独立调用 ID 和售价。
export function groupModelsForPicker(config: AiConfig, options: string[], presentation?: "workbench-image"): ModelPickerGroup[] {
    const groups = new Map<string, ModelPickerGroup>();
    for (const channel of config.channels) {
        const models = options.filter((value) => resolveModelChannel(config, value).id === channel.id);
        const directModels = models.filter((value) => isDirectSystemModel(config, value));
        for (const value of directModels) {
            const model = modelOptionName(value);
            const cost = channel.modelCosts?.find((item) => item.model === model);
            const name = cost?.displayName?.trim();
            const label = presentation === "workbench-image" ? workbenchImageProductName(model, name) : name || "未分类";
            const key = JSON.stringify(["product", label]);
            let group = groups.get(key);
            if (!group) {
                group = { key, label, icon: modelIcon(config, value), scope: "平台服务", kind: "product", models: [] };
                groups.set(key, group);
            }
            const channelLabel = modelChannelLabel(config, value);
            const routeLabel = presentation === "workbench-image" && channelLabel.toLowerCase() === model.toLowerCase() ? channel.name.trim() || channelLabel : channelLabel;
            group.models.push({ key: value, label: routeLabel, models: [value] });
        }
        const otherModels = models.filter((value) => !isDirectSystemModel(config, value));
        if (otherModels.length) {
            const key = JSON.stringify(["channel", channel.id]);
            groups.set(key, {
                key,
                label: channel.scope === "system" ? "系统模型" : channel.name || "未命名渠道",
                icon: modelIcon(config, otherModels[0]),
                scope: channel.id === PUBLIC_MODEL_CATALOG_ID ? "" : "我的模型",
                kind: "channel",
                models: groupModelsByDisplayName(config, otherModels),
            });
        }
    }
    return Array.from(groups.values());
}
