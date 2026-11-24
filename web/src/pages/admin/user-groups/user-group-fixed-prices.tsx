import { useQuery } from "@tanstack/react-query";
import { Button, Form, InputNumber, Select } from "antd";
import type { FormInstance } from "antd";
import { Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";

import { listAdminLogicalModels } from "@/services/api/logical-models";
import type { UserGroupFixedPrice } from "@/services/api/user-groups";
import { listAdminAllChannelModels } from "@/services/api/wallet";
import { fixedPriceTargetKey, type FixedPriceFormValue, type FixedPriceTerms, type UserGroupFormValues } from "./user-group-form";

type PriceTarget = { value: string; label: string; modelKey: string; price: UserGroupFixedPrice };

function priceTarget(modelKey: string, label: string, price: UserGroupFixedPrice): PriceTarget {
    return { value: fixedPriceTargetKey(price), label, modelKey, price };
}

function priceShape(price: UserGroupFixedPrice) {
    return JSON.stringify([price.billingMode, price.inputTokenPriceMicrocredits !== undefined, price.referenceVideoPriceMicrocredits !== undefined, price.imagePricing?.freeInputImages, price.imagePricing?.outputTiers.map((tier) => tier.maxPixels)]);
}

const amountRules = [{ required: true, type: "number" as const, min: 0, max: 1_000_000, message: "请输入 0 至 100 万积分之间的价格" }];
const tokenTerms = [
    ["inputTokenPriceMicrocredits", "输入（积分/百万 Token）"],
    ["outputTokenPriceMicrocredits", "输出（积分/百万 Token）"],
    ["cachedTokenPriceMicrocredits", "缓存命中（积分/百万 Token）"],
    ["cacheWriteTokenPriceMicrocredits", "缓存写入（积分/百万 Token）"],
] as const;

function PriceField({ name, label }: { name: (number | string)[]; label: string }) {
    return (
        <Form.Item name={name} label={label} rules={amountRules} className="mb-0">
            <InputNumber className="w-full" min={0} max={1_000_000} precision={6} />
        </Form.Item>
    );
}

function FixedPriceFields({ index, price }: { index: number; price: UserGroupFixedPrice }) {
    const unitLabel = price.billingMode === "per_second" ? "积分/秒" : "积分/次";
    const terms: ReadonlyArray<readonly [keyof FixedPriceTerms, string]> =
        price.billingMode === "token" ? (price.inputTokenPriceMicrocredits === undefined ? [["outputTokenPriceMicrocredits", "积分/百万视频 Token"]] : tokenTerms) : price.billingMode === "image_usage" ? [] : [["unitPriceMicrocredits", unitLabel]];
    return (
        <div className="grid gap-3 sm:grid-cols-2">
            {terms.map(([key, label]) => (
                <PriceField key={key} name={[index, "terms", key]} label={label} />
            ))}
            {price.referenceVideoPriceMicrocredits !== undefined ? <PriceField name={[index, "terms", "referenceVideoPriceMicrocredits"]} label={price.billingMode === "token" ? "带参考视频（积分/百万视频 Token）" : "带参考视频（积分/秒）"} /> : null}
            {price.imagePricing ? (
                <>
                    <PriceField name={[index, "imageInputPrice"]} label={`输入（积分/张，前 ${price.imagePricing.freeInputImages} 张免费）`} />
                    {price.imagePricing.outputTiers.map(({ maxPixels }, tierIndex) => (
                        <PriceField key={maxPixels} name={[index, "imageOutputPrices", tierIndex]} label={maxPixels ? `输出至 ${maxPixels.toLocaleString("zh-CN")} 像素（积分/张）` : "其余输出（积分/张）"} />
                    ))}
                </>
            ) : null}
        </div>
    );
}

export function UserGroupFixedPrices({ open, form }: { open: boolean; form: FormInstance<UserGroupFormValues> }) {
    const hasRows = Form.useWatch((values: UserGroupFormValues) => Boolean(values.fixedPrices?.length), form);
    const channelQuery = useQuery({ queryKey: ["admin", "group-price-channel-models"], queryFn: listAdminAllChannelModels, enabled: open && hasRows === true });
    const logicalQuery = useQuery({ queryKey: ["admin", "group-price-logical-models"], queryFn: listAdminLogicalModels, enabled: open && hasRows === true });
    const channelTargets = useMemo(
        () =>
            (channelQuery.data?.models || []).flatMap((item) =>
                item.priceTiers
                    .filter((tier) => tier.id && tier.priceConfigured)
                    .map((tier) => {
                        const selector = Object.entries(tier.selector || {})
                            .filter(([, value]) => value !== "*")
                            .map(([key, value]) => `${key}=${value}`)
                            .join(" · ");
                        return priceTarget(item.modelKey, `${item.displayName || item.modelKey} · ${item.channelName} · ${selector || "默认规格"}`, {
                            channelModelId: item.id,
                            priceTierId: tier.id,
                            billingMode: tier.billingMode,
                            imagePricing: tier.imagePricing ?? undefined,
                            inputTokenPriceMicrocredits: tier.billingMode === "token" && item.capability !== "video" ? 0 : undefined,
                            referenceVideoPriceMicrocredits: item.referenceVideoBilling && (tier.billingMode === "per_second" || tier.billingMode === "token") ? 0 : undefined,
                        });
                    }),
            ),
        [channelQuery.data],
    );
    const logicalTargets = useMemo(
        () =>
            (logicalQuery.data?.models || [])
                .filter((item) => item.pricePolicy === "unified")
                .map((item) =>
                    priceTarget(item.code, `${item.name} · ${item.code}`, {
                        logicalModelId: item.id,
                        billingMode: item.billingMode,
                        imagePricing: item.imagePricing ?? undefined,
                        inputTokenPriceMicrocredits: item.billingMode === "token" && item.capability !== "video" ? 0 : undefined,
                    }),
                ),
        [logicalQuery.data],
    );
    const targets = useMemo(() => new Map([...channelTargets, ...logicalTargets].map((item) => [item.value, item])), [channelTargets, logicalTargets]);
    const priceOptions = [
        { label: "系统渠道规格", options: channelTargets },
        { label: "前台统一价模型", options: logicalTargets },
    ];
    const loading = channelQuery.isFetching || logicalQuery.isFetching;

    return (
        <div className="mt-4">
            <div className="mb-2 text-sm font-medium">模型专属单价</div>
            <p className="mb-3 text-xs text-foreground/55">按模型或规格填写积分单价，优先于基础价、倍率与货币兑换。订单总额按原计费规则舍入。</p>
            {hasRows && (channelQuery.isError || logicalQuery.isError) ? (
                <div role="alert" className="mb-2 text-sm">
                    部分模型价格档加载失败
                    <Button
                        type="link"
                        onClick={() => {
                            if (channelQuery.isError) void channelQuery.refetch();
                            if (logicalQuery.isError) void logicalQuery.refetch();
                        }}
                    >
                        重试
                    </Button>
                </div>
            ) : null}
            <Form.List name="fixedPrices">
                {(fields, { add, remove }) => (
                    <div className="grid gap-3">
                        {fields.map((field) => (
                            <Form.Item
                                key={field.key}
                                noStyle
                                shouldUpdate={(prev: UserGroupFormValues, next: UserGroupFormValues) =>
                                    prev.fixedPrices?.[field.name]?.target !== next.fixedPrices?.[field.name]?.target || prev.fixedPrices?.[field.name]?.price !== next.fixedPrices?.[field.name]?.price
                                }
                            >
                                {() => {
                                    const row: FixedPriceFormValue | undefined = form.getFieldValue(["fixedPrices", field.name]);
                                    const selected = row?.target ? targets.get(row.target) : undefined;
                                    const query = row?.price?.logicalModelId ? logicalQuery : channelQuery;
                                    const missing = Boolean(row?.price && query.isSuccess && !query.isFetching && !selected);
                                    const changed = Boolean(row?.price && selected && priceShape(row.price) !== priceShape(selected.price));
                                    const options = row?.target && !selected ? [...priceOptions, { label: "当前配置", options: [{ value: row.target, label: `${row.modelKey || row.target}${missing ? "（已失效）" : ""}` }] }] : priceOptions;
                                    const selectTarget = (target: PriceTarget) => form.setFieldValue(["fixedPrices", field.name], { target: target.value, modelKey: target.modelKey, price: target.price });
                                    return (
                                        <div className="grid gap-3 rounded-lg border border-border p-3">
                                            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                                                <Form.Item name={[field.name, "target"]} rules={[{ required: true, message: "请选择模型或规格" }]} className="mb-0">
                                                    <Select
                                                        aria-label="专属单价模型或规格"
                                                        placeholder="选择模型或规格"
                                                        showSearch={{ optionFilterProp: "label" }}
                                                        loading={loading}
                                                        options={options}
                                                        onChange={(value: string) => {
                                                            const target = targets.get(value);
                                                            if (target) selectTarget(target);
                                                        }}
                                                    />
                                                </Form.Item>
                                                <Button type="text" danger icon={<Trash2 className="size-4" />} aria-label="删除这条专属单价" onClick={() => remove(field.name)} />
                                            </div>
                                            {missing || changed ? (
                                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground/70">
                                                    <span>{missing ? "价格档已失效" : "模型计费方式或规格已变更"}，可保留原规则或移除。</span>
                                                    {changed && selected ? (
                                                        <Button type="link" className="px-0" onClick={() => selectTarget(selected)}>
                                                            按当前规则重新填写
                                                        </Button>
                                                    ) : null}
                                                </div>
                                            ) : row?.price ? (
                                                <FixedPriceFields key={row.target} index={field.name} price={row.price} />
                                            ) : null}
                                        </div>
                                    );
                                }}
                            </Form.Item>
                        ))}
                        <Button icon={<Plus className="size-4" />} onClick={() => add({})}>
                            添加专属单价
                        </Button>
                    </div>
                )}
            </Form.List>
        </div>
    );
}
